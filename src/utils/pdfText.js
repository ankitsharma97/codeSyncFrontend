// PDFs are binary, so they can't live in the shared text project as-is. We pull their text out in
// the browser instead. pdf.js is loaded on first use so it stays out of the main bundle.
export const MAX_PDF_PAGES = 200;

export const isPdf = (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf';

export async function extractPdfText(file) {
    const pdfjs = await import('pdfjs-dist/build/pdf');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.js', import.meta.url).toString();

    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    try {
        const pages = [];
        for (let n = 1; n <= Math.min(pdf.numPages, MAX_PDF_PAGES); n += 1) {
            const content = await (await pdf.getPage(n)).getTextContent();
            let text = '';
            for (const item of content.items) text += item.str + (item.hasEOL ? '\n' : '');
            pages.push(text.trim());
        }
        return pages.join('\n\n').trim();
    } finally {
        pdf.destroy();
    }
}
