// `git` for the in-browser terminal, built on isomorphic-git. The repository's history is stored
// in the room (see projectFs.js), so everyone in the room shares one repo.
import { Buffer } from 'buffer';
import { structuredPatch } from 'diff';
import { c } from './ansi';
import { basename, normalize } from './projectFs';
import { WS_URL } from '../config';

// isomorphic-git expects Node's Buffer to exist globally; browsers (and Create React App) don't provide it.
if (!window.Buffer) window.Buffer = Buffer;

class Fatal extends Error {}
const fatal = (message) => new Fatal(`fatal: ${message}`);

let cached;
const lib = async () => {
    if (!cached) {
        const mod = await import('isomorphic-git');
        cached = mod.default || mod;
    }
    return cached;
};

const AUTH_KEY = 'cwf:gitauth';
export const readAuth = () => { try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch { return null; } };

// The backend relays git-over-HTTPS to a few allow-listed hosts, since browsers can't reach them directly.
const proxyBase = () => `${WS_URL.replace(/^ws/, 'http').replace(/\/ws\/code_sync\/?$/, '')}/git-proxy`;

const HELP = `usage: git <command> [<args>]

  init                      create a repository in the project
  status [-s]               show what changed
  add <path>... | .         stage changes
  commit -m <msg> [-a]      record staged changes (--amend to rewrite the last one)
  log [--oneline] [-n N]    show history
  diff [--staged] [<rev>]   show changes
  show [<rev>]              show a commit
  branch [<name>] [-d|-m]   list, create, delete or rename branches
  checkout <branch> | -b <new> | -- <file>
  switch [-c] <branch>      switch branches
  restore [--staged] <file> discard changes or unstage
  reset [--soft|--hard] [<rev>]
  merge <branch>            merge a branch into the current one
  rm [--cached] <file>      remove a file
  mv <from> <to>            rename a file
  tag [<name>] [-d]         list, create or delete tags
  remote [-v] | add <name> <url> | remove <name>
  clone <url> [<dir>]       clone a GitHub/GitLab repository (small ones)
  fetch | pull | push       sync with a remote
  auth <token> [<user>]     save an access token for private repos / pushing (this browser only)
  config <key> [<value>]`;

// ---- small helpers ------------------------------------------------------------------------
const relPath = (root, abs) => {
    const p = normalize(abs);
    return root === '/' ? p.slice(1) : p.slice(root.length + 1);
};

const shortOid = (oid) => oid.slice(0, 7);

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'user';
export const identityFor = (name) => ({ name, email: `${slug(name)}@users.codewithfriend` });

const formatDate = (timestamp, offsetMinutes) => {
    const zone = -offsetMinutes; // git stores the sign the other way round
    const d = new Date((timestamp + zone * 60) * 1000);
    const sign = zone >= 0 ? '+' : '-';
    const hh = String(Math.floor(Math.abs(zone) / 60)).padStart(2, '0');
    const mm = String(Math.abs(zone) % 60).padStart(2, '0');
    const [wd, day, mon, , time] = d.toUTCString().replace(',', '').split(' ');
    return `${wd} ${mon} ${Number(day)} ${time} ${d.getUTCFullYear()} ${sign}${hh}${mm}`;
};

const parseFlags = (args, valueFlags = []) => {
    const flags = {};
    const rest = [];
    for (let i = 0; i < args.length; i += 1) {
        const a = args[i];
        if (a === '--') { rest.push(...args.slice(i + 1)); break; }
        if (valueFlags.includes(a)) { (flags[a] ||= []).push(args[i + 1]); i += 1; continue; }
        if (a.startsWith('--')) { const [k, v] = a.split('='); flags[k] = v ?? true; continue; }
        if (a.startsWith('-') && a.length > 1 && !/^-\d+$/.test(a)) {
            [...a.slice(1)].forEach((ch) => { flags[`-${ch}`] = true; });
            const last = `-${a[a.length - 1]}`;
            if (valueFlags.includes(last) && a.length > 2) { flags[last] = [args[i + 1]]; i += 1; }
            continue;
        }
        rest.push(a);
    }
    return { flags, rest };
};

// ---- context --------------------------------------------------------------------------------
async function open(ctx) {
    const git = await lib();
    const fs = ctx.fs;
    const find = async () => {
        try { return await git.findRoot({ fs, filepath: ctx.cwd }); } catch { return null; }
    };
    return { git, fs, find };
}

async function repo(ctx) {
    const base = await open(ctx);
    const dir = await base.find();
    if (!dir) throw fatal('not a git repository (or any of the parent directories): .git');
    const r = { ...base, dir, ctx };
    r.rel = (abs) => relPath(dir, abs);
    r.abs = (p) => normalize(p.startsWith('/') ? p : `${ctx.cwd}/${p}`);
    r.branch = async () => (await base.git.currentBranch({ fs: base.fs, dir, fullname: false })) || null;
    r.head = async () => { try { return await base.git.resolveRef({ fs: base.fs, dir, ref: 'HEAD' }); } catch { return null; } };
    r.opts = { fs: base.fs, dir };
    return r;
}

async function resolveRev(r, rev) {
    const m = rev.match(/^(.*?)((?:[~^]\d*)*)$/);
    const [, name, suffix] = m;
    let oid;
    try { oid = await r.git.resolveRef({ ...r.opts, ref: name || 'HEAD' }); } catch {
        try { oid = await r.git.expandOid({ ...r.opts, oid: name }); } catch { throw fatal(`ambiguous argument '${rev}': unknown revision or path not in the working tree.`); }
    }
    for (const [, kind, n] of suffix.matchAll(/([~^])(\d*)/g)) {
        const { commit } = await r.git.readCommit({ ...r.opts, oid });
        const count = n === '' ? 1 : Number(n);
        if (kind === '^') {
            if (!commit.parent[count - 1]) throw fatal(`bad revision '${rev}'`);
            oid = commit.parent[count - 1];
        } else {
            for (let i = 0; i < count; i += 1) {
                const parent = (await r.git.readCommit({ ...r.opts, oid })).commit.parent[0];
                if (!parent) throw fatal(`bad revision '${rev}'`);
                oid = parent;
            }
        }
    }
    return oid;
}

// statusMatrix -> staged / unstaged / untracked buckets
async function inspect(r, filepaths) {
    const matrix = await r.git.statusMatrix({ ...r.opts, filepaths });
    const entries = [];
    for (const [file, h, w, s] of matrix) {
        if (h === 1 && w === 1 && s === 1) continue;
        if (h === 0 && w === 0 && s === 0) continue;
        let staged = null;
        if (h === 0 && s >= 2) staged = 'new file';
        else if (h === 1 && s === 0) staged = 'deleted';
        else if (h === 1 && s >= 2) staged = 'modified';
        let unstaged = null;
        if (s !== 0 && w === 0) unstaged = 'deleted';
        else if (s === 3 || (s === 1 && w === 2)) unstaged = 'modified';
        const untracked = s === 0 && w !== 0;
        entries.push({ file, h, w, s, staged, unstaged, untracked });
    }
    return entries;
}

const author = (ctx) => ({ ...identityFor(ctx.user), timestamp: Math.floor(Date.now() / 1000), timezoneOffset: new Date().getTimezoneOffset() });

// ---- diff ---------------------------------------------------------------------------------
const diffText = (path, before, after) => {
    const header = [`diff --git a/${path} b/${path}`];
    if (before == null) header.push('new file mode 100644');
    if (after == null) header.push('deleted file mode 100644');
    header.push(before == null ? '--- /dev/null' : `--- a/${path}`, after == null ? '+++ /dev/null' : `+++ b/${path}`);
    const patch = structuredPatch(path, path, before ?? '', after ?? '', '', '', { context: 3 });
    if (!patch.hunks.length) return '';
    // git prints "-3" for a one-line range and counts an empty range from the line before it.
    const range = (start, count) => `${count === 0 ? start - 1 : start}${count === 1 ? '' : `,${count}`}`;
    const body = patch.hunks.flatMap((h) => [
        c.cyan(`@@ -${range(h.oldStart, h.oldLines)} +${range(h.newStart, h.newLines)} @@`),
        ...h.lines.map((l) => (l[0] === '+' ? c.green(l) : l[0] === '-' ? c.red(l) : l)),
    ]);
    return [...header.map((l) => c.bold(l)), ...body].join('\n');
};

async function indexOids(r) {
    const entries = await r.git.walk({
        ...r.opts,
        trees: [r.git.STAGE()],
        map: async (fp, [e]) => {
            if (!e || fp === '.') return undefined;
            return (await e.type()) === 'blob' ? { fp, oid: await e.oid() } : undefined;
        },
    });
    return Object.fromEntries(entries.map(({ fp, oid }) => [fp, oid]));
}

async function treeOids(r, oid) {
    if (!oid) return {};
    const entries = await r.git.walk({
        ...r.opts,
        trees: [r.git.TREE({ ref: oid })],
        map: async (fp, [e]) => {
            if (!e || fp === '.') return undefined;
            return (await e.type()) === 'blob' ? { fp, oid: await e.oid() } : undefined;
        },
    });
    return Object.fromEntries(entries.map(({ fp, oid: o }) => [fp, o]));
}

const blobText = async (r, oid) => (oid ? new TextDecoder().decode((await r.git.readBlob({ ...r.opts, oid })).blob) : null);

async function workText(r, rel) {
    try { return await r.fs.readFile(normalize(`${r.dir}/${rel}`), 'utf8'); } catch { return null; }
}

function matches(file, specs) {
    return !specs.length || specs.some((s) => s === '' || file === s || file.startsWith(`${s}/`));
}

async function diffMaps(r, before, after, specs, readBefore, readAfter, { stat = false } = {}) {
    const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((f) => matches(f, specs)).sort();
    const out = [];
    const rows = [];
    for (const file of names) {
        if (before[file] && after[file] && before[file] === after[file]) continue;
        const a = before[file] ? await readBefore(file, before[file]) : null;
        const b = after[file] ? await readAfter(file, after[file]) : null;
        if (a === b) continue;
        if (stat) {
            const patch = structuredPatch(file, file, a ?? '', b ?? '', '', '', { context: 0 });
            const lines = patch.hunks.flatMap((h) => h.lines);
            rows.push({ file, add: lines.filter((l) => l[0] === '+').length, del: lines.filter((l) => l[0] === '-').length });
        } else {
            const text = diffText(file, a, b);
            if (text) out.push(text);
        }
    }
    if (!stat) return out.join('\n');
    if (!rows.length) return '';
    const width = Math.max(...rows.map((x) => x.file.length));
    const lines = rows.map((x) => ` ${x.file.padEnd(width)} | ${String(x.add + x.del).padStart(3)} ${c.green('+'.repeat(Math.min(x.add, 30)))}${c.red('-'.repeat(Math.min(x.del, 30)))}`);
    const add = rows.reduce((n, x) => n + x.add, 0);
    const del = rows.reduce((n, x) => n + x.del, 0);
    lines.push(` ${rows.length} file${rows.length === 1 ? '' : 's'} changed${add ? `, ${add} insertion${add === 1 ? '' : 's'}(+)` : ''}${del ? `, ${del} deletion${del === 1 ? '' : 's'}(-)` : ''}`);
    return lines.join('\n');
}

const QUIET_PHASES = new Set(['Receiving objects', 'Resolving deltas', 'Updating workdir']);

// ---- remote plumbing ----------------------------------------------------------------------
async function remoteOptions(r, ctx, extra = {}) {
    const http = (await import('isomorphic-git/http/web')).default;
    const phases = new Set();
    return {
        ...r.opts,
        http,
        corsProxy: proxyBase(),
        onAuth: () => {
            const saved = readAuth();
            return saved ? { username: saved.username || saved.token, password: saved.username ? saved.token : 'x-oauth-basic' } : { cancel: true };
        },
        onAuthFailure: () => { ctx.err(c.red('Authentication failed. Save a token with: git auth <token>\n')); return { cancel: true }; },
        // Drop the per-percent chatter; keep the milestones.
        onMessage: (m) => { const line = String(m).trim(); if (line && (!/\d+%/.test(line) || /done\.?$/.test(line))) ctx.err(`${c.dim(`remote: ${line}`)}\n`); },
        onProgress: (p) => { if (QUIET_PHASES.has(p.phase) && !phases.has(p.phase)) { phases.add(p.phase); ctx.err(`${c.dim(`${p.phase}…`)}\n`); } },
        ...extra,
    };
}

const friendly = (error) => {
    const msg = String(error?.message || error);
    if (error?.name === 'UserCanceledError' || /401|Unauthorized/i.test(msg)) return 'authentication required. Save an access token with: git auth <token>';
    if (/Failed to fetch|NetworkError/i.test(msg)) return 'could not reach the git proxy (is the backend running?)';
    if (/403|not allowed/i.test(msg)) return `access denied: ${msg}`;
    return msg;
};

// ---- commands -------------------------------------------------------------------------------
const commands = {};

commands.help = async (args, ctx) => { ctx.out(`${HELP}\n`); };

commands.init = async (args, ctx) => {
    const { git, fs } = await open(ctx);
    const { rest } = parseFlags(args);
    const dir = normalize(rest[0] ? (rest[0].startsWith('/') ? rest[0] : `${ctx.cwd}/${rest[0]}`) : ctx.cwd);
    const existed = await fs.exists(normalize(`${dir}/.git`));
    if (!existed && rest[0] && !(await fs.exists(dir))) await fs.mkdir(dir);
    await git.init({ fs, dir, defaultBranch: 'main' });
    ctx.out(`${existed ? 'Reinitialized existing' : 'Initialized empty'} Git repository in ${normalize(`${dir}/.git`)}/\n`);
};

commands.status = async (args, ctx) => {
    const r = await repo(ctx);
    const { flags } = parseFlags(args);
    const branch = await r.branch();
    const head = await r.head();
    const entries = await inspect(r);
    const short = flags['-s'] || flags['--short'];

    if (short) {
        entries.forEach((e) => {
            const x = e.untracked ? '?' : e.staged === 'new file' ? 'A' : e.staged === 'deleted' ? 'D' : e.staged ? 'M' : ' ';
            const y = e.untracked ? '?' : e.unstaged === 'deleted' ? 'D' : e.unstaged ? 'M' : ' ';
            ctx.out(`${x === ' ' ? ' ' : c.green(x)}${y === ' ' ? ' ' : c.red(y)} ${e.file}\n`);
        });
        return;
    }
    ctx.out(`${branch ? `On branch ${branch}` : `HEAD detached at ${shortOid(head || '')}`}\n`);
    if (!head) ctx.out('\nNo commits yet\n');
    const staged = entries.filter((e) => e.staged);
    const unstaged = entries.filter((e) => e.unstaged);
    const untracked = entries.filter((e) => e.untracked);
    const label = (s) => `${s}:`.padEnd(12);
    if (staged.length) {
        ctx.out('\nChanges to be committed:\n  (use "git restore --staged <file>..." to unstage)\n');
        staged.forEach((e) => ctx.out(`\t${c.green(`${label(e.staged)}${e.file}`)}\n`));
    }
    if (unstaged.length) {
        ctx.out('\nChanges not staged for commit:\n  (use "git add <file>..." to update what will be committed)\n');
        unstaged.forEach((e) => ctx.out(`\t${c.red(`${label(e.unstaged)}${e.file}`)}\n`));
    }
    if (untracked.length) {
        ctx.out('\nUntracked files:\n  (use "git add <file>..." to include in what will be committed)\n');
        untracked.forEach((e) => ctx.out(`\t${c.red(e.file)}\n`));
    }
    if (!staged.length && !unstaged.length && !untracked.length) ctx.out(head ? '\nnothing to commit, working tree clean\n' : '\nnothing to commit (create/copy files and use "git add" to track)\n');
    else if (!staged.length) ctx.out(`\n${unstaged.length ? 'no changes added to commit (use "git add" and/or "git commit -a")' : 'nothing added to commit but untracked files present (use "git add" to track)'}\n`);
};

async function stage(r, specs, { all = false, tracked = false } = {}) {
    const entries = await inspect(r);
    let count = 0;
    for (const e of entries) {
        if (!all && !matches(e.file, specs)) continue;
        if (tracked && e.untracked) continue;
        if (e.w === 0) { if (e.s !== 0) { await r.git.remove({ ...r.opts, filepath: e.file }); count += 1; } continue; }
        if (e.untracked || e.unstaged) {
            await r.git.add({ ...r.opts, filepath: e.file });
            count += 1;
        }
    }
    return count;
}

commands.add = async (args, ctx) => {
    const r = await repo(ctx);
    const { flags, rest } = parseFlags(args);
    if (!rest.length && !flags['-A'] && !flags['--all'] && !flags['-u']) { ctx.out('Nothing specified, nothing added.\n'); return; }
    const all = flags['-A'] || flags['--all'];
    const specs = rest.map((p) => r.rel(r.abs(p)));
    if (!all) {
        for (const spec of specs) {
            const known = (await inspect(r)).some((e) => matches(e.file, [spec])) || (await r.fs.exists(normalize(`${r.dir}/${spec}`)));
            if (!known) throw fatal(`pathspec '${rest[specs.indexOf(spec)]}' did not match any files`);
        }
    }
    await stage(r, specs, { all: all || (flags['-u'] && !rest.length), tracked: !!flags['-u'] });
};

const values = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter((x) => typeof x === 'string');

commands.commit = async (args, ctx) => {
    const r = await repo(ctx);
    const { flags } = parseFlags(args, ['-m', '--message']);
    const message = [...values(flags['-m']), ...values(flags['--message'])].join('\n\n');
    if (flags['-a'] || flags['--all']) await stage(r, [], { all: true, tracked: true });
    if (!message && !flags['--amend']) throw fatal('Aborting commit due to empty commit message. Use: git commit -m "message"');
    const entries = (await inspect(r)).filter((e) => e.staged);
    if (!entries.length && !flags['--allow-empty'] && !flags['--amend']) {
        const any = await inspect(r);
        ctx.out(any.length ? 'no changes added to commit (use "git add" and/or "git commit -a")\n' : 'nothing to commit, working tree clean\n');
        return;
    }
    const head = await r.head();
    const who = author(ctx);
    const oid = await r.git.commit({ ...r.opts, message: message || undefined, author: who, committer: who, amend: !!flags['--amend'] });
    const branch = (await r.branch()) || 'detached HEAD';
    ctx.out(`[${branch}${head ? '' : ' (root-commit)'} ${shortOid(oid)}] ${(message || '(amended)').split('\n')[0]}\n`);
    if (entries.length) ctx.out(` ${entries.length} file${entries.length === 1 ? '' : 's'} changed\n`);
};

async function decorations(r) {
    const map = {};
    const add = (oid, label) => { (map[oid] ||= []).push(label); };
    const current = await r.branch();
    for (const b of await r.git.listBranches(r.opts)) {
        try { add(await r.git.resolveRef({ ...r.opts, ref: b }), b === current ? `HEAD -> ${b}` : b); } catch { /* unborn */ }
    }
    for (const t of await r.git.listTags(r.opts)) {
        try { add(await r.git.resolveRef({ ...r.opts, ref: t }), `tag: ${t}`); } catch { /* ignore */ }
    }
    for (const remote of await r.git.listRemotes(r.opts)) {
        for (const b of await r.git.listBranches({ ...r.opts, remote: remote.remote })) {
            try { add(await r.git.resolveRef({ ...r.opts, ref: `${remote.remote}/${b}` }), `${remote.remote}/${b}`); } catch { /* ignore */ }
        }
    }
    if (!current) { const h = await r.head(); if (h) add(h, 'HEAD'); }
    return map;
}

commands.log = async (args, ctx) => {
    const r = await repo(ctx);
    const { flags, rest } = parseFlags(args, ['-n']);
    const countArg = args.find((a) => /^-\d+$/.test(a));
    const limit = flags['-n'] ? Number(flags['-n'][0]) : countArg ? Number(countArg.slice(1)) : undefined;
    const ref = rest.find((a) => !a.startsWith('-')) || 'HEAD';
    if (!(await r.head()) && ref === 'HEAD') throw fatal(`your current branch '${(await r.branch()) || 'main'}' does not have any commits yet`);
    const tip = await resolveRev(r, ref);
    const commits = await r.git.log({ ...r.opts, ref: tip, depth: limit });
    const deco = await decorations(r);
    const oneline = flags['--oneline'];
    commits.forEach(({ oid, commit }, i) => {
        const tags = deco[oid] ? ` (${deco[oid].join(', ')})` : '';
        if (oneline) {
            ctx.out(`${c.yellow(shortOid(oid))}${tags ? c.yellow(tags) : ''} ${commit.message.split('\n')[0]}\n`);
            return;
        }
        ctx.out(`${c.yellow(`commit ${oid}`)}${tags ? c.yellow(tags) : ''}\n`);
        ctx.out(`Author: ${commit.author.name} <${commit.author.email}>\n`);
        ctx.out(`Date:   ${formatDate(commit.author.timestamp, commit.author.timezoneOffset)}\n\n`);
        commit.message.trimEnd().split('\n').forEach((l) => ctx.out(`    ${l}\n`));
        if (i < commits.length - 1) ctx.out('\n');
    });
};

commands.diff = async (args, ctx) => {
    const r = await repo(ctx);
    const { flags, rest } = parseFlags(args);
    const revs = [];
    const paths = [];
    for (const a of rest) {
        const isPath = await r.fs.exists(r.abs(a)) || (await inspect(r)).some((e) => matches(e.file, [r.rel(r.abs(a))]));
        if (!isPath && revs.length < 2) revs.push(a); else paths.push(r.rel(r.abs(a)));
    }
    const readBlob = (file, oid) => blobText(r, oid);
    const readWork = async (file) => workText(r, file);
    let text;
    if (revs.length === 2) {
        const [a, b] = await Promise.all(revs.map((x) => resolveRev(r, x)));
        text = await diffMaps(r, await treeOids(r, a), await treeOids(r, b), paths, readBlob, readBlob, { stat: !!flags['--stat'] });
    } else if (flags['--staged'] || flags['--cached']) {
        const base = revs[0] ? await resolveRev(r, revs[0]) : await r.head();
        text = await diffMaps(r, await treeOids(r, base), await indexOids(r), paths, readBlob, readBlob, { stat: !!flags['--stat'] });
    } else if (revs.length === 1) {
        const tree = await treeOids(r, await resolveRev(r, revs[0]));
        const files = new Set([...Object.keys(tree), ...Object.keys(await indexOids(r))]);
        const work = {};
        for (const f of files) if (await r.fs.exists(normalize(`${r.dir}/${f}`))) work[f] = 'work';
        text = await diffMaps(r, tree, work, paths, readBlob, readWork, { stat: !!flags['--stat'] });
    } else {
        const idx = await indexOids(r);
        const work = {};
        for (const f of Object.keys(idx)) if (await r.fs.exists(normalize(`${r.dir}/${f}`))) work[f] = 'work';
        text = await diffMaps(r, idx, work, paths, readBlob, readWork, { stat: !!flags['--stat'] });
    }
    if (text) ctx.out(`${text}\n`);
};

async function tracked(r) {
    const idx = await indexOids(r);
    return Object.keys(idx).map((file) => ({ file }));
}

commands.show = async (args, ctx) => {
    const r = await repo(ctx);
    const { flags, rest } = parseFlags(args);
    const oid = await resolveRev(r, rest[0] || 'HEAD');
    const { commit } = await r.git.readCommit({ ...r.opts, oid });
    const deco = await decorations(r);
    ctx.out(`${c.yellow(`commit ${oid}`)}${deco[oid] ? c.yellow(` (${deco[oid].join(', ')})`) : ''}\n`);
    ctx.out(`Author: ${commit.author.name} <${commit.author.email}>\n`);
    ctx.out(`Date:   ${formatDate(commit.author.timestamp, commit.author.timezoneOffset)}\n\n`);
    commit.message.trimEnd().split('\n').forEach((l) => ctx.out(`    ${l}\n`));
    const readBlob = (file, o) => blobText(r, o);
    const text = await diffMaps(r, await treeOids(r, commit.parent[0]), await treeOids(r, oid), [], readBlob, readBlob, { stat: !!flags['--stat'] });
    if (text) ctx.out(`\n${text}\n`);
};

commands.branch = async (args, ctx) => {
    const r = await repo(ctx);
    const { flags, rest } = parseFlags(args);
    const current = await r.branch();
    if (flags['--show-current']) { ctx.out(`${current || ''}\n`); return; }
    if (flags['-d'] || flags['-D'] || flags['--delete']) {
        for (const name of rest) {
            if (name === current) throw fatal(`Cannot delete branch '${name}' checked out`);
            const oid = await r.git.resolveRef({ ...r.opts, ref: name }).catch(() => { throw fatal(`branch '${name}' not found.`); });
            await r.git.deleteBranch({ ...r.opts, ref: name });
            ctx.out(`Deleted branch ${name} (was ${shortOid(oid)}).\n`);
        }
        return;
    }
    if (flags['-m'] || flags['-M']) {
        const [from, to] = rest.length === 2 ? rest : [current, rest[0]];
        if (!to) throw fatal('branch name required');
        await r.git.renameBranch({ ...r.opts, ref: to, oldref: from, checkout: from === current });
        return;
    }
    if (rest.length) {
        if (!(await r.head())) throw fatal('not a valid object name: \'HEAD\' (make a commit first)');
        const start = rest[1] ? await resolveRev(r, rest[1]) : undefined;
        if ((await r.git.listBranches(r.opts)).includes(rest[0])) throw fatal(`a branch named '${rest[0]}' already exists`);
        await r.git.branch({ ...r.opts, ref: rest[0], object: start });
        return;
    }
    const names = await r.git.listBranches(r.opts);
    if (current && !names.includes(current)) names.push(current);
    names.sort().forEach((b) => ctx.out(b === current ? `${c.green(`* ${b}`)}\n` : `  ${b}\n`));
    if (flags['-a'] || flags['-r']) {
        for (const remote of await r.git.listRemotes(r.opts)) {
            for (const b of await r.git.listBranches({ ...r.opts, remote: remote.remote })) ctx.out(`  ${c.red(`remotes/${remote.remote}/${b}`)}\n`);
        }
    }
};

const refreshAfterCheckout = (ctx) => ctx.fs.invalidate();

async function switchTo(r, ctx, name) {
    const branches = await r.git.listBranches(r.opts);
    try {
        if (branches.includes(name)) {
            await r.git.checkout({ ...r.opts, ref: name });
            ctx.out(`Switched to branch '${name}'\n`);
            return true;
        }
        for (const remote of await r.git.listRemotes(r.opts)) {
            if ((await r.git.listBranches({ ...r.opts, remote: remote.remote })).includes(name)) {
                await r.git.checkout({ ...r.opts, ref: name, remote: remote.remote });
                ctx.out(`Switched to a new branch '${name}'\n`);
                return true;
            }
        }
        return false;
    } catch (error) {
        if (error?.name === 'CheckoutConflictError') {
            throw new Fatal(`error: Your local changes to the following files would be overwritten by checkout:\n\t${(error.data?.filepaths || []).join('\n\t')}\nPlease commit your changes before you switch branches.`);
        }
        throw error;
    } finally { refreshAfterCheckout(ctx); }
}

async function restorePaths(r, ctx, rest, { staged = false, source } = {}) {
    if (!rest.length) throw fatal('you must specify path(s) to restore');
    const specs = rest.map((p) => r.rel(r.abs(p)));
    const known = [...(await inspect(r)).map((e) => e.file), ...(await tracked(r)).map((t) => t.file)];
    const files = [...new Set(known)].filter((f) => matches(f, specs));
    if (!files.length) throw fatal(`pathspec '${rest[0]}' did not match any file(s) known to git`);
    const ref = source && source !== 'HEAD' ? source : (await r.branch()) || (await r.head());
    if (staged) {
        for (const f of files) await r.git.resetIndex({ ...r.opts, filepath: f, ref: source || 'HEAD' });
    } else {
        await r.git.checkout({ ...r.opts, ref, filepaths: files, force: true, noUpdateHead: true });
    }
    refreshAfterCheckout(ctx);
}

commands.checkout = async (args, ctx) => {
    const r = await repo(ctx);
    const { flags, rest } = parseFlags(args, ['-b', '-B']);
    const dashIndex = args.indexOf('--');
    const newBranch = flags['-b']?.[0] || flags['-B']?.[0];
    if (newBranch) {
        if (!(await r.head())) { // unborn branch: just point HEAD at the new name
            await r.git.writeRef({ ...r.opts, ref: 'HEAD', value: `refs/heads/${newBranch}`, symbolic: true, force: true });
            ctx.out(`Switched to a new branch '${newBranch}'\n`);
            return;
        }
        const start = rest[0] ? await resolveRev(r, rest[0]) : undefined;
        await r.git.branch({ ...r.opts, ref: newBranch, object: start, checkout: true, force: !!flags['-B'] });
        refreshAfterCheckout(ctx);
        ctx.out(`Switched to a new branch '${newBranch}'\n`);
        return;
    }
    if (!rest.length) throw fatal('you must specify a branch or paths');
    if (dashIndex === -1 && await switchTo(r, ctx, rest[0])) return;
    if (dashIndex === -1) { // a tag or commit id: detached HEAD
        try {
            const oid = await resolveRev(r, rest[0]);
            await r.git.checkout({ ...r.opts, ref: oid });
            refreshAfterCheckout(ctx);
            ctx.out(`HEAD is now at ${shortOid(oid)} (detached)\n`);
            return;
        } catch (error) { if (error instanceof Fatal && await r.fs.exists(r.abs(rest[0]))) { /* fall through to paths */ } else if (error instanceof Fatal) throw fatal(`pathspec '${rest[0]}' did not match any file(s) known to git`); else throw error; }
    }
    await restorePaths(r, ctx, rest, { source: 'HEAD' });
};

commands.switch = async (args, ctx) => {
    const r = await repo(ctx);
    const { flags, rest } = parseFlags(args, ['-c']);
    const create = flags['-c']?.[0] || flags['--create'];
    if (create) return commands.checkout(['-b', typeof create === 'string' ? create : rest[0], ...(rest[1] ? [rest[1]] : [])], ctx);
    if (!rest[0]) throw fatal('missing branch name');
    if (!(await switchTo(r, ctx, rest[0]))) throw fatal(`invalid reference: ${rest[0]}`);
    return undefined;
};

commands.restore = async (args, ctx) => {
    const r = await repo(ctx);
    const { flags, rest } = parseFlags(args, ['--source', '-s']);
    const source = flags['--source']?.[0] || flags['-s']?.[0];
    await restorePaths(r, ctx, rest, { staged: !!(flags['--staged'] || flags['-S']), source: source ? await resolveRev(r, source) : 'HEAD' });
};

commands.reset = async (args, ctx) => {
    const r = await repo(ctx);
    const { flags, rest } = parseFlags(args);
    const hard = flags['--hard'];
    const soft = flags['--soft'];
    let target;
    const paths = [];
    for (const a of rest) {
        if (!target && !paths.length) {
            try { target = await resolveRev(r, a); continue; } catch { /* maybe a path */ }
        }
        paths.push(r.rel(r.abs(a)));
    }
    if (paths.length) {
        for (const f of paths) await r.git.resetIndex({ ...r.opts, filepath: f, ref: target || 'HEAD' });
        return;
    }
    const head = await r.head();
    const oid = target || head;
    if (!oid) throw fatal('ambiguous argument \'HEAD\': unknown revision (no commits yet)');
    const branch = await r.branch();
    await r.git.writeRef({ ...r.opts, ref: branch ? `refs/heads/${branch}` : 'HEAD', value: oid, force: true });
    if (soft) return;
    if (hard) {
        await r.git.checkout({ ...r.opts, ref: branch || oid, force: true });
        refreshAfterCheckout(ctx);
        ctx.out(`HEAD is now at ${shortOid(oid)}\n`);
        return;
    }
    for (const e of await inspect(r)) if (e.staged || e.s !== 1) {
        try { await r.git.resetIndex({ ...r.opts, filepath: e.file, ref: oid }); } catch { /* untracked */ }
    }
};

commands.rm = async (args, ctx) => {
    const r = await repo(ctx);
    const { flags, rest } = parseFlags(args);
    if (!rest.length) throw fatal('No pathspec was given. Which files should I remove?');
    for (const p of rest) {
        const abs = r.abs(p);
        const rel = r.rel(abs);
        const files = (await tracked(r)).map((t) => t.file).filter((f) => matches(f, [rel]));
        if (!files.length) throw fatal(`pathspec '${p}' did not match any files`);
        if (rel && files.some((f) => f !== rel) && !(flags['-r'] || flags['-R'])) throw fatal(`not removing '${p}' recursively without -r`);
        for (const f of files) {
            await r.git.remove({ ...r.opts, filepath: f });
            if (!flags['--cached']) await r.fs.remove(normalize(`${r.dir}/${f}`)).catch(() => {});
            ctx.out(`rm '${f}'\n`);
        }
    }
    r.fs.invalidate();
};

commands.mv = async (args, ctx) => {
    const r = await repo(ctx);
    const { rest } = parseFlags(args);
    if (rest.length !== 2) throw fatal('usage: git mv <source> <destination>');
    const from = r.abs(rest[0]);
    let to = r.abs(rest[1]);
    if (r.fs.isDir(to)) to = normalize(`${to}/${basename(from)}`);
    await r.fs.rename(from, to);
    await r.git.remove({ ...r.opts, filepath: r.rel(from) }).catch(() => {});
    await r.git.add({ ...r.opts, filepath: r.rel(to) });
};

commands.merge = async (args, ctx) => {
    const r = await repo(ctx);
    const { rest } = parseFlags(args);
    const theirs = rest[0];
    if (!theirs) throw fatal('specify a branch to merge');
    const ours = await r.branch();
    if (!ours) throw fatal('you are not on a branch');
    if ((await inspect(r)).some((e) => e.staged || e.unstaged)) throw fatal('you have uncommitted changes; commit or restore them before merging');
    try {
        const who = author(ctx);
        const result = await r.git.merge({ ...r.opts, ours, theirs, author: who, committer: who, message: `Merge branch '${theirs}' into ${ours}` });
        if (result.alreadyMerged) { ctx.out('Already up to date.\n'); return; }
        await r.git.checkout({ ...r.opts, ref: ours, force: true });
        refreshAfterCheckout(ctx);
        ctx.out(result.fastForward ? `Fast-forward to ${shortOid(result.oid)}\n` : `Merge made (${shortOid(result.oid)}).\n`);
    } catch (error) {
        if (error?.name === 'MergeConflictError') {
            throw new Fatal(`CONFLICT in: ${(error.data?.filepaths || []).join(', ')}\nAutomatic merge failed; nothing was changed. Resolve by editing one branch first.`);
        }
        if (error?.name === 'NotFoundError') throw fatal(`'${theirs}' is not something we can merge`);
        throw error;
    }
};

commands.tag = async (args, ctx) => {
    const r = await repo(ctx);
    const { flags, rest } = parseFlags(args, ['-m']);
    if (flags['-d']) { for (const t of rest) { await r.git.deleteTag({ ...r.opts, ref: t }); ctx.out(`Deleted tag '${t}'\n`); } return; }
    if (!rest.length) { (await r.git.listTags(r.opts)).sort().forEach((t) => ctx.out(`${t}\n`)); return; }
    const object = rest[1] ? await resolveRev(r, rest[1]) : undefined;
    if (flags['-a'] || flags['-m']) {
        await r.git.annotatedTag({ ...r.opts, ref: rest[0], message: flags['-m']?.[0] || rest[0], object, tagger: author(ctx) });
    } else {
        await r.git.tag({ ...r.opts, ref: rest[0], object });
    }
};

commands.config = async (args, ctx) => {
    const r = await repo(ctx).catch(() => null);
    const { flags, rest } = parseFlags(args);
    const key = rest[0];
    if (!key) { ctx.out(`user.name=${ctx.user}\nuser.email=${identityFor(ctx.user).email}\n`); return; }
    if (key === 'user.name' || key === 'user.email') {
        if (rest[1] !== undefined && !flags['--get']) ctx.out(c.dim('Your commits always use your display name in this room, so this setting is read-only.\n'));
        ctx.out(`${key === 'user.name' ? ctx.user : identityFor(ctx.user).email}\n`);
        return;
    }
    if (!r) throw fatal('not in a git repository');
    if (rest[1] !== undefined && !flags['--get']) await r.git.setConfig({ ...r.opts, path: key, value: rest[1] });
    else { const value = await r.git.getConfig({ ...r.opts, path: key }); if (value !== undefined) ctx.out(`${value}\n`); }
};

commands.remote = async (args, ctx) => {
    const r = await repo(ctx);
    const { flags, rest } = parseFlags(args);
    const [sub, ...more] = rest;
    if (!sub) {
        for (const x of await r.git.listRemotes(r.opts)) ctx.out(flags['-v'] ? `${x.remote}\t${x.url} (fetch)\n${x.remote}\t${x.url} (push)\n` : `${x.remote}\n`);
        return;
    }
    if (sub === 'add') {
        if (more.length !== 2) throw fatal('usage: git remote add <name> <url>');
        if (!/^https:\/\//.test(more[1])) throw fatal('only https:// remotes are supported in the browser');
        await r.git.addRemote({ ...r.opts, remote: more[0], url: more[1] });
    } else if (sub === 'remove' || sub === 'rm') {
        await r.git.deleteRemote({ ...r.opts, remote: more[0] });
    } else if (sub === 'get-url') {
        const hit = (await r.git.listRemotes(r.opts)).find((x) => x.remote === more[0]);
        if (!hit) throw fatal(`No such remote '${more[0]}'`);
        ctx.out(`${hit.url}\n`);
    } else throw fatal(`unknown subcommand: ${sub}`);
};

commands.clone = async (args, ctx) => {
    const { git, fs } = await open(ctx);
    const { rest, flags } = parseFlags(args, ['--depth', '-b', '--branch']);
    const url = rest[0];
    if (!url) throw fatal('You must specify a repository to clone.');
    if (!/^https:\/\//.test(url)) throw fatal('only https:// URLs are supported in the browser');
    const name = rest[1] || basename(url.replace(/\.git$/, '').replace(/\/$/, ''));
    const dir = normalize(name.startsWith('/') ? name : `${ctx.cwd}/${name}`);
    if (await fs.exists(dir) && (await fs.readdir(dir)).length) throw fatal(`destination path '${name}' already exists and is not empty.`);
    if (!(await fs.exists(dir))) await fs.mkdir(dir);
    ctx.out(`Cloning into '${name}'...\n`);
    const ref = flags['-b']?.[0] || flags['--branch']?.[0];
    try {
        await git.clone(await remoteOptions({ fs, opts: { fs, dir } }, ctx, {
            fs, dir, url, singleBranch: true, depth: Number(flags['--depth']?.[0]) || 1, ref,
        }));
    } catch (error) {
        fs.purgeGit(dir);
        await fs.remove(dir, { recursive: true }).catch(() => {});
        fs.invalidate();
        throw new Fatal(`fatal: clone failed: ${friendly(error)}`);
    }
    fs.invalidate();
    ctx.out('done.\n');
};

commands.fetch = async (args, ctx) => {
    const r = await repo(ctx);
    const { rest } = parseFlags(args);
    const remote = rest[0] || 'origin';
    try { await r.git.fetch(await remoteOptions(r, ctx, { remote, singleBranch: false, tags: true })); } catch (error) { throw new Fatal(`fatal: ${friendly(error)}`); }
    ctx.out('Fetched.\n');
};

commands.pull = async (args, ctx) => {
    const r = await repo(ctx);
    const { rest } = parseFlags(args);
    const remote = rest[0] || 'origin';
    const branch = await r.branch();
    if (!branch) throw fatal('you are not on a branch');
    if ((await inspect(r)).some((e) => e.staged || e.unstaged)) throw fatal('you have uncommitted changes; commit or restore them before pulling');
    const who = author(ctx);
    try {
        await r.git.pull(await remoteOptions(r, ctx, { remote, ref: branch, remoteRef: rest[1] || branch, singleBranch: true, author: who, committer: who }));
    } catch (error) {
        if (error?.name === 'MergeConflictError') throw new Fatal(`CONFLICT in: ${(error.data?.filepaths || []).join(', ')}\nPull aborted; nothing was changed.`);
        throw new Fatal(`fatal: ${friendly(error)}`);
    } finally { refreshAfterCheckout(ctx); }
    ctx.out('Already up to date or fast-forwarded.\n');
};

commands.push = async (args, ctx) => {
    const r = await repo(ctx);
    const { flags, rest } = parseFlags(args);
    const remote = rest[0] || 'origin';
    const branch = rest[1] || (await r.branch());
    if (!branch) throw fatal('you are not on a branch');
    if (!(await r.git.listRemotes(r.opts)).some((x) => x.remote === remote)) throw fatal(`'${remote}' does not appear to be a git repository. Add one with: git remote add origin <url>`);
    if (!readAuth()) ctx.out(c.yellow('No token saved. Pushing needs one: git auth <token>\n'));
    let result;
    try {
        result = await r.git.push(await remoteOptions(r, ctx, { remote, ref: branch, remoteRef: branch, force: !!(flags['-f'] || flags['--force']) }));
    } catch (error) { throw new Fatal(`fatal: ${friendly(error)}`); }
    if (!result.ok) throw new Fatal(`error: failed to push: ${result.error || 'rejected'}`);
    ctx.out(`${c.green('Pushed')} ${branch} -> ${remote}\n`);
};

commands.auth = async (args, ctx) => {
    const { flags, rest } = parseFlags(args);
    if (flags['--clear']) { localStorage.removeItem(AUTH_KEY); ctx.out('Saved token removed.\n'); return; }
    if (flags['--status'] || !rest.length) { ctx.out(readAuth() ? 'A token is saved in this browser.\n' : 'No token saved. Usage: git auth <token> [username]\n'); return; }
    localStorage.setItem(AUTH_KEY, JSON.stringify({ token: rest[0], username: rest[1] || '' }));
    ctx.out('Token saved in this browser only (never shared with the room).\n');
};

export async function runGit(args, ctx) {
    const [sub, ...rest] = args;
    if (!sub || sub === '--help' || sub === '-h') { ctx.out(`${HELP}\n`); return 0; }
    const handler = commands[sub];
    if (!handler) { ctx.err(`git: '${sub}' is not supported here. Run "git help" to see what is.\n`); return 1; }
    try {
        await handler(rest, ctx);
        return 0;
    } catch (error) {
        if (error instanceof Fatal) { ctx.err(`${c.red(error.message)}\n`); return 128; }
        console.error(error);
        ctx.err(`${c.red(`fatal: ${friendly(error)}`)}\n`);
        return 128;
    }
}
