import React, { useEffect, useRef, useState } from 'react';
import { renderMarkdown } from '../utils/markdown';
import { FiTerminal, FiTrash2, FiChevronDown, FiChevronUp } from 'react-icons/fi';

const MIN = 120;

// Bottom dock with a draggable edge. `title` and `actions` are supplied by the caller.
function Dock({ title, meta, actions, collapsed, onToggle, tall, children }) {
    const [height, setHeight] = useState(() => Math.round(window.innerHeight * (tall ? 0.45 : 0.3)));
    const drag = useRef(null);

    useEffect(() => {
        const move = (e) => {
            if (!drag.current) return;
            const next = drag.current.height + (drag.current.y - e.clientY);
            setHeight(Math.max(MIN, Math.min(next, window.innerHeight * 0.7)));
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
                <span className="dockTitle"><FiTerminal /> {title}</span>
                {meta}
                <span className="spacer" />
                {actions}
                <button className="iconBtn" onClick={onToggle} aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}>
                    {collapsed ? <FiChevronUp /> : <FiChevronDown />}
                </button>
            </header>
            {!collapsed && <div className="dockBody">{children}</div>}
        </section>
    );
}

const describe = (run) => {
    if (run.timedOut) return { tone: 'bad', text: 'Timed out' };
    if (run.stderr) return { tone: 'bad', text: 'Finished with errors' };
    return { tone: 'good', text: 'Finished' };
};

export function ConsolePanel({ run, localStatus, canRun, collapsed, onToggle, onClear, me }) {
    const body = useRef(null);
    useEffect(() => { if (body.current) body.current.scrollTop = body.current.scrollHeight; }, [run.at, run.status]);

    const running = run.status === 'running';
    const who = run.by === me ? 'You' : run.by;
    let meta = null;
    if (running) {
        meta = <span className="chip warn"><i className="spinner" />{localStatus === 'loading' ? 'Loading Python runtime…' : `${who} ${who === 'You' ? 'are' : 'is'} running…`}</span>;
    } else if (run.status === 'done') {
        const d = describe(run);
        meta = <><span className={`chip ${d.tone}`}>{d.text}</span><span className="runMeta">{who} · {run.ms} ms</span></>;
    }

    return (
        <Dock
            title="Output"
            meta={meta}
            collapsed={collapsed}
            onToggle={onToggle}
            actions={run.status === 'done' && <button className="iconBtn" onClick={onClear} aria-label="Clear output"><FiTrash2 /></button>}
        >
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
        </Dock>
    );
}

export function PreviewPanel({ ytext, language, collapsed, onToggle }) {
    const [doc, setDoc] = useState('');

    // Re-render shortly after the last edit; works for both HTML and Markdown.
    useEffect(() => {
        let timer;
        let stale = false;
        const render = async () => {
            const source = ytext.toString();
            const next = language === 'markdown' ? await renderMarkdown(source) : source;
            if (!stale) setDoc(next);
        };
        const schedule = () => { clearTimeout(timer); timer = setTimeout(render, 350); };
        render();
        ytext.observe(schedule);
        return () => { stale = true; clearTimeout(timer); ytext.unobserve(schedule); };
    }, [ytext, language]);

    // Opaque origin, isolated from the app. Markdown is also sanitized and gets no scripts at all.
    const sandbox = language === 'markdown' ? 'allow-popups allow-popups-to-escape-sandbox' : 'allow-scripts';

    return (
        <Dock tall title={language === 'markdown' ? 'Markdown preview' : 'Live preview'} collapsed={collapsed} onToggle={onToggle}>
            <iframe className="preview" title="Preview" sandbox={sandbox} srcDoc={doc} />
        </Dock>
    );
}
