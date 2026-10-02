// The project's file tree lives in a Yjs map so it syncs like everything else:
//   files: Y.Map<id, Y.Map{ name, parent: id|null, kind: 'file'|'folder', lang?, text?: Y.Text }>
// Parent links (not paths) make renaming or moving a folder a single write.
import * as Y from 'yjs';
import { v4 as uuid } from 'uuid';
import { getLanguage } from '../languages';

export const MAX_ENTRIES = 100;
export const MAX_DEPTH = 6;

export const readNodes = (files) => {
    const nodes = [];
    files.forEach((entry, id) => nodes.push({
        id,
        name: entry.get('name') || 'untitled',
        parent: entry.get('parent') || null,
        kind: entry.get('kind') || 'file',
        lang: entry.get('lang') || null,
    }));
    return nodes;
};

const byName = (a, b) =>
    (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true });

/**
 * Nested, sorted tree. Concurrent edits can leave orphans (parent deleted) or cycles
 * (two users moving folders into each other); those nodes surface at the root instead of vanishing.
 */
export const buildTree = (nodes) => {
    const ids = new Set(nodes.map((n) => n.id));
    const childrenOf = new Map();
    const place = (node, parent) => {
        if (!childrenOf.has(parent)) childrenOf.set(parent, []);
        childrenOf.get(parent).push(node);
    };
    nodes.forEach((n) => place(n, n.parent && ids.has(n.parent) ? n.parent : null));

    const seen = new Set();
    const walk = (parent) => {
        const kids = (childrenOf.get(parent) || []).filter((k) => !seen.has(k.id)).sort(byName);
        return kids.map((k) => { seen.add(k.id); return { ...k, children: walk(k.id) }; });
    };
    const tree = walk(null);
    // Anything still unseen sits on a cycle: hoist it to the root.
    nodes.filter((n) => !seen.has(n.id)).forEach((n) => {
        if (!seen.has(n.id)) { seen.add(n.id); tree.push({ ...n, parent: null, children: walk(n.id) }); }
    });
    return tree.sort(byName);
};

export const flatten = (tree, depth = 0, out = []) => {
    tree.forEach((n) => { out.push({ ...n, depth }); flatten(n.children, depth + 1, out); });
    return out;
};

// id -> "src/utils/helpers.py" (safe against cycles and missing parents)
export const pathsById = (nodes) => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const paths = {};
    nodes.forEach((n) => {
        const parts = [n.name];
        const visited = new Set([n.id]);
        let cur = byId.get(n.parent);
        while (cur && !visited.has(cur.id)) { visited.add(cur.id); parts.unshift(cur.name); cur = byId.get(cur.parent); }
        paths[n.id] = parts.join('/');
    });
    return paths;
};

export const depthOf = (nodes, id) => (pathsById(nodes)[id] || '').split('/').length;

export const descendantsOf = (nodes, id) => {
    const out = [];
    const walk = (parent) => nodes.filter((n) => n.parent === parent).forEach((n) => {
        if (!out.includes(n.id) && n.id !== id) { out.push(n.id); walk(n.id); }
    });
    walk(id);
    return out;
};

// Resolve "./a/../b.js" relative to the file at fromPath.
export const resolvePath = (fromPath, relative) => {
    const parts = relative.startsWith('/') ? [] : fromPath.split('/').slice(0, -1);
    relative.split('/').forEach((seg) => {
        if (seg === '' || seg === '.') return;
        if (seg === '..') parts.pop();
        else parts.push(seg);
    });
    return parts.join('/');
};

export const validateName = (nodes, parent, name, selfId = null) => {
    if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name) || name.length > 64) {
        return 'Names can’t be empty, contain slashes, or exceed 64 characters';
    }
    const clash = nodes.some((n) => n.id !== selfId && (n.parent || null) === (parent || null) && n.name.toLowerCase() === name.toLowerCase());
    return clash ? `“${name}” already exists here` : null;
};

export const createNode = (files, nodes, { kind, name, parent = null, text = '' }) => {
    const error = validateName(nodes, parent, name)
        || (nodes.length >= MAX_ENTRIES && `A project can hold at most ${MAX_ENTRIES} files and folders`)
        || (parent && depthOf(nodes, parent) >= MAX_DEPTH && `Folders can nest at most ${MAX_DEPTH} levels deep`);
    if (error) return { error };
    const id = uuid().slice(0, 8);
    files.doc.transact(() => {
        const entry = new Y.Map();
        files.set(id, entry);
        entry.set('name', name);
        entry.set('parent', parent);
        entry.set('kind', kind);
        if (kind === 'file') entry.set('text', new Y.Text(text));
    });
    return { id };
};

export const renameNode = (files, nodes, id, name) => {
    const node = nodes.find((n) => n.id === id);
    const error = validateName(nodes, node.parent, name, id);
    if (error) return { error };
    files.doc.transact(() => {
        files.get(id).set('name', name);
        files.get(id).delete('lang'); // let the new extension decide the language again
    });
    return {};
};

export const moveNode = (files, nodes, id, parent) => {
    const node = nodes.find((n) => n.id === id);
    if ((node.parent || null) === (parent || null)) return {};
    if (parent === id || descendantsOf(nodes, id).includes(parent)) return { error: 'A folder can’t be moved into itself' };
    const error = validateName(nodes, parent, node.name, id)
        || (parent && depthOf(nodes, parent) + 1 + Math.max(0, ...descendantsOf(nodes, id).map((d) => depthOf(nodes, d) - depthOf(nodes, id))) > MAX_DEPTH
            && `Folders can nest at most ${MAX_DEPTH} levels deep`);
    if (error) return { error };
    files.get(id).set('parent', parent);
    return {};
};

export const deleteNode = (files, nodes, id) => {
    files.doc.transact(() => {
        [id, ...descendantsOf(nodes, id)].forEach((d) => files.delete(d));
    });
};

export const setLanguage = (files, id, lang) => files.get(id)?.set('lang', lang);

// A brand-new room starts with one file; a room from before multi-file support keeps its old
// code and language. The fixed id means two clients doing this at once converge on one file.
export const initProject = (doc, files, meta, fallbackLanguage) => {
    if (meta.get('initialized') || files.size > 0) return;
    doc.transact(() => {
        const legacy = doc.getText('codemirror').toString();
        const language = meta.get('language') || fallbackLanguage;
        const entry = new Y.Map();
        files.set('main', entry);
        entry.set('name', `main.${getLanguage(language).ext}`);
        entry.set('parent', null);
        entry.set('kind', 'file');
        entry.set('text', new Y.Text(legacy));
        meta.set('initialized', true);
    });
};
