import React, { useEffect, useRef } from 'react';
import { FiArrowLeft, FiArrowRight } from 'react-icons/fi';
import { SECTIONS, findSection } from '../docs/sections';

// The guide itself: a section list plus the chosen section. Used in the room (as a dialog) and on /docs.
export function DocsContent({ sectionId, onSection }) {
    const section = findSection(sectionId);
    const index = SECTIONS.indexOf(section);
    const prev = SECTIONS[index - 1];
    const next = SECTIONS[index + 1];
    const scroller = useRef(null);

    useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [section.id]);

    return (
        <div className="docs">
            <nav className="docsNav" aria-label="Guide sections">
                {SECTIONS.map((s) => (
                    <button key={s.id} className={`docsNavItem ${s.id === section.id ? 'active' : ''}`} onClick={() => onSection(s.id)} aria-current={s.id === section.id ? 'page' : undefined}>
                        {s.icon}<span>{s.title}</span>
                    </button>
                ))}
            </nav>
            <article className="docsBody" ref={scroller}>
                <h2>{section.title}</h2>
                {section.body}
                <div className="docsPager">
                    {prev ? <button onClick={() => onSection(prev.id)}><FiArrowLeft /> {prev.title}</button> : <span />}
                    {next ? <button onClick={() => onSection(next.id)}>{next.title} <FiArrowRight /></button> : <span />}
                </div>
            </article>
        </div>
    );
}

export function DocsDialog({ section, onSection, onClose }) {
    const close = useRef(null);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        close.current?.focus();
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div className="docsScrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="docsDialog" role="dialog" aria-modal="true" aria-label="Guide">
                <header className="docsHead">
                    <b>Guide</b>
                    <a href="/docs" target="_blank" rel="noreferrer" className="docsOpen">Open in a new tab</a>
                    <span className="spacer" />
                    <button ref={close} className="iconBtn" onClick={onClose} aria-label="Close guide">✕</button>
                </header>
                <DocsContent sectionId={section} onSection={onSection} />
            </div>
        </div>
    );
}
