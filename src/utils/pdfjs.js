// PDFs are stored in the project as-is; pdf.js (loaded on first use, so it stays out of the main
// bundle) draws them in the viewer.
export const isPdf = (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf';

let loading;
export const loadPdfjs = () => {
    loading = loading || import('pdfjs-dist/build/pdf').then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.js', import.meta.url).toString();
        return pdfjs;
    });
    return loading;
};
