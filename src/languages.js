// Each language lazy-loads its CodeMirror support, so the editor bundle stays small.
export const LANGUAGES = [
    { id: 'javascript', ext: 'js', label: 'JavaScript', runnable: true, load: () => import('@codemirror/lang-javascript').then((m) => m.javascript()) },
    { id: 'typescript', ext: 'ts', label: 'TypeScript', load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })) },
    { id: 'python', ext: 'py', label: 'Python', runnable: true, load: () => import('@codemirror/lang-python').then((m) => m.python()) },
    { id: 'java', ext: 'java', label: 'Java', load: () => import('@codemirror/lang-java').then((m) => m.java()) },
    { id: 'cpp', ext: 'cpp', label: 'C / C++', load: () => import('@codemirror/lang-cpp').then((m) => m.cpp()) },
    { id: 'html', ext: 'html', label: 'HTML', preview: true, load: () => import('@codemirror/lang-html').then((m) => m.html()) },
    { id: 'css', ext: 'css', label: 'CSS', load: () => import('@codemirror/lang-css').then((m) => m.css()) },
    { id: 'json', ext: 'json', label: 'JSON', load: () => import('@codemirror/lang-json').then((m) => m.json()) },
    { id: 'sql', ext: 'sql', label: 'SQL', load: () => import('@codemirror/lang-sql').then((m) => m.sql()) },
    { id: 'markdown', ext: 'md', label: 'Markdown', preview: true, load: () => import('@codemirror/lang-markdown').then((m) => m.markdown()) },
    { id: 'text', ext: 'txt', label: 'Plain text', load: async () => [] },
];

export const DEFAULT_LANGUAGE = 'javascript';

export const getLanguage = (id) => LANGUAGES.find((l) => l.id === id) || LANGUAGES[0];

const BY_EXTENSION = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python', java: 'java',
    c: 'cpp', h: 'cpp', cc: 'cpp', cpp: 'cpp', hpp: 'cpp',
    html: 'html', htm: 'html', css: 'css', json: 'json', sql: 'sql',
    md: 'markdown', markdown: 'markdown',
};

export const detectLanguage = (filename) => BY_EXTENSION[filename.split('.').pop().toLowerCase()] || 'text';

// Short badge shown next to a file in the explorer and tabs.
const BADGES = {
    javascript: ['JS', '#f1e05a'], typescript: ['TS', '#3b9cff'], python: ['PY', '#4ec27b'],
    java: ['JV', '#e9764b'], cpp: ['C++', '#c678dd'], html: ['<>', '#f08a4b'], css: ['#', '#a78bfa'],
    json: ['{}', '#9aa4b2'], sql: ['SQ', '#38bdf8'], markdown: ['MD', '#19c6f0'], text: ['TX', '#8d92ad'],
};
export const badgeFor = (languageId) => BADGES[languageId] || BADGES.text;
