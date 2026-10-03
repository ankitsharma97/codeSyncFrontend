import React, { useEffect, useMemo, useRef } from 'react';
import '@xterm/xterm/css/xterm.css';
import { ProjectFs } from '../terminal/projectFs';
import { createShell } from '../terminal/shell';
import { attachLineEditor } from '../terminal/lineEditor';
import { c } from '../terminal/ansi';

const THEME = {
    background: '#1a1b24', foreground: '#f8f8f2', cursor: '#19c6f0', cursorAccent: '#1a1b24',
    selectionBackground: '#44475a',
    black: '#21222c', red: '#ff6e6e', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9',
    magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
    brightBlack: '#6272a4', brightRed: '#ff8f8f', brightGreen: '#69ff94', brightYellow: '#ffffa5',
    brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff',
};

// The screen is private to each person; the files and git history it works on are shared.
function TerminalPanel({ files, gitfs, username, visible, onOpenFile, onOpenDocs, onDownload, height }) {
    const host = useRef(null);
    const fitRef = useRef(null);
    const termRef = useRef(null);
    const openRef = useRef(onOpenFile);
    openRef.current = onOpenFile;
    const docsRef = useRef(onOpenDocs);
    docsRef.current = onOpenDocs;
    const downloadRef = useRef(onDownload);
    downloadRef.current = onDownload;
    const fs = useMemo(() => new ProjectFs(files, gitfs), [files, gitfs]);

    useEffect(() => {
        let disposed = false;
        let cleanup = () => {};
        (async () => {
            const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);
            if (disposed) return;
            const term = new Terminal({
                theme: THEME,
                fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace",
                fontSize: 13,
                lineHeight: 1.35,
                cursorBlink: true,
                scrollback: 3000,
                allowProposedApi: true,
            });
            const fit = new FitAddon();
            term.loadAddon(fit);
            term.open(host.current);
            fit.fit();
            termRef.current = term;
            fitRef.current = fit;

            const shell = createShell({
                fs,
                user: username,
                hooks: { openFile: (path) => openRef.current?.(path), openDocs: (section) => docsRef.current?.(section), download: (withGit) => downloadRef.current?.(withGit) },
            });
            term.write(`${c.bold('CodeWithFriend terminal')}  ${c.dim('— type')} help ${c.dim('for commands,')} git help ${c.dim('for git, or')} docs ${c.dim('for the guide')}\r\n`);
            term.write(`${c.dim('Files and git history are shared with this room; this screen is just yours.')}\r\n\r\n`);
            const editor = attachLineEditor(term, shell);

            const observer = new ResizeObserver(() => { try { fit.fit(); editor.redraw(); } catch { /* hidden */ } });
            observer.observe(host.current);
            cleanup = () => { observer.disconnect(); editor.dispose(); term.dispose(); };
        })();
        return () => { disposed = true; cleanup(); termRef.current = null; };
    }, [fs, username]);

    // Re-fit and focus whenever the tab is shown or the dock is resized.
    useEffect(() => {
        if (!visible) return;
        const id = requestAnimationFrame(() => {
            try { fitRef.current?.fit(); termRef.current?.focus(); } catch { /* not ready yet */ }
        });
        return () => cancelAnimationFrame(id);
    }, [visible, height]);

    return <div className="termHost" ref={host} onClick={() => termRef.current?.focus()} />;
}

export default TerminalPanel;
