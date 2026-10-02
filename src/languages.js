// Each language lazy-loads its CodeMirror support, so the editor bundle stays small.
export const LANGUAGES = [
    { id: 'javascript', label: 'JavaScript', runnable: true, load: () => import('@codemirror/lang-javascript').then((m) => m.javascript()) },
    { id: 'typescript', label: 'TypeScript', load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })) },
    { id: 'python', label: 'Python', runnable: true, load: () => import('@codemirror/lang-python').then((m) => m.python()) },
    { id: 'java', label: 'Java', load: () => import('@codemirror/lang-java').then((m) => m.java()) },
    { id: 'cpp', label: 'C / C++', load: () => import('@codemirror/lang-cpp').then((m) => m.cpp()) },
    { id: 'html', label: 'HTML', preview: true, load: () => import('@codemirror/lang-html').then((m) => m.html()) },
    { id: 'css', label: 'CSS', load: () => import('@codemirror/lang-css').then((m) => m.css()) },
    { id: 'json', label: 'JSON', load: () => import('@codemirror/lang-json').then((m) => m.json()) },
    { id: 'sql', label: 'SQL', load: () => import('@codemirror/lang-sql').then((m) => m.sql()) },
    { id: 'markdown', label: 'Markdown', preview: true, load: () => import('@codemirror/lang-markdown').then((m) => m.markdown()) },
    { id: 'text', label: 'Plain text', load: async () => [] },
];

export const DEFAULT_LANGUAGE = 'javascript';

export const getLanguage = (id) => LANGUAGES.find((l) => l.id === id) || LANGUAGES[0];
