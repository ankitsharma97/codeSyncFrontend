import React, { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { keymap, placeholder } from '@codemirror/view';
import { Compartment } from '@codemirror/state';
import { dracula } from '@uiw/codemirror-theme-dracula';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { getLanguage } from '../languages';

const layout = EditorView.theme({
    '&': { height: '100%' },
    '.cm-scroller': { fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace", fontSize: '14px', lineHeight: '1.65' },
    '.cm-gutters': { border: 'none' },
    '.cm-content': { padding: '14px 0' },
    '&.cm-focused': { outline: 'none' },
});

function Editor({ ytext, awareness, language, onRun }) {
    const parent = useRef(null);
    const view = useRef(null);
    const languageSlot = useRef(new Compartment());
    const runRef = useRef(onRun);
    runRef.current = onRun;

    useEffect(() => {
        if (!ytext) return;
        const editor = new EditorView({
            doc: ytext.toString(),
            extensions: [
                // Yjs-aware undo must win over the default history bindings.
                keymap.of(yUndoManagerKeymap),
                keymap.of([{ key: 'Mod-Enter', run: () => { runRef.current(); return true; } }]),
                basicSetup,
                languageSlot.current.of([]),
                dracula,
                layout,
                placeholder('Start typing — everyone in this room sees it live.'),
                yCollab(ytext, awareness),
            ],
            parent: parent.current,
        });
        view.current = editor;
        return () => { editor.destroy(); view.current = null; };
    }, [ytext, awareness]);

    // Language changes are shared through the doc; swap syntax support without touching the text.
    useEffect(() => {
        let stale = false;
        getLanguage(language).load().then((extension) => {
            if (!stale && view.current) view.current.dispatch({ effects: languageSlot.current.reconfigure(extension) });
        }).catch((error) => {
            // Highlighting is optional; the editor stays usable as plain text if its chunk can't load.
            console.warn('Could not load syntax support:', error);
        });
        return () => { stale = true; };
    }, [language, ytext]);

    return <div className="editor" ref={parent}></div>;
}

export default Editor;
