// A small shell over the shared project: quoting, globs, ; && || pipes and > >> redirection,
// the usual file commands, `python`/`node` through the sandbox, and `git`.
import { c } from './ansi';
import { runGit } from './git';
import { basename, dirname, normalize } from './projectFs';
import { runCode } from '../runner';

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, ''); // eslint-disable-line no-control-regex

// ---- parsing ------------------------------------------------------------------------------
export function tokenize(line) {
    const tokens = [];
    let word = '';
    let started = false;
    let quoted = false;
    const push = () => { if (started) tokens.push({ type: 'word', value: word, quoted }); word = ''; started = false; quoted = false; };
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === "'" || ch === '"') {
            const end = line.indexOf(ch, i + 1);
            if (end === -1) throw new Error('unterminated quote');
            let inner = line.slice(i + 1, end);
            if (ch === '"') inner = inner.replace(/\\(["\\$])/g, '$1');
            word += inner; started = true; quoted = true; i = end;
        } else if (ch === '\\' && i + 1 < line.length) {
            word += line[i + 1]; started = true; quoted = true; i += 1;
        } else if (/\s/.test(ch)) {
            push();
        } else if (ch === '#' && !started) {
            break;
        } else if ('|&;><'.includes(ch)) {
            push();
            const two = line.slice(i, i + 2);
            if (['&&', '||', '>>'].includes(two)) { tokens.push({ type: 'op', value: two }); i += 1; } else tokens.push({ type: 'op', value: ch });
        } else { word += ch; started = true; }
    }
    push();
    return tokens;
}

// -> [{ op: ';'|'&&'|'||', pipeline: [{ argv: [{value, quoted}], redirect }] }]
export function parse(tokens) {
    const list = [];
    let op = ';';
    let pipeline = [];
    let cmd = { argv: [], redirect: null };
    const endCmd = () => { if (cmd.argv.length) pipeline.push(cmd); else if (cmd.redirect) throw new Error('syntax error: missing command'); cmd = { argv: [], redirect: null }; };
    const endPipeline = (nextOp) => {
        endCmd();
        if (pipeline.length) list.push({ op, pipeline });
        pipeline = [];
        op = nextOp;
    };
    for (let i = 0; i < tokens.length; i += 1) {
        const t = tokens[i];
        if (t.type === 'word') cmd.argv.push(t);
        else if (t.value === '|') { if (!cmd.argv.length) throw new Error('syntax error near |'); endCmd(); } else if (t.value === ';' || t.value === '&&' || t.value === '||') endPipeline(t.value);
        else if (t.value === '>' || t.value === '>>') {
            const target = tokens[i + 1];
            if (!target || target.type !== 'word') throw new Error(`syntax error near ${t.value}`);
            cmd.redirect = { mode: t.value, path: target.value };
            i += 1;
        } else throw new Error(`syntax error near ${t.value}`);
    }
    endPipeline(';');
    return list;
}

// ---- the shell ------------------------------------------------------------------------------
const COMMAND_NAMES = ['cat', 'cd', 'clear', 'cp', 'date', 'docs', 'echo', 'git', 'grep', 'head', 'help', 'ls', 'mkdir', 'mv', 'node', 'open', 'pwd', 'python', 'python3', 'rm', 'sort', 'tail', 'touch', 'tree', 'uniq', 'wc', 'whoami'];
const GIT_NAMES = ['add', 'auth', 'branch', 'checkout', 'clone', 'commit', 'config', 'diff', 'fetch', 'help', 'init', 'log', 'merge', 'mv', 'pull', 'push', 'remote', 'reset', 'restore', 'rm', 'show', 'status', 'switch', 'tag'];

const HELP = `Shell commands:
  ls [-a] [-l]  cd  pwd  cat  echo  mkdir [-p]  touch  rm [-rf]  mv  cp [-r]  tree
  head  tail  wc  grep [-inv]  sort  uniq  open <file>  clear  date  whoami
  docs [terminal|git|github|run]     open the full guide
  python <file> | python -c "code"      node <file> | node -e "code"
  git <command>     (run "git help")

Pipes (|), && , ;, > and >> work.  Tab completes names, ↑/↓ browse history.
Files and git history are shared with everyone in this room; this terminal's screen is yours alone.`;

const globToRegex = (pattern) =>
    new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);

export function createShell({ fs, user, hooks = {} }) {
    let cwd = '/';
    let lastStatus = 0;

    const resolve = (p) => normalize(p.startsWith('~') ? `/${p.slice(1)}` : p.startsWith('/') ? p : `${cwd}/${p}`);

    const expandGlob = async (word) => {
        if (word.quoted || !/[*?]/.test(word.value)) return [word.value];
        const slash = word.value.lastIndexOf('/');
        const dir = slash === -1 ? '' : word.value.slice(0, slash + 1);
        const pattern = globToRegex(word.value.slice(slash + 1));
        try {
            const entries = await fs.list(resolve(dir || '.'));
            const hits = entries.map((e) => e.name).filter((n) => pattern.test(n) && (!n.startsWith('.') || word.value.slice(slash + 1).startsWith('.'))).sort();
            return hits.length ? hits.map((n) => dir + n) : [word.value];
        } catch { return [word.value]; }
    };

    // ---- commands -------------------------------------------------------------------------
    const cmds = {};
    const failWith = (ctx, name, error) => { ctx.err(`${name}: ${error.code === 'ENOENT' ? 'no such file or directory' : error.message}\n`); return 1; };

    cmds.help = async (a, ctx) => { ctx.out(`${HELP}\n`); return 0; };
    cmds.pwd = async (a, ctx) => { ctx.out(`${cwd}\n`); return 0; };
    cmds.whoami = async (a, ctx) => { ctx.out(`${user}\n`); return 0; };
    cmds.date = async (a, ctx) => { ctx.out(`${new Date().toString()}\n`); return 0; };
    cmds.clear = async (a, ctx) => { ctx.clear(); return 0; };
    cmds.echo = async (a, ctx) => {
        const noNewline = a[0] === '-n';
        ctx.out(`${(noNewline ? a.slice(1) : a).join(' ')}${noNewline ? '' : '\n'}`);
        return 0;
    };

    cmds.cd = async (a, ctx) => {
        const target = resolve(a[0] || '/');
        if (!fs.isDir(target)) { ctx.err(`cd: no such directory: ${a[0]}\n`); return 1; }
        cwd = target;
        return 0;
    };

    cmds.ls = async (a, ctx) => {
        const flags = a.filter((x) => x.startsWith('-')).join('');
        const targets = a.filter((x) => !x.startsWith('-'));
        const showAll = flags.includes('a');
        const long = flags.includes('l');
        let status = 0;
        for (const [i, target] of (targets.length ? targets : ['.']).entries()) {
            const path = resolve(target);
            let entries;
            if (fs.isFile(path)) entries = [{ name: target, kind: 'file' }];
            else {
                try {
                    entries = await fs.list(path);
                    if (showAll && await fs.exists(normalize(`${path}/.git`))) entries.push({ name: '.git', kind: 'folder' });
                } catch (error) { ctx.err(`ls: cannot access '${target}': no such file or directory\n`); status = 1; continue; }
            }
            if (targets.length > 1) ctx.out(`${i ? '\n' : ''}${target}:\n`);
            entries = entries.filter((e) => showAll || !e.name.startsWith('.')).sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
            const paint = (e) => (e.kind === 'folder' ? c.boldBlue(e.name) : e.name);
            if (long) {
                for (const e of entries) {
                    const size = e.kind === 'folder' ? 0 : new TextEncoder().encode((await fs.readFile(normalize(`${path}/${e.name}`), 'utf8').catch(() => ''))).length;
                    ctx.out(`${e.kind === 'folder' ? 'drwxr-xr-x' : '-rw-r--r--'} ${String(size).padStart(7)} ${paint(e)}\n`);
                }
            } else if (!ctx.isTty) {
                entries.forEach((e) => ctx.out(`${e.name}\n`));
            } else if (entries.length) {
                const width = Math.max(...entries.map((e) => e.name.length)) + 2;
                const cols = Math.max(1, Math.floor((ctx.cols || 80) / width));
                const rows = Math.ceil(entries.length / cols);
                for (let r = 0; r < rows; r += 1) {
                    let line = '';
                    for (let k = 0; k < cols; k += 1) {
                        const e = entries[k * rows + r];
                        if (e) line += paint(e) + ' '.repeat(width - e.name.length);
                    }
                    ctx.out(`${line.trimEnd()}\n`);
                }
            }
        }
        return status;
    };

    cmds.cat = async (a, ctx) => {
        if (!a.length) { ctx.out(ctx.stdin ?? ''); return 0; }
        let status = 0;
        for (const f of a) {
            try { ctx.out(await fs.readFile(resolve(f), 'utf8')); } catch (error) { status = failWith(ctx, `cat: ${f}`, error); }
        }
        return status;
    };

    cmds.mkdir = async (a, ctx) => {
        const parents = a.includes('-p');
        let status = 0;
        for (const d of a.filter((x) => !x.startsWith('-'))) {
            try {
                if (parents) {
                    let acc = '';
                    for (const seg of resolve(d).split('/').filter(Boolean)) {
                        acc += `/${seg}`;
                        if (!(await fs.exists(acc))) await fs.mkdir(acc);
                    }
                } else await fs.mkdir(resolve(d));
            } catch (error) { ctx.err(`mkdir: cannot create '${d}': ${error.code === 'EEXIST' ? 'already exists' : error.message}\n`); status = 1; }
        }
        return status;
    };

    cmds.touch = async (a, ctx) => {
        let status = 0;
        for (const f of a) {
            try { if (!(await fs.exists(resolve(f)))) await fs.writeFile(resolve(f), ''); } catch (error) { status = failWith(ctx, `touch: ${f}`, error); }
        }
        return status;
    };

    cmds.rm = async (a, ctx) => {
        const flags = a.filter((x) => x.startsWith('-')).join('');
        const recursive = /r|R/.test(flags);
        const force = flags.includes('f');
        let status = 0;
        for (const f of a.filter((x) => !x.startsWith('-'))) {
            try { await fs.remove(resolve(f), { recursive }); } catch (error) {
                if (force && error.code === 'ENOENT') continue;
                ctx.err(`rm: cannot remove '${f}': ${error.code === 'EISDIR' ? 'is a directory (use -r)' : 'no such file or directory'}\n`);
                status = 1;
            }
        }
        return status;
    };

    const destFor = (src, dest) => (fs.isDir(dest) ? normalize(`${dest}/${basename(src)}`) : dest);

    cmds.mv = async (a, ctx) => {
        const args = a.filter((x) => !x.startsWith('-'));
        if (args.length < 2) { ctx.err('usage: mv <source>... <destination>\n'); return 1; }
        const dest = resolve(args[args.length - 1]);
        if (args.length > 2 && !fs.isDir(dest)) { ctx.err('mv: target is not a directory\n'); return 1; }
        let status = 0;
        for (const s of args.slice(0, -1)) {
            try { await fs.rename(resolve(s), destFor(resolve(s), dest)); } catch (error) { status = failWith(ctx, `mv: ${s}`, error); }
        }
        return status;
    };

    const copyTree = async (src, dest) => {
        if (fs.isDir(src)) {
            if (!(await fs.exists(dest))) await fs.mkdir(dest);
            for (const e of await fs.list(src)) await copyTree(normalize(`${src}/${e.name}`), normalize(`${dest}/${e.name}`));
        } else await fs.writeFile(dest, await fs.readFile(src, 'utf8'));
    };

    cmds.cp = async (a, ctx) => {
        const recursive = a.some((x) => /^-[a-zA-Z]*[rR]/.test(x));
        const args = a.filter((x) => !x.startsWith('-'));
        if (args.length < 2) { ctx.err('usage: cp [-r] <source>... <destination>\n'); return 1; }
        const dest = resolve(args[args.length - 1]);
        let status = 0;
        for (const s of args.slice(0, -1)) {
            const src = resolve(s);
            if (fs.isDir(src) && !recursive) { ctx.err(`cp: -r not specified; omitting directory '${s}'\n`); status = 1; continue; }
            try { await copyTree(src, destFor(src, dest)); } catch (error) { status = failWith(ctx, `cp: ${s}`, error); }
        }
        return status;
    };

    cmds.tree = async (a, ctx) => {
        const showAll = a.includes('-a');
        const root = resolve(a.find((x) => !x.startsWith('-')) || '.');
        if (!fs.isDir(root)) { ctx.err(`tree: ${root}: no such directory\n`); return 1; }
        let files = 0;
        let dirs = 0;
        const walk = async (dir, prefix) => {
            const entries = (await fs.list(dir)).filter((e) => showAll || !e.name.startsWith('.'))
                .sort((x, y) => (x.kind === y.kind ? x.name.localeCompare(y.name, undefined, { numeric: true }) : x.kind === 'folder' ? -1 : 1));
            for (const [i, e] of entries.entries()) {
                const last = i === entries.length - 1;
                ctx.out(`${prefix}${last ? '└── ' : '├── '}${e.kind === 'folder' ? c.boldBlue(e.name) : e.name}\n`);
                if (e.kind === 'folder') { dirs += 1; await walk(normalize(`${dir}/${e.name}`), prefix + (last ? '    ' : '│   ')); } else files += 1;
            }
        };
        ctx.out(`${c.boldBlue(root === '/' ? '.' : basename(root))}\n`);
        await walk(root, '');
        ctx.out(`\n${dirs} director${dirs === 1 ? 'y' : 'ies'}, ${files} file${files === 1 ? '' : 's'}\n`);
        return 0;
    };

    const textInput = async (names, ctx, who) => {
        if (!names.length) return ctx.stdin ?? '';
        const parts = [];
        for (const f of names) {
            try { parts.push(await fs.readFile(resolve(f), 'utf8')); } catch { ctx.err(`${who}: ${f}: no such file or directory\n`); }
        }
        return parts.join('');
    };
    const splitLines = (t) => { const l = t.split('\n'); if (l[l.length - 1] === '') l.pop(); return l; };
    const countArg = (a) => { const i = a.indexOf('-n'); if (i !== -1) return [Number(a[i + 1]) || 10, a.filter((_, j) => j !== i && j !== i + 1)]; const m = a.find((x) => /^-\d+$/.test(x)); return m ? [Number(m.slice(1)), a.filter((x) => x !== m)] : [10, a]; };

    cmds.head = async (a, ctx) => { const [n, rest] = countArg(a); ctx.out(splitLines(await textInput(rest, ctx, 'head')).slice(0, n).map((l) => `${l}\n`).join('')); return 0; };
    cmds.tail = async (a, ctx) => { const [n, rest] = countArg(a); ctx.out(splitLines(await textInput(rest, ctx, 'tail')).slice(-n).map((l) => `${l}\n`).join('')); return 0; };
    cmds.wc = async (a, ctx) => {
        const text = await textInput(a.filter((x) => !x.startsWith('-')), ctx, 'wc');
        const l = splitLines(text).length;
        const w = text.split(/\s+/).filter(Boolean).length;
        const flag = a.find((x) => x.startsWith('-'));
        ctx.out(`${flag === '-l' ? l : flag === '-w' ? w : flag === '-c' ? text.length : `${l} ${w} ${text.length}`}\n`);
        return 0;
    };
    cmds.sort = async (a, ctx) => {
        const lines = splitLines(await textInput(a.filter((x) => !x.startsWith('-')), ctx, 'sort')).sort((x, y) => x.localeCompare(y, undefined, { numeric: a.includes('-n') }));
        if (a.includes('-r')) lines.reverse();
        ctx.out(lines.map((l) => `${l}\n`).join(''));
        return 0;
    };
    cmds.uniq = async (a, ctx) => {
        const lines = splitLines(await textInput(a.filter((x) => !x.startsWith('-')), ctx, 'uniq'));
        ctx.out(lines.filter((l, i) => l !== lines[i - 1]).map((l) => `${l}\n`).join(''));
        return 0;
    };
    cmds.grep = async (a, ctx) => {
        const flags = a.filter((x) => x.startsWith('-')).join('');
        const [pattern, ...files] = a.filter((x) => !x.startsWith('-'));
        if (pattern === undefined) { ctx.err('usage: grep [-inv] <pattern> [file...]\n'); return 2; }
        let regex;
        try { regex = new RegExp(pattern, flags.includes('i') ? 'i' : ''); } catch { ctx.err('grep: invalid pattern\n'); return 2; }
        let found = false;
        const scan = (text, label) => splitLines(text).forEach((line, i) => {
            if (regex.test(line) === flags.includes('v')) return;
            found = true;
            const body = flags.includes('n') ? `${i + 1}:${line}` : line;
            ctx.out(`${label ? `${c.magenta(label)}:` : ''}${body}\n`);
        });
        if (!files.length) scan(ctx.stdin ?? '', '');
        else {
            const targets = [];
            const collect = async (path, shown) => {
                if (fs.isDir(path)) { if (flags.includes('r')) for (const e of await fs.list(path)) await collect(normalize(`${path}/${e.name}`), normalize(`${shown}/${e.name}`).slice(1)); } else targets.push([path, shown]);
            };
            for (const f of files) await collect(resolve(f), f);
            for (const [path, shown] of targets) scan(await fs.readFile(path, 'utf8').catch(() => ''), files.length > 1 || flags.includes('r') ? shown : '');
        }
        return found ? 0 : 1;
    };

    cmds.open = async (a, ctx) => {
        const path = resolve(a[0] || '');
        if (!fs.isFile(path)) { ctx.err(`open: ${a[0] || ''}: no such file\n`); return 1; }
        hooks.openFile?.(path);
        return 0;
    };

    const script = (lang, inline) => async (a, ctx) => {
        let code;
        let entry;
        if (a[0] === inline) { code = a[1] ?? ''; entry = lang === 'python' ? 'main.py' : 'main.js'; } else {
            if (!a[0]) { ctx.err(`usage: ${lang === 'python' ? 'python' : 'node'} <file> | ${inline} "code"\n`); return 2; }
            const path = resolve(a[0]);
            try { code = await fs.readFile(path, 'utf8'); } catch { ctx.err(`can't open file '${a[0]}': no such file\n`); return 2; }
            entry = path.slice(1);
        }
        const result = await runCode(lang, code, {
            files: fs.snapshot(),
            entry,
            onStatus: (s) => { if (s === 'loading') ctx.err(c.dim('Loading the Python runtime (first run only, ~10 MB)…\n')); },
        });
        if (result.stdout) ctx.out(`${result.stdout}\n`);
        if (result.stderr) ctx.err(`${c.red(result.stderr)}\n`);
        return result.stderr ? 1 : 0;
    };
    cmds.python = script('python', '-c');
    cmds.python3 = cmds.python;
    cmds.node = script('javascript', '-e');

    cmds.docs = async (a, ctx) => {
        const known = { terminal: 'terminal', git: 'git', github: 'github', run: 'run', help: 'help', start: 'start' };
        if (a[0] && !known[a[0]]) { ctx.err(`docs: no section called '${a[0]}'. Try: terminal, git, github, run, help\n`); return 1; }
        hooks.openDocs?.(known[a[0]] || 'terminal');
        ctx.out(c.dim('Opening the guide…\n'));
        return 0;
    };

    cmds.git = async (a, ctx) => runGit(a, { ...ctx, fs, cwd, user });

    // ---- execution ------------------------------------------------------------------------
    const runPipeline = async (pipeline, io) => {
        let stdin = null;
        let status = 0;
        for (const [i, cmd] of pipeline.entries()) {
            const last = i === pipeline.length - 1;
            const words = [];
            for (const w of cmd.argv) words.push(...(await expandGlob(w)));
            const [name, ...args] = words;
            let captured = '';
            const toFile = last && cmd.redirect;
            const ctx = {
                stdin,
                cols: io.cols,
                isTty: last && !toFile,
                clear: io.clear,
                err: io.err,
                out: (s) => { if (last && !toFile) io.out(s); else captured += s; },
            };
            const handler = cmds[name];
            if (!handler) { io.err(`${c.red(`${name}: command not found`)}. Type "help" for what's available.\n`); status = 127; } else {
                try { status = await handler(args, ctx); } catch (error) { console.error(error); io.err(`${c.red(`${name}: ${error.message}`)}\n`); status = 1; }
            }
            if (toFile) {
                try {
                    const path = resolve(cmd.redirect.path);
                    const previous = cmd.redirect.mode === '>>' && await fs.exists(path) ? await fs.readFile(path, 'utf8') : '';
                    await fs.writeFile(path, previous + captured);
                } catch (error) { io.err(`${c.red(`cannot write ${cmd.redirect.path}: ${error.message}`)}\n`); status = 1; }
            }
            stdin = stripAnsi(captured);
        }
        return status;
    };

    return {
        get cwd() { return cwd; },

        async run(line, io) {
            fs.invalidate(); // others may have changed the project since the last command
            let list;
            try { list = parse(tokenize(line)); } catch (error) { io.err(`${c.red(`shell: ${error.message}`)}\n`); lastStatus = 2; return; }
            for (const { op, pipeline } of list) {
                if (op === '&&' && lastStatus !== 0) continue;
                if (op === '||' && lastStatus === 0) continue;
                lastStatus = await runPipeline(pipeline, io);
            }
        },

        async prompt() {
            const shown = cwd === '/' ? '~' : `~${cwd}`;
            let branch = '';
            for (let dir = cwd; ; dir = dirname(dir)) {
                try {
                    const head = await fs.readFile(normalize(`${dir}/.git/HEAD`), 'utf8');
                    branch = head.startsWith('ref: refs/heads/') ? head.trim().slice(16) : head.trim().slice(0, 7);
                    break;
                } catch { /* keep looking upward */ }
                if (dir === '/') break;
            }
            const plain = `${user} ${shown}${branch ? ` (${branch})` : ''} $ `;
            return { text: `${c.green(user)} ${c.boldBlue(shown)}${branch ? c.magenta(` (${branch})`) : ''} ${c.gray('$')} `, length: plain.length };
        },

        // Tab completion: returns { start, options } where options replace line[start:cursor].
        async complete(line, cursor) {
            const before = line.slice(0, cursor);
            const wordStart = before.search(/[^\s|;&]*$/);
            const word = before.slice(wordStart);
            const words = before.slice(0, wordStart).split(/[|;&]+/).pop().trim().split(/\s+/).filter(Boolean);
            if (!words.length) return { start: wordStart, options: COMMAND_NAMES.filter((n) => n.startsWith(word)) };
            if (words[0] === 'git' && words.length === 1) return { start: wordStart, options: GIT_NAMES.filter((n) => n.startsWith(word)) };
            const slash = word.lastIndexOf('/');
            const dirPart = slash === -1 ? '' : word.slice(0, slash + 1);
            const prefix = word.slice(slash + 1);
            try {
                const entries = await fs.list(resolve(dirPart || '.'));
                const options = entries.filter((e) => e.name.startsWith(prefix) && (prefix.startsWith('.') || !e.name.startsWith('.')))
                    .map((e) => `${dirPart}${e.name}${e.kind === 'folder' ? '/' : ''}`).sort();
                return { start: wordStart, options };
            } catch { return { start: wordStart, options: [] }; }
        },
    };
}
