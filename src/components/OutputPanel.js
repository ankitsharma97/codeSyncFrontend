import React, { useEffect, useRef, useState } from 'react';
import { FiTerminal, FiTrash2, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { renderError, renderMarkdown } from '../utils/markdown';
import { bundleHtml } from '../utils/bundleHtml';

const MIN = 120;

/**
 * Bottom dock with a draggable edge and tabs. Each tab's content stays mounted (the caller hides
 * the inactive ones), so a terminal session survives switching to Output and back.
 */
export function Dock({ tabs, active, onTab, meta, actions, collapsed, onToggle, tall, onHeight, children }) {
    const [height, setHeight] = useState(() => Math.round(window.innerHeight * 0.38));
    const drag = useRef(null);

    // Reading previews wants more room than watching a console.
    useEffect(() => {
        if (tall) setHeight((h) => Math.max(h, Math.round(window.innerHeight * 0.45)));
    }, [tall]);

    useEffect(() => { onHeight?.(height); }, [height, onHeight]);

    useEffect(() => {
        const move = (e) => {
            if (!drag.current) return;
            const next = drag.current.height + (drag.current.y - e.clientY);
            setHeight(Math.max(MIN, Math.min(next, window.innerHeight * 0.75)));
        };
        const stop = () => { drag.current = null; document.body.classList.remove('resizing'); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop);
        return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    }, []);

    const startDrag = (e) => {
        drag.current = { y: e.clientY, height };
        document.body.classList.add('resizing');
    };

    return (
        <section className="dock" style={collapsed ? undefined : { height }}>
            {!collapsed && <div className="dockHandle" onPointerDown={startDrag} role="separator" aria-orientation="horizontal" />}
            <header className="dockHeader">
                <div className="dockTabs" role="tablist">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            role="tab"
                            aria-selected={tab.id === active}
                            className={`dockTab ${tab.id === active ? 'active' : ''}`}
                            onClick={() => { onTab(tab.id); if (collapsed) onToggle(); }}
                        >
                            {tab.id === 'terminal' && <FiTerminal />} {tab.label}
                        </button>
                    ))}
                </div>
                {meta}
                <span className="spacer" />
                {actions}
                <button className="iconBtn" onClick={onToggle} aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}>
                    {collapsed ? <FiChevronUp /> : <FiChevronDown />}
                </button>
            </header>
            <div className="dockBody" hidden={collapsed}>{children}</div>
        </section>
    );
}

const describe = (run) => {
    if (run.timedOut) return { tone: 'bad', text: 'Timed out' };
    if (run.stderr) return { tone: 'bad', text: 'Finished with errors' };
    return { tone: 'good', text: 'Finished' };
};

// Header chips and the clear button for the Output tab.
export function consoleChrome({ run, localStatus, me, onClear }) {
    const running = run.status === 'running';
    const who = run.by === me ? 'You' : run.by;
    let meta = null;
    if (running) {
        meta = <span className="chip warn"><i className="spinner" />{localStatus === 'loading' ? 'Loading Python runtime…' : `${who} ${who === 'You' ? 'are' : 'is'} running…`}</span>;
    } else if (run.status === 'done') {
        const d = describe(run);
        meta = <><span className={`chip ${d.tone}`}>{d.text}</span><span className="runMeta">{who} · {run.ms} ms</span></>;
    }
    const actions = run.status === 'done' && <button className="iconBtn" onClick={onClear} aria-label="Clear output"><FiTrash2 /></button>;
    return { meta, actions };
}

export function ConsoleBody({ run, canRun }) {
    const body = useRef(null);
    useEffect(() => { if (body.current) body.current.scrollTop = body.current.scrollHeight; }, [run.at, run.status]);
    const running = run.status === 'running';

    return (
        <div className="console" ref={body}>
            {run.status === 'done' && (
                <>
                    {run.stdout && <pre className="out">{run.stdout}</pre>}
                    {run.stderr && <pre className="err">{run.stderr}</pre>}
                    {!run.stdout && !run.stderr && <p className="muted">Program finished with no output.</p>}
                </>
            )}
            {run.status !== 'done' && !running && (
                <div className="emptyState">
                    {canRun ? (
                        <><p>Press <kbd>Run</kbd> or <kbd>⌘</kbd> <kbd>Enter</kbd> to execute.</p><p className="muted">Output is shared with everyone in the room.</p></>
                    ) : (
                        <><p>Running is available for <b>JavaScript</b> and <b>Python</b>.</p><p className="muted">Switch the language, or use HTML for a live preview.</p></>
                    )}
                </div>
            )}
        </div>
    );
}

export function PreviewBody({ ytext, files, language, entryPath, readFile }) {
    const [doc, setDoc] = useState(null);
    const readRef = useRef(readFile);
    readRef.current = readFile;

    // Re-render shortly after the last edit to this file or to any file it pulls in.
    useEffect(() => {
        let timer;
        let stale = false;
        const render = async () => {
            let next;
            try {
                const source = ytext.toString();
                next = language === 'markdown' ? await renderMarkdown(source) : bundleHtml(source, entryPath, readRef.current);
            } catch (error) {
                console.error('Preview failed:', error);
                next = renderError(error?.message?.includes('chunk') || error?.name === 'ChunkLoadError'
                    ? 'The renderer failed to load. Reload the page and try again.'
                    : 'Something in this file could not be rendered.');
            }
            if (!stale) setDoc(next);
        };
        setDoc(null);
        const schedule = () => { clearTimeout(timer); timer = setTimeout(render, 350); };
        render();
        ytext.observe(schedule);
        files.observeDeep(schedule);
        return () => { stale = true; clearTimeout(timer); ytext.unobserve(schedule); files.unobserveDeep(schedule); };
    }, [ytext, files, language, entryPath]);

    // Opaque origin, isolated from the app. Markdown is also sanitized and gets no scripts at all.
    const sandbox = language === 'markdown' ? 'allow-popups allow-popups-to-escape-sandbox' : 'allow-scripts';

    // Until the first render lands, show the dock's own colour rather than a white flash.
    return <iframe className={`preview ${doc == null ? 'pending' : ''}`} title="Preview" sandbox={sandbox} srcDoc={doc ?? ''} />;
}
