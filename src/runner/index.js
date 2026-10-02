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
self.onmessage = async ({ data }) => {
  const out = [], err = [];
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
    await new AsyncFunction(data.code)();
  } catch (e) {
    err.push(e && e.name ? e.name + ': ' + e.message : String(e));
  }
  postMessage({ type: 'done', stdout: out.join('\\n'), stderr: err.join('\\n') });
};`;

const PY_WORKER = `
const MAX = ${MAX_OUTPUT};
importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js');
let py;
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
    py.setStdout({ batched: sink(out) });
    py.setStderr({ batched: sink(err) });
    await py.runPythonAsync(data.code, { globals: py.globals.get('dict')() });
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
 * Execute code and resolve with { stdout, stderr, ms, timedOut }.
 * onStatus('loading' | 'running') reports progress for slow first runs.
 */
export function runCode(language, code, { timeout = 8000, onStatus = () => {} } = {}) {
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
        worker.postMessage({ code });
    });
}
