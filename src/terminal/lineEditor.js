// Line editing for xterm: cursor movement, history, tab completion, Ctrl shortcuts.
const HISTORY_KEY = 'cwf:history';

const loadHistory = () => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; } };
const saveHistory = (h) => { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-200))); } catch { /* storage unavailable */ } };

const SEQUENCES = {
    '\x1b[A': 'up', '\x1b[B': 'down', '\x1b[C': 'right', '\x1b[D': 'left',
    '\x1b[H': 'home', '\x1b[F': 'end', '\x1b[1~': 'home', '\x1b[4~': 'end', '\x1bOH': 'home', '\x1bOF': 'end',
    '\x1b[3~': 'delete', '\x1b[1;5C': 'wordRight', '\x1b[1;5D': 'wordLeft',
};

export function attachLineEditor(term, shell) {
    const history = loadHistory();
    let buffer = '';
    let cursor = 0;
    let prompt = { text: '$ ', length: 2 };
    let busy = false;
    let historyIndex = history.length;
    let draft = '';
    let drawnRow = 0; // row (relative to the prompt's first row) the cursor was left on
    let lastTab = 0;
    let queue = Promise.resolve();

    // xterm needs CRLF; programs here print plain "\n".
    const write = (s) => term.write(s.replace(/\r?\n/g, '\r\n'));
    const io = {
        get cols() { return term.cols; },
        out: write,
        err: write,
        clear: () => { term.clear(); term.write('\x1b[2J\x1b[H'); },
    };

    const redraw = () => {
        const cols = term.cols;
        term.write(`${drawnRow ? `\x1b[${drawnRow}A` : ''}\r\x1b[J${prompt.text}${buffer}`);
        const total = prompt.length + buffer.length;
        // A line that exactly fills a row leaves the cursor parked at that row's end.
        let row = total > 0 && total % cols === 0 ? total / cols - 1 : Math.floor(total / cols);
        const want = prompt.length + cursor;
        const wantRow = Math.floor(want / cols);
        const wantCol = want % cols;
        if (wantRow > row) { term.write('\r\n'); row += 1; }
        if (row > wantRow) term.write(`\x1b[${row - wantRow}A`);
        term.write(`\r${wantCol ? `\x1b[${wantCol}C` : ''}`);
        drawnRow = wantRow;
    };

    const showPrompt = async () => {
        prompt = await shell.prompt();
        buffer = ''; cursor = 0; drawnRow = 0; historyIndex = history.length;
        term.write(prompt.text);
    };

    const submit = async () => {
        const line = buffer;
        cursor = buffer.length;
        redraw(); // park the cursor after the last wrapped row before printing output
        term.write('\r\n');
        busy = true;
        if (line.trim()) {
            if (history[history.length - 1] !== line) history.push(line);
            saveHistory(history);
            try { await shell.run(line, io); } catch (error) { console.error(error); write(`shell error: ${error.message}\n`); }
        }
        busy = false;
        await showPrompt();
    };

    const insert = (text) => { buffer = buffer.slice(0, cursor) + text + buffer.slice(cursor); cursor += text.length; redraw(); };

    const wordBefore = () => { let i = cursor; while (i > 0 && buffer[i - 1] === ' ') i -= 1; while (i > 0 && buffer[i - 1] !== ' ') i -= 1; return i; };
    const wordAfter = () => { let i = cursor; while (i < buffer.length && buffer[i] === ' ') i += 1; while (i < buffer.length && buffer[i] !== ' ') i += 1; return i; };

    const complete = async () => {
        const { start, options } = await shell.complete(buffer, cursor);
        if (!options.length) return;
        const typed = buffer.slice(start, cursor);
        let common = options[0];
        options.forEach((o) => { while (!o.startsWith(common)) common = common.slice(0, -1); });
        if (common.length > typed.length || options.length === 1) {
            const addition = options.length === 1 && !options[0].endsWith('/') ? `${common} ` : common;
            buffer = buffer.slice(0, start) + addition + buffer.slice(cursor);
            cursor = start + addition.length;
            redraw();
        } else if (Date.now() - lastTab < 600) {
            term.write('\r\n');
            write(`${options.map((o) => o.split('/').filter(Boolean).pop() + (o.endsWith('/') ? '/' : '')).join('  ')}\n`);
            drawnRow = 0;
            redraw();
        }
        lastTab = Date.now();
    };

    const handleKey = async (key) => {
        switch (key) {
            case 'up': if (historyIndex > 0) { if (historyIndex === history.length) draft = buffer; historyIndex -= 1; buffer = history[historyIndex]; cursor = buffer.length; redraw(); } break;
            case 'down': if (historyIndex < history.length) { historyIndex += 1; buffer = historyIndex === history.length ? draft : history[historyIndex]; cursor = buffer.length; redraw(); } break;
            case 'left': if (cursor > 0) { cursor -= 1; redraw(); } break;
            case 'right': if (cursor < buffer.length) { cursor += 1; redraw(); } break;
            case 'home': case '\x01': cursor = 0; redraw(); break;
            case 'end': case '\x05': cursor = buffer.length; redraw(); break;
            case 'wordLeft': cursor = wordBefore(); redraw(); break;
            case 'wordRight': cursor = wordAfter(); redraw(); break;
            case 'delete': buffer = buffer.slice(0, cursor) + buffer.slice(cursor + 1); redraw(); break;
            case '\x7f': if (cursor > 0) { buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor); cursor -= 1; redraw(); } break;
            case '\x15': buffer = buffer.slice(cursor); cursor = 0; redraw(); break;
            case '\x0b': buffer = buffer.slice(0, cursor); redraw(); break;
            case '\x17': { const i = wordBefore(); buffer = buffer.slice(0, i) + buffer.slice(cursor); cursor = i; redraw(); break; }
            case '\x0c': io.clear(); drawnRow = 0; redraw(); break;
            case '\x03': term.write('^C\r\n'); await showPrompt(); break;
            case '\t': await complete(); break;
            case '\r': case '\n': await submit(); break;
            default: if (key >= ' ' && !key.startsWith('\x1b')) insert(key);
        }
    };

    // Split pasted/typed data into keys; run them one at a time so a pasted multi-line script works.
    const feed = (data) => {
        const keys = [];
        for (let i = 0; i < data.length;) {
            const seq = Object.keys(SEQUENCES).find((s) => data.startsWith(s, i));
            if (seq) { keys.push(SEQUENCES[seq]); i += seq.length; } else if (data[i] === '\x1b') { i += 1; } else { keys.push(data[i]); i += 1; }
        }
        queue = queue.then(async () => {
            for (const key of keys) {
                if (busy) { if (key === '\x03') write('^C (the running command cannot be interrupted)\n'); continue; }
                await handleKey(key);
            }
        });
    };

    const subscription = term.onData(feed);
    showPrompt();
    return {
        dispose: () => subscription.dispose(),
        redraw,
        write,
    };
}
