// Markdown -> sanitized HTML document for the sandboxed preview frame.
// marked and DOMPurify load on first use, so they stay out of the main bundle.
const STYLE = `
  body { margin: 0; padding: 20px 24px 40px; background: #1a1b24; color: #e6e6ef;
         font: 15px/1.7 Inter, -apple-system, 'Segoe UI', sans-serif; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 1.4em 0 .5em; font-weight: 650; }
  h1 { font-size: 1.9em; padding-bottom: .3em; border-bottom: 1px solid #343746; }
  h2 { font-size: 1.5em; padding-bottom: .25em; border-bottom: 1px solid #343746; }
  h1:first-child, h2:first-child { margin-top: 0; }
  a { color: #19c6f0; }
  p, ul, ol, blockquote, pre, table { margin: 0 0 1em; }
  code { font: 13px 'JetBrains Mono', Menlo, monospace; background: #262836; padding: .15em .4em; border-radius: 5px; }
  pre { background: #12131a; border: 1px solid #343746; border-radius: 8px; padding: 14px 16px; overflow: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin-left: 0; padding: 2px 16px; border-left: 3px solid #19c6f0; color: #9096b1; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #343746; padding: 6px 12px; }
  th { background: #262836; }
  img { max-width: 100%; }
  hr { border: 0; border-top: 1px solid #343746; margin: 1.5em 0; }
  input[type=checkbox] { margin-right: 6px; }
`;

const wrap = (body) =>
    `<!doctype html><meta charset="utf-8"><base target="_blank"><style>${STYLE}</style><body>${body}</body>`;

// Shown instead of a blank frame when rendering fails.
export const renderError = (message) =>
    wrap(`<p style="color:#ff6e6e"><b>Couldn't render the preview.</b></p><p style="color:#9096b1">${message}</p>`);

// A lazy chunk can fail to load (flaky network, or a dev server that just rebuilt); try once more.
const loadRenderer = async () => {
    try {
        return await Promise.all([import('marked'), import('dompurify')]);
    } catch {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return Promise.all([import('marked'), import('dompurify')]);
    }
};

export async function renderMarkdown(source) {
    const [{ marked }, { default: DOMPurify }] = await loadRenderer();
    const html = DOMPurify.sanitize(marked.parse(source, { gfm: true, breaks: true }), {
        ADD_ATTR: ['target'],
    });
    return wrap(html);
}
