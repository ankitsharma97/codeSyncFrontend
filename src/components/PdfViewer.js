import React, { useEffect, useRef, useState } from 'react';
import { FiDownload } from 'react-icons/fi';
import { readBinary } from '../utils/fs';
import { loadPdfjs } from '../utils/pdfjs';

// One page, drawn only once it scrolls near the viewport and redrawn when the width changes.
function Page({ pdf, number, size, width }) {
    const holder = useRef(null);
    const canvas = useRef(null);
    const [near, setNear] = useState(false);
    const height = Math.round((width * size.height) / size.width);

    useEffect(() => {
        const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: '600px 0px' });
        observer.observe(holder.current);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!near || !width) return undefined;
        let task;
        let stale = false;
        pdf.getPage(number).then((page) => {
            if (stale) return;
            const ratio = window.devicePixelRatio || 1;
            const viewport = page.getViewport({ scale: (width / size.width) * ratio });
            const el = canvas.current;
            el.width = Math.floor(viewport.width);
            el.height = Math.floor(viewport.height);
            task = page.render({ canvasContext: el.getContext('2d'), viewport });
            task.promise.catch(() => {}); // a cancelled render rejects; that is expected
        });
        return () => { stale = true; task?.cancel(); };
    }, [pdf, number, near, width, size]);

    return (
        <div ref={holder} className="pdfPage" style={{ width, height }}>
            <canvas ref={canvas} style={{ width, height }} />
        </div>
    );
}

function PdfViewer({ entry, name }) {
    const scroller = useRef(null);
    const [pdf, setPdf] = useState(null);
    const [sizes, setSizes] = useState([]);
    const [width, setWidth] = useState(0);
    const [error, setError] = useState(null);
    const [version, setVersion] = useState(0); // bumps as chunks arrive, so we retry until it is complete

    useEffect(() => {
        const chunks = entry.get('chunks');
        const bump = () => setVersion((v) => v + 1);
        chunks.observe(bump);
        return () => chunks.unobserve(bump);
    }, [entry]);

    useEffect(() => {
        const bytes = readBinary(entry);
        if (!bytes) return undefined; // still syncing
        let stale = false;
        let doc;
        setError(null);
        loadPdfjs()
            .then((pdfjs) => pdfjs.getDocument({ data: bytes.slice() }).promise)
            .then(async (loaded) => {
                doc = loaded;
                // Page sizes up front, so the scrollbar is right before anything is drawn.
                const pages = await Promise.all(Array.from({ length: loaded.numPages }, async (_, i) => {
                    const v = (await loaded.getPage(i + 1)).getViewport({ scale: 1 });
                    return { width: v.width, height: v.height };
                }));
                if (stale) { loaded.destroy(); return; }
                setSizes(pages);
                setPdf(loaded);
            })
            .catch((e) => { if (!stale) { console.error('PDF failed:', e); setError('This PDF could not be displayed.'); } });
        return () => { stale = true; setPdf(null); setSizes([]); doc?.destroy(); };
    }, [entry, version]);

    // Fit pages to the available width, with a little margin.
    useEffect(() => {
        const el = scroller.current;
        const fit = () => setWidth(Math.max(0, Math.min(el.clientWidth - 24, 1000)));
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const download = () => {
        const bytes = readBinary(entry);
        if (!bytes) return;
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    };

    return (
        <div className="pdfViewer">
            <div className="pdfBar">
                <span className="pdfName">{name}</span>
                {pdf && <span className="muted">{pdf.numPages} page{pdf.numPages === 1 ? '' : 's'}</span>}
                <span className="spacer" />
                <button className="btn ghost" onClick={download} aria-label="Download PDF"><FiDownload /> <span className="label">Download</span></button>
            </div>
            <div className="pdfScroll" ref={scroller}>
                {error && <p className="muted pdfMsg">{error}</p>}
                {!error && !pdf && <p className="muted pdfMsg">Loading PDF…</p>}
                {pdf && sizes.map((size, i) => <Page key={i} pdf={pdf} number={i + 1} size={size} width={width} />)}
            </div>
        </div>
    );
}

export default PdfViewer;
