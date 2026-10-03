// Export the shared project as a .zip, built entirely in the browser (nothing is uploaded).
import { pathsById, readNodes } from './fs';

const EMPTY = new Uint8Array(0);

/**
 * Collect the project into a zip. Folders (even empty ones) are kept, and with includeGit the
 * repository's internal files go in as a real `.git` folder, so the unzipped project is a normal
 * git repository with its history.
 */
export async function buildZip({ files, gitfs, root, includeGit }) {
    const { zipSync, strToU8 } = await import('fflate'); // loaded only when someone downloads
    const nodes = readNodes(files);
    const paths = pathsById(nodes);
    const mtime = new Date();
    const entries = {};
    let fileCount = 0;

    nodes.forEach((n) => {
        const path = `${root}/${paths[n.id]}`;
        if (n.kind === 'folder') {
            entries[`${path}/`] = [EMPTY, { level: 0, mtime }];
        } else {
            entries[path] = [strToU8(files.get(n.id).get('text').toString()), { level: 6, mtime }];
            fileCount += 1;
        }
    });

    let gitCount = 0;
    if (includeGit) {
        gitfs.forEach((value, key) => {
            const path = `${root}${key}`; // keys are absolute: "/.git/HEAD"
            if (key.endsWith('/')) { entries[path] = [EMPTY, { level: 0, mtime }]; return; } // an (empty) directory
            // git objects are already deflated, so storing them uncompressed is faster and no bigger
            entries[path] = [new Uint8Array(value), { level: key.includes('/objects/') ? 0 : 6, mtime }];
            gitCount += 1;
        });
    }

    return { data: zipSync(entries), fileCount, gitCount };
}

export function saveFile(data, filename) {
    const url = URL.createObjectURL(new Blob([data], { type: 'application/zip' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}
