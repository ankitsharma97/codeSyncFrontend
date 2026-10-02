// Runs untrusted code inside Web Workers. A worker has no DOM, cookies or storage, and the
// network APIs are removed before user code starts. A timeout terminates runaway code.

const MAX_OUTPUT = 20000;
const BLOCK_NETWORK = `
for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'importScripts', 'indexedDB', 'caches']) {
  try { Object.defineProperty(self, k, { value: undefined, configurable: false }); } catch (e) {}
}`;

const JS_WORKER = `
const MAX = ${MAX_OUTPUT};
${BLOCK_NETWORK}
const fmt = (v) => {
  if (typeof v === 'string') return v;
  try { return v !== null && typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v); } catch (e) { return String(v); }
};
const resolve = (from, rel) => {
  const parts = rel.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return parts.join('/');
};
self.onmessage = async ({ data }) => {
  const out = [], err = [];
  const files = data.files || {};
  const cache = {};
  const makeRequire = (from) => (spec) => {
    if (!spec.startsWith('.') && !spec.startsWith('/')) throw new Error("Cannot find module '" + spec + "' (only relative files can be required)");
    const base = resolve(from, spec);
    const found = [base, base + '.js', base + '.json', base + '/index.js'].find((p) => p in files);
    if (!found) throw new Error("Cannot find module '" + spec + "' from " + from);
    if (cache[found]) return cache[found].exports;
    const mod = cache[found] = { exports: {} };
    if (found.endsWith('.json')) mod.exports = JSON.parse(files[found]);
    else new Function('module', 'exports', 'require', files[found])(mod, mod.exports, makeRequire(found));
    return mod.exports;
  };
  let size = 0;
  const sink = (list) => (...args) => {
    if (size > MAX) return;
    const line = args.map(fmt).join(' ');
    size += line.length + 1;
    list.push(size > MAX ? '… output truncated' : line);
  };
  self.console = { log: sink(out), info: sink(out), debug: sink(out), warn: sink(err), error: sink(err) };
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const entry = { exports: {} };
    await new AsyncFunction('module', 'exports', 'require', data.code)(entry, entry.exports, makeRequire(data.entry || 'main.js'));
  } catch (e) {
    err.push(e && e.name ? e.name + ': ' + e.message : String(e));
  }
  postMessage({ type: 'done', stdout: out.join('\\n'), stderr: err.join('\\n') });
};`;

const PY_WORKER = `
const MAX = ${MAX_OUTPUT};
importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js');
const ROOT = '/home/pyodide';
let py;
let written = [];
self.onmessage = async ({ data }) => {
  const out = [], err = [];
  let size = 0;
  const sink = (list) => (line) => {
    if (size > MAX) return;
    size += line.length + 1;
    list.push(size > MAX ? '… output truncated' : line);
  };
  try {
    if (!py) {
      postMessage({ type: 'loading' });
      py = await loadPyodide();
      ${BLOCK_NETWORK.replace("'importScripts', ", '')}
    }
    postMessage({ type: 'started' });
    // Mirror the project into the virtual file system so files can import each other.
    written.forEach((f) => { try { py.FS.unlink(f); } catch (e) {} });
    written = [];
    for (const [path, text] of Object.entries(data.files || {})) {
      const full = ROOT + '/' + path;
      py.FS.mkdirTree(full.slice(0, full.lastIndexOf('/')));
      py.FS.writeFile(full, text);
      written.push(full);
    }
    const entryDir = ROOT + '/' + (data.entry || 'main.py').split('/').slice(0, -1).join('/');
    py.runPython(
      'import sys, os, importlib\\n' +
      'for name, mod in list(sys.modules.items()):\\n' +
      '    f = getattr(mod, "__file__", None)\\n' +
      '    if f and f.startswith("' + ROOT + '/"): del sys.modules[name]\\n' +
      'importlib.invalidate_caches()\\n' +
      'for p in ["' + entryDir.replace(/\\/$/, '') + '", "' + ROOT + '"]:\\n' +
      '    if p not in sys.path: sys.path.insert(0, p)\\n' +
      'os.chdir("' + ROOT + '")'
    );
    py.setStdout({ batched: sink(out) });
    py.setStderr({ batched: sink(err) });
    const globals = py.globals.get('dict')();
    globals.set('__name__', '__main__');
    await py.runPythonAsync(data.code, { globals });
  } catch (e) {
    err.push(String(e && e.message ? e.message : e).trim());
  }
  postMessage({ type: 'done', stdout: out.join('\\n'), stderr: err.join('\\n') });
};`;

const spawn = (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    return worker;
};

let pythonWorker = null; // kept warm: loading Pyodide takes several seconds

/**
 * Execute code (the file at `entry`, with the rest of the project in `files`) and resolve with { stdout, stderr, ms, timedOut }.
 * onStatus('loading' | 'running') reports progress for slow first runs.
 */
export function runCode(language, code, { files = {}, entry, timeout = 8000, onStatus = () => {} } = {}) {
    const isPython = language === 'python';
    const worker = isPython ? (pythonWorker ??= spawn(PY_WORKER)) : spawn(JS_WORKER);

    return new Promise((resolve) => {
        let timer;
        let startedAt = Date.now();

        const finish = (result) => {
            clearTimeout(timer);
            worker.onmessage = worker.onerror = null;
            if (!isPython) worker.terminate();
            resolve({ stdout: '', stderr: '', timedOut: false, ...result, ms: Date.now() - startedAt });
        };
        const arm = () => {
            startedAt = Date.now();
            onStatus('running');
            timer = setTimeout(() => {
                worker.terminate();
                if (isPython) pythonWorker = null;
                finish({ stderr: `Timed out after ${timeout / 1000}s`, timedOut: true });
            }, timeout);
        };

        worker.onmessage = ({ data }) => {
            if (data.type === 'loading') onStatus('loading');
            else if (data.type === 'started') arm();
            else if (data.type === 'done') finish(data);
        };
        worker.onerror = (e) => {
            if (isPython) { worker.terminate(); pythonWorker = null; }
            finish({ stderr: e.message || 'The sandbox crashed' });
        };

        if (!isPython) arm();
        worker.postMessage({ code, files, entry });
    });
}
