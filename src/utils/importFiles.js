// Bringing files from the user's computer into the shared project: reading dropped folders,
// filtering out what doesn't belong in a code room, and creating the files and folders.
import { createNode, MAX_DEPTH, MAX_ENTRIES } from './fs';
import { extractPdfText, isPdf } from './pdfText';

export const MAX_FILE_BYTES = 500 * 1024;
const MAX_PDF_BYTES = 15 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 3 * 1024 * 1024;
const MAX_SCANNED = 2000; // stop walking enormous folders

const IGNORED_DIRS = new Set([
    'node_modules', '.git', '.svn', '.hg', '__pycache__', '.idea', '.vscode', 'venv', '.venv', 'env',
    'dist', 'build', '.next', '.cache', 'target', 'coverage', '.pytest_cache',
]);
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db']);

const isIgnoredPath = (path) => {
    const parts = path.split('/');
    return IGNORED_FILES.has(parts[parts.length - 1]) || parts.slice(0, -1).some((p) => IGNORED_DIRS.has(p));
};

const call = (fn) => new Promise((resolve, reject) => fn(resolve, reject));

async function walk(entry, prefix, out) {
    if (out.scanned >= MAX_SCANNED) return;
    if (entry.isFile) {
        out.scanned += 1;
        const path = prefix + entry.name;
        if (isIgnoredPath(path)) return;
        out.items.push({ path, file: await call((ok, fail) => entry.file(ok, fail)) });
    } else if (entry.isDirectory && !IGNORED_DIRS.has(entry.name)) {
        const reader = entry.createReader();
        let batch;
        do { // readEntries returns results in chunks until it hands back an empty list
            batch = await call((ok, fail) => reader.readEntries(ok, fail));
            for (const child of batch) await walk(child, `${prefix}${entry.name}/`, out);
        } while (batch.length);
    }
}

// Entries must be read from the drop event synchronously; call this inside the handler.
export const entriesFromDrop = (dataTransfer) =>
    Array.from(dataTransfer.items || [])
        .filter((item) => item.kind === 'file')
        .map((item) => item.webkitGetAsEntry?.())
        .filter(Boolean);

export async function collectFromEntries(entries) {
    const out = { items: [], scanned: 0 };
    for (const entry of entries) await walk(entry, '', out);
    return out.items;
}

// <input type="file"> results; folder pickers expose the path in webkitRelativePath.
export const collectFromInput = (fileList) =>
    Array.from(fileList)
        .map((file) => ({ path: file.webkitRelativePath || file.name, file }))
        .filter(({ path }) => !isIgnoredPath(path))
        .slice(0, MAX_SCANNED);

const looksBinary = async (file) => {
    const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    return head.includes(0);
};

// "app.js" -> "app (2).js" when the name is taken
const uniqueName = (taken, name) => {
    const lower = new Set(taken.map((n) => n.toLowerCase()));
    if (!lower.has(name.toLowerCase())) return name;
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    for (let i = 2; ; i += 1) {
        const candidate = `${stem} (${i})${ext}`;
        if (!lower.has(candidate.toLowerCase())) return candidate;
    }
};

/**
 * Create the picked files (and any folders they sit in) under `parent`.
 * Returns { imported, folders, skipped: [{ path, reason }], firstId }.
 */
export async function importIntoProject(files, nodes, parent, items) {
    const local = [...nodes]; // kept current as we create, since the caller's list is a snapshot
    const skipped = [];
    const summary = { imported: 0, folders: 0, skipped, firstId: null, firstIsDot: false };
    let total = 0;

    const childrenOf = (id) => local.filter((n) => (n.parent || null) === (id || null));
    const folderFor = (segments) => {
        let current = parent;
        for (const name of segments) {
            const existing = childrenOf(current).find((n) => n.kind === 'folder' && n.name.toLowerCase() === name.toLowerCase());
            if (existing) { current = existing.id; continue; }
            const made = createNode(files, local, { kind: 'folder', name, parent: current });
            if (made.error) return { error: made.error };
            local.push({ id: made.id, name, parent: current, kind: 'folder', lang: null });
            summary.folders += 1;
            current = made.id;
        }
        return { id: current };
    };

    for (const { path, file } of items.sort((a, b) => a.path.localeCompare(b.path))) {
        const segments = path.split('/');
        let name = segments.pop();
        const pdf = isPdf(file);
        // A PDF is limited by the text we get out of it, not by its own (often much larger) size.
        let text = null;
        if (pdf) {
            if (file.size > MAX_PDF_BYTES) { skipped.push({ path, reason: 'too large' }); continue; }
            try { text = await extractPdfText(file); } catch { skipped.push({ path, reason: 'unreadable PDF' }); continue; }
            if (!text) { skipped.push({ path, reason: 'PDF has no text (scanned?)' }); continue; }
            name += '.txt';
        }
        const size = pdf ? new Blob([text]).size : file.size;
        if (size > MAX_FILE_BYTES) { skipped.push({ path, reason: 'too large' }); continue; }
        if (total + size > MAX_TOTAL_BYTES) { skipped.push({ path, reason: 'import size limit' }); continue; }
        if (local.length >= MAX_ENTRIES) { skipped.push({ path, reason: 'project is full' }); continue; }
        if (segments.length >= MAX_DEPTH) { skipped.push({ path, reason: 'too deeply nested' }); continue; }
        if (!pdf && await looksBinary(file)) { skipped.push({ path, reason: 'not a text file' }); continue; }

        const folder = folderFor(segments);
        if (folder.error) { skipped.push({ path, reason: folder.error }); continue; }
        const finalName = uniqueName(childrenOf(folder.id).map((n) => n.name), name);
        const made = createNode(files, local, { kind: 'file', name: finalName, parent: folder.id, text: pdf ? text : await file.text() });
        if (made.error) { skipped.push({ path, reason: made.error }); continue; }
        local.push({ id: made.id, name: finalName, parent: folder.id, kind: 'file', lang: null });
        total += size;
        summary.imported += 1;
        // Open something worth reading first, not a dotfile like .gitignore.
        if (!summary.firstId || (summary.firstIsDot && !finalName.startsWith('.'))) {
            summary.firstId = made.id;
            summary.firstIsDot = finalName.startsWith('.');
        }
    }
    return summary;
}

export const describeImport = ({ imported, folders, skipped }) => {
    const parts = [];
    if (imported) parts.push(`Imported ${imported} file${imported === 1 ? '' : 's'}${folders ? ` in ${folders} folder${folders === 1 ? '' : 's'}` : ''}`);
    if (skipped.length) {
        const reasons = [...new Set(skipped.map((s) => s.reason))].join(', ');
        parts.push(`skipped ${skipped.length} (${reasons})`);
    }
    return parts.length ? parts.join(' · ') : 'Nothing to import';
};
