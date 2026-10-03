// A Node-style filesystem over the shared project, so git (and the shell) can work on the same
// files everyone is editing.
//   - Working-tree paths map onto the project's file tree (Yjs `files` map).
//   - Anything under a `.git` directory lives in a separate Yjs map (`gitfs`), keyed by absolute
//     path, so the repository history is shared by the room but never shows up in the explorer.
import { createNode, deleteNode, pathsById, readNodes, validateName } from '../utils/fs';

export const MAX_GIT_FILE_BYTES = 1.5 * 1024 * 1024; // keeps each sync message under the server's cap
export const MAX_GIT_TOTAL_BYTES = 12 * 1024 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const fail = (code, path, detail = '') => Object.assign(new Error(`${code}: ${detail || 'error'}, '${path}'`), { code, errno: -1 });

export const normalize = (path) => {
    const parts = [];
    path.split('/').forEach((seg) => {
        if (seg === '' || seg === '.') return;
        if (seg === '..') parts.pop(); else parts.push(seg);
    });
    return `/${parts.join('/')}`;
};
export const dirname = (path) => normalize(`${path}/..`);
export const basename = (path) => path.split('/').filter(Boolean).pop() || '';
const isGitPath = (path) => path.split('/').includes('.git');

// Git skips re-reading a file when its cached stat (mtime and ctime in WHOLE SECONDS, plus size) matches
// the index. Project files have no real modification time, and an edit made in the same second as the
// previous `git add` — to a file of the same length — would look unchanged and be silently skipped.
// So every stat reports a second value that has never been reported before (a random base plus a
// counter; the base differs per browser session so stored index entries from earlier sessions can't
// collide either). The cache then never matches, and git always re-hashes the content.
const statBase = 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
let statTick = 0;

const makeStat = (type, size = 0) => {
    const mtimeMs = (statBase + statTick++) * 1000;
    return {
        type, size, ino: 0, uid: 1, gid: 1, dev: 1,
        mode: type === 'dir' ? 0o40000 : 0o100644,
        mtimeMs, ctimeMs: mtimeMs,
        isFile: () => type === 'file',
        isDirectory: () => type === 'dir',
        isSymbolicLink: () => false,
    };
};

// Replace a text's content with the smallest edit, so collaborators' cursors survive a checkout.
export const replaceText = (ytext, next) => {
    const prev = ytext.toString();
    if (prev === next) return;
    let start = 0;
    while (start < prev.length && start < next.length && prev[start] === next[start]) start += 1;
    let endPrev = prev.length;
    let endNext = next.length;
    while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) { endPrev -= 1; endNext -= 1; }
    ytext.doc.transact(() => {
        if (endPrev > start) ytext.delete(start, endPrev - start);
        if (endNext > start) ytext.insert(start, next.slice(start, endNext));
    });
};

export class ProjectFs {
    constructor(files, gitfs) {
        this.files = files;
        this.gitfs = gitfs;
        this._index = null;
        const bind = (name) => (...args) => this[name](...args);
        this.promises = Object.fromEntries(
            ['readFile', 'writeFile', 'unlink', 'readdir', 'mkdir', 'rmdir', 'stat', 'lstat', 'readlink', 'symlink', 'chmod']
                .map((name) => [name, bind(name)])
        );
    }

    // ---- working tree -----------------------------------------------------------------
    get index() {
        if (!this._index) {
            const nodes = readNodes(this.files);
            const paths = pathsById(nodes);
            const byPath = new Map(nodes.map((n) => [paths[n.id], n]));
            this._index = { nodes, byPath };
        }
        return this._index;
    }

    invalidate() { this._index = null; }

    _node(path) {
        return path === '/' ? { id: null, kind: 'folder' } : this.index.byPath.get(path.slice(1));
    }

    _text(node) { return this.files.get(node.id).get('text'); }

    _children(folderPath) {
        const id = folderPath === '/' ? null : this.index.byPath.get(folderPath.slice(1))?.id;
        if (folderPath !== '/' && !id) return [];
        return this.index.nodes.filter((n) => (n.parent || null) === id);
    }

    _create(kind, path, text = '') {
        const parent = this._node(dirname(path));
        if (!parent) throw fail('ENOENT', path, 'no such file or directory');
        if (parent.kind !== 'folder') throw fail('ENOTDIR', path, 'not a directory');
        const result = createNode(this.files, this.index.nodes, { kind, name: basename(path), parent: parent.id, text });
        this.invalidate();
        if (result.error) throw fail('EINVAL', path, result.error);
    }

    // ---- shared .git storage ------------------------------------------------------------
    _gitIsDir(path) {
        if (this.gitfs.has(`${path}/`)) return true;
        for (const key of this.gitfs.keys()) if (key.startsWith(`${path}/`)) return true;
        return false;
    }

    _gitList(path) {
        const names = new Set();
        const prefix = `${path}/`;
        for (const key of this.gitfs.keys()) {
            if (key.startsWith(prefix) && key.length > prefix.length) names.add(key.slice(prefix.length).split('/')[0]);
        }
        return [...names];
    }

    _gitTotal() {
        let total = 0;
        this.gitfs.forEach((v) => { total += v.length || 0; });
        return total;
    }

    // ---- fs.promises API ------------------------------------------------------------------
    async readFile(path, options) {
        const p = normalize(path);
        const encoding = typeof options === 'string' ? options : options?.encoding;
        let bytes;
        if (isGitPath(p)) {
            const value = this.gitfs.get(p);
            if (value === undefined) throw fail(this._gitIsDir(p) ? 'EISDIR' : 'ENOENT', p, 'no such file or directory');
            bytes = new Uint8Array(value);
        } else {
            const node = this._node(p);
            if (!node) throw fail('ENOENT', p, 'no such file or directory');
            if (node.kind === 'folder') throw fail('EISDIR', p, 'illegal operation on a directory');
            bytes = encoder.encode(this._text(node).toString());
        }
        return encoding ? decoder.decode(bytes) : bytes;
    }

    async writeFile(path, data) {
        const p = normalize(path);
        const bytes = typeof data === 'string' ? encoder.encode(data) : data;
        if (isGitPath(p)) {
            if (bytes.length > MAX_GIT_FILE_BYTES) throw fail('ENOSPC', p, 'repository object too large for a shared room');
            if (this._gitTotal() + bytes.length > MAX_GIT_TOTAL_BYTES) throw fail('ENOSPC', p, 'repository too large for a shared room');
            this.gitfs.set(p, new Uint8Array(bytes));
            return;
        }
        const text = typeof data === 'string' ? data : decoder.decode(bytes);
        const node = this._node(p);
        if (node?.kind === 'folder') throw fail('EISDIR', p, 'illegal operation on a directory');
        if (node) replaceText(this._text(node), text); else this._create('file', p, text);
    }

    async unlink(path) {
        const p = normalize(path);
        if (isGitPath(p)) {
            if (!this.gitfs.has(p)) throw fail('ENOENT', p, 'no such file or directory');
            this.gitfs.delete(p);
            return;
        }
        const node = this._node(p);
        if (!node) throw fail('ENOENT', p, 'no such file or directory');
        if (node.kind === 'folder') throw fail('EISDIR', p, 'illegal operation on a directory');
        deleteNode(this.files, this.index.nodes, node.id);
        this.invalidate();
    }

    async readdir(path) {
        const p = normalize(path);
        if (isGitPath(p)) {
            if (!this._gitIsDir(p)) throw fail(this.gitfs.has(p) ? 'ENOTDIR' : 'ENOENT', p, 'no such file or directory');
            return this._gitList(p).sort();
        }
        const node = this._node(p);
        if (!node) throw fail('ENOENT', p, 'no such file or directory');
        if (node.kind !== 'folder') throw fail('ENOTDIR', p, 'not a directory');
        const names = this._children(p).map((n) => n.name);
        if (this._gitIsDir(p === '/' ? '/.git' : `${p}/.git`)) names.push('.git');
        return names.sort();
    }

    async mkdir(path) {
        const p = normalize(path);
        if (isGitPath(p)) {
            if (this._gitIsDir(p) || this.gitfs.has(p)) throw fail('EEXIST', p, 'file already exists');
            this.gitfs.set(`${p}/`, new Uint8Array(0));
            return;
        }
        if (this._node(p)) throw fail('EEXIST', p, 'file already exists');
        this._create('folder', p);
    }

    async rmdir(path) {
        const p = normalize(path);
        if (isGitPath(p)) {
            if (this._gitList(p).length) throw fail('ENOTEMPTY', p, 'directory not empty');
            this.gitfs.delete(`${p}/`);
            return;
        }
        const node = this._node(p);
        if (!node) throw fail('ENOENT', p, 'no such file or directory');
        if (node.kind !== 'folder') throw fail('ENOTDIR', p, 'not a directory');
        if (this._children(p).length) throw fail('ENOTEMPTY', p, 'directory not empty');
        deleteNode(this.files, this.index.nodes, node.id);
        this.invalidate();
    }

    async stat(path) {
        const p = normalize(path);
        if (isGitPath(p)) {
            const value = this.gitfs.get(p);
            if (value !== undefined) return makeStat('file', value.length);
            if (this._gitIsDir(p)) return makeStat('dir');
            throw fail('ENOENT', p, 'no such file or directory');
        }
        const node = this._node(p);
        if (!node) throw fail('ENOENT', p, 'no such file or directory');
        if (node.kind === 'folder') return makeStat('dir');
        return makeStat('file', encoder.encode(this._text(node).toString()).length);
    }

    lstat(path) { return this.stat(path); }
    async readlink(path) { throw fail('ENOSYS', path, 'symlinks are not supported'); }
    async symlink(target, path) { throw fail('ENOSYS', path, 'symlinks are not supported'); }
    async chmod() {}

    // Forget a repository's stored history (used to clean up after a failed clone).
    purgeGit(dir) {
        const prefix = `${normalize(dir === '/' ? '' : dir)}/.git`;
        this.gitfs.doc.transact(() => {
            [...this.gitfs.keys()].filter((k) => k === `${prefix}/` || k.startsWith(`${prefix}/`)).forEach((k) => this.gitfs.delete(k));
        });
    }

    // ---- helpers for the shell ------------------------------------------------------------
    async exists(path) { try { await this.stat(path); return true; } catch { return false; } }

    async rename(from, to) {
        const a = normalize(from);
        const b = normalize(to);
        const node = this._node(a);
        if (!node || a === '/') throw fail('ENOENT', a, 'no such file or directory');
        const target = this._node(b);
        const parent = this._node(dirname(b));
        if (!parent || parent.kind !== 'folder') throw fail('ENOENT', b, 'no such file or directory');
        if (target?.kind === 'folder' || (target && node.kind === 'folder')) throw fail('EEXIST', b, 'destination exists');
        if (target) deleteNode(this.files, this.index.nodes, target.id);
        this.invalidate();
        const fresh = this.index.nodes;
        const name = basename(b);
        const error = validateName(fresh, parent.id, name, node.id);
        if (error) throw fail('EINVAL', b, error);
        if (parent.id === node.id || (node.kind === 'folder' && b.startsWith(`${a}/`))) throw fail('EINVAL', b, 'cannot move a directory into itself');
        this.files.doc.transact(() => {
            const entry = this.files.get(node.id);
            entry.set('name', name);
            entry.set('parent', parent.id);
            entry.delete('lang');
        });
        this.invalidate();
    }

    async remove(path, { recursive = false } = {}) {
        const p = normalize(path);
        const node = this._node(p);
        if (!node || p === '/') throw fail('ENOENT', p, 'no such file or directory');
        if (node.kind === 'folder' && !recursive) throw fail('EISDIR', p, 'is a directory');
        deleteNode(this.files, this.index.nodes, node.id);
        this.invalidate();
    }

    async list(path) {
        const p = normalize(path);
        const node = this._node(p);
        if (!node) throw fail('ENOENT', p, 'no such file or directory');
        if (node.kind !== 'folder') throw fail('ENOTDIR', p, 'not a directory');
        return this._children(p).map((n) => ({ name: n.name, kind: n.kind }));
    }

    // every file in the working tree: { "src/app.py": "text" }
    snapshot() {
        const out = {};
        this.index.byPath.forEach((node, path) => { if (node.kind === 'file') out[path] = this._text(node).toString(); });
        return out;
    }

    isFile(path) { return this._node(normalize(path))?.kind === 'file'; }
    isDir(path) { return this._node(normalize(path))?.kind === 'folder'; }
}
