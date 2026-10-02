import { resolvePath } from './fs';

// Inline the project's own stylesheets and scripts so an HTML file previews like a real page.
// readFile(path) returns a file's text, or null for anything that isn't in the project.
export function bundleHtml(source, entryPath, readFile) {
    const doc = new DOMParser().parseFromString(source, 'text/html');
    const local = (ref) => (ref && !/^([a-z]+:)?\/\//i.test(ref) ? readFile(resolvePath(entryPath, ref)) : null);

    doc.querySelectorAll('link[rel~="stylesheet"][href]').forEach((link) => {
        const css = local(link.getAttribute('href'));
        if (css == null) return;
        const style = doc.createElement('style');
        style.textContent = css;
        link.replaceWith(style);
    });
    doc.querySelectorAll('script[src]').forEach((script) => {
        const js = local(script.getAttribute('src'));
        if (js == null) return;
        const inline = doc.createElement('script');
        if (script.type) inline.type = script.type;
        inline.textContent = js.replace(/<\/script/gi, '<\\/script');
        script.replaceWith(inline);
    });
    return `<!doctype html>${doc.documentElement.outerHTML}`;
}
