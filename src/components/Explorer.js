import React, { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FiChevronRight, FiFilePlus, FiFolderPlus, FiFolder, FiEdit2, FiTrash2, FiUpload, FiDownload } from 'react-icons/fi';
import { badgeFor, detectLanguage } from '../languages';
import { buildTree } from '../utils/fs';
import { collectFromEntries, collectFromInput, describeImport, entriesFromDrop } from '../utils/importFiles';

// Inline text box used for both "new file/folder" and "rename".
function NameInput({ initial = '', onSubmit, onCancel }) {
    const input = useRef(null);
    const done = useRef(false);

    useEffect(() => {
        input.current.focus();
        // Select just the base name so typing keeps the extension.
        const dot = initial.lastIndexOf('.');
        input.current.setSelectionRange(0, dot > 0 ? dot : initial.length);
    }, [initial]);

    const finish = (commit) => {
        if (done.current) return;
        done.current = true;
        const value = input.current.value.trim();
        if (commit && value && value !== initial) onSubmit(value); else onCancel();
    };

    return (
        <input
            ref={input}
            className="nameInput"
            defaultValue={initial}
            maxLength={64}
            spellCheck={false}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
                if (e.key === 'Enter') finish(true);
                if (e.key === 'Escape') finish(false);
            }}
            onBlur={() => finish(true)}
        />
    );
}

function FileBadge({ name }) {
    const [label, color] = badgeFor(detectLanguage(name));
    return <span className="fileBadge" style={{ color }}>{label}</span>;
}

function Explorer({ nodes, activeId, users, selfClientId, actions, onOpen, hasGit, onDownload }) {
    const [collapsed, setCollapsed] = useState(() => new Set());
    const [editing, setEditing] = useState(null); // { mode: 'create', kind, parent } | { mode: 'rename', id }
    const [target, setTarget] = useState(null); // folder that header "new" buttons create into
    const [dropOn, setDropOn] = useState(undefined); // folder id, null for root, undefined for none
    const [uploadMenu, setUploadMenu] = useState(false);
    const [downloadMenu, setDownloadMenu] = useState(false);
    const downloadBox = useRef(null);
    const dragging = useRef(null);
    const fileInput = useRef(null);
    const dirInput = useRef(null);
    const menuBox = useRef(null);

    useEffect(() => {
        if (!uploadMenu) return;
        const close = (e) => { if (!menuBox.current?.contains(e.target)) setUploadMenu(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [uploadMenu]);

    useEffect(() => {
        if (!downloadMenu) return;
        const close = (e) => { if (!downloadBox.current?.contains(e.target)) setDownloadMenu(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [downloadMenu]);

    const exists = (id) => nodes.some((n) => n.id === id);
    const targetId = target && exists(target) ? target : null;
    const tree = buildTree(nodes);

    const toggle = (id) => setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const startCreate = (kind, parent) => {
        if (parent) setCollapsed((prev) => { const next = new Set(prev); next.delete(parent); return next; });
        setEditing({ mode: 'create', kind, parent });
    };

    const report = (result) => { if (result?.error) toast.error(result.error); return result; };

    const submitCreate = (name) => {
        const { kind, parent } = editing;
        setEditing(null);
        const result = report(actions.create({ kind, name, parent }));
        if (result?.id && kind === 'file') onOpen(result.id);
    };

    const submitRename = (name) => {
        const { id } = editing;
        setEditing(null);
        report(actions.rename(id, name));
    };

    const remove = (node) => {
        const what = node.kind === 'folder' ? `“${node.name}” and everything inside it` : `“${node.name}”`;
        if (window.confirm(`Delete ${what} for everyone in this room?`)) actions.remove(node.id);
    };

    // Read the picked files, create them in the project, and say what happened.
    const upload = async (collect, parent) => {
        if (parent) setCollapsed((prev) => { const next = new Set(prev); next.delete(parent); return next; });
        const toastId = toast.loading('Reading files…');
        try {
            const items = await collect();
            if (!items.length) { toast('Nothing to import', { id: toastId }); return; }
            toast.loading(`Importing ${items.length} file${items.length === 1 ? '' : 's'}…`, { id: toastId });
            const summary = await actions.importFiles(items, parent);
            const message = describeImport(summary);
            if (summary.imported) toast.success(message, { id: toastId, duration: 4500 }); else toast.error(message, { id: toastId });
            if (summary.firstId) onOpen(summary.firstId);
        } catch (error) {
            console.error('Import failed:', error);
            toast.error('Could not import those files', { id: toastId });
        }
    };

    const dropInto = (e, parent) => {
        e.preventDefault();
        e.stopPropagation();
        const id = dragging.current;
        dragging.current = null;
        setDropOn(undefined);
        if (id) { report(actions.move(id, parent)); return; }
        if (e.dataTransfer.types?.includes('Files')) {
            const entries = entriesFromDrop(e.dataTransfer); // must be read synchronously
            const fallback = collectFromInput(e.dataTransfer.files);
            upload(() => (entries.length ? collectFromEntries(entries) : Promise.resolve(fallback)), parent);
        }
    };

    const pick = (e, parent) => {
        const picked = collectFromInput(e.target.files);
        e.target.value = '';
        setUploadMenu(false);
        upload(() => Promise.resolve(picked), parent);
    };

    const createRow = (parent, depth) => (
        <div className="treeRow editingRow" style={{ paddingLeft: depth * 14 + 10 }} key="__create">
            <span className="chev" />
            {editing.kind === 'folder' ? <FiFolder className="folderIcon" /> : <span className="fileBadge">+</span>}
            <NameInput onSubmit={submitCreate} onCancel={() => setEditing(null)} />
        </div>
    );

    const renderNodes = (list, depth, parent) => {
        const rows = list.map((node) => {
            const isFolder = node.kind === 'folder';
            const open = !collapsed.has(node.id);
            const here = users.filter((u) => u.file === node.id && u.clientId !== selfClientId);
            const renaming = editing?.mode === 'rename' && editing.id === node.id;
            return (
                <React.Fragment key={node.id}>
                    <div
                        className={`treeRow ${node.id === activeId ? 'active' : ''} ${isFolder && dropOn === node.id ? 'dropTarget' : ''}`}
                        style={{ paddingLeft: depth * 14 + 10 }}
                        role="treeitem"
                        aria-selected={node.id === activeId}
                        aria-expanded={isFolder ? open : undefined}
                        tabIndex={0}
                        draggable={!renaming}
                        onDragStart={(e) => { dragging.current = node.id; e.dataTransfer.effectAllowed = 'move'; }}
                        onDragEnd={() => { dragging.current = null; setDropOn(undefined); }}
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropOn(isFolder ? node.id : node.parent || null); }}
                        onDrop={(e) => dropInto(e, isFolder ? node.id : node.parent || null)}
                        onClick={() => {
                            if (isFolder) { toggle(node.id); setTarget(node.id); } else { setTarget(node.parent); onOpen(node.id); }
                        }}
                        onDoubleClick={() => setEditing({ mode: 'rename', id: node.id })}
                        onKeyDown={(e) => {
                            if (e.target !== e.currentTarget) return;
                            if (e.key === 'Enter') e.currentTarget.click();
                            if (e.key === 'F2') setEditing({ mode: 'rename', id: node.id });
                            if (e.key === 'Delete') remove(node);
                        }}
                    >
                        <span className={`chev ${isFolder && open ? 'open' : ''}`}>{isFolder && <FiChevronRight />}</span>
                        {isFolder ? <FiFolder className="folderIcon" /> : <FileBadge name={node.name} />}
                        {renaming
                            ? <NameInput initial={node.name} onSubmit={submitRename} onCancel={() => setEditing(null)} />
                            : <span className="treeName">{node.name}</span>}
                        {!renaming && here.length > 0 && (
                            <span className="presence" title={here.map((u) => u.name).join(', ')}>
                                {here.slice(0, 3).map((u) => <i key={u.clientId} style={{ background: u.color }} />)}
                            </span>
                        )}
                        {!renaming && (
                            <span className="rowActions" onClick={(e) => e.stopPropagation()}>
                                {isFolder && <button className="iconBtn" aria-label="New file in folder" onClick={() => startCreate('file', node.id)}><FiFilePlus /></button>}
                                {isFolder && <button className="iconBtn" aria-label="New folder in folder" onClick={() => startCreate('folder', node.id)}><FiFolderPlus /></button>}
                                <button className="iconBtn" aria-label={`Rename ${node.name}`} onClick={() => setEditing({ mode: 'rename', id: node.id })}><FiEdit2 /></button>
                                <button className="iconBtn" aria-label={`Delete ${node.name}`} onClick={() => remove(node)}><FiTrash2 /></button>
                            </span>
                        )}
                    </div>
                    {isFolder && open && (
                        <>
                            {editing?.mode === 'create' && editing.parent === node.id && createRow(node.id, depth + 1)}
                            {renderNodes(node.children, depth + 1, node.id)}
                        </>
                    )}
                </React.Fragment>
            );
        });
        return rows;
    };

    return (
        <div className="explorerInner">
            <div className="explorerHead">
                <span className="dockTitle">Files</span>
                <span className="spacer" />
                <button className="iconBtn" aria-label="New file" title="New file" onClick={() => startCreate('file', targetId)}><FiFilePlus /></button>
                <button className="iconBtn" aria-label="New folder" title="New folder" onClick={() => startCreate('folder', targetId)}><FiFolderPlus /></button>
                <span className="uploadWrap" ref={menuBox}>
                    <button className="iconBtn" aria-label="Upload" title="Upload from your computer" onClick={() => setUploadMenu(!uploadMenu)}><FiUpload /></button>
                    {uploadMenu && (
                        <div className="menu">
                            <button onClick={() => fileInput.current.click()}>Upload files…</button>
                            <button onClick={() => dirInput.current.click()}>Upload folder…</button>
                        </div>
                    )}
                </span>
                <span className="uploadWrap" ref={downloadBox}>
                    <button
                        className="iconBtn"
                        aria-label="Download project as zip"
                        title="Download as .zip"
                        onClick={() => (hasGit() ? setDownloadMenu(!downloadMenu) : onDownload(false))}
                    >
                        <FiDownload />
                    </button>
                    {downloadMenu && (
                        <div className="menu">
                            <button onClick={() => { setDownloadMenu(false); onDownload(false); }}>Project files (.zip)</button>
                            <button onClick={() => { setDownloadMenu(false); onDownload(true); }}>Files + git history (.zip)</button>
                        </div>
                    )}
                </span>
                <input ref={fileInput} type="file" multiple hidden onChange={(e) => pick(e, targetId)} />
                <input ref={dirInput} type="file" multiple hidden webkitdirectory="" directory="" onChange={(e) => pick(e, targetId)} />
            </div>
            <div
                className={`tree ${dropOn === null ? 'dropTarget' : ''}`}
                role="tree"
                onClick={() => setTarget(null)}
                onDragOver={(e) => { e.preventDefault(); setDropOn(null); }}
                onDragLeave={(e) => { if (e.currentTarget === e.target) setDropOn(undefined); }}
                onDrop={(e) => dropInto(e, null)}
            >
                {editing?.mode === 'create' && editing.parent === null && createRow(null, 0)}
                {renderNodes(tree, 0, null)}
                {nodes.length === 0 && !editing && <p className="treeEmpty">No files yet.<br />Create one with the buttons above.</p>}
                <p className="dropHint"><FiUpload /> Drop files or a folder here to import</p>
            </div>
        </div>
    );
}

export default Explorer;
