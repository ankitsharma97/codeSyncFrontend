// Chat lives in the shared Yjs document (`chat`, a Y.Array of plain message objects), so it syncs
// live, is saved with the room, and a newcomer gets the history for free.
import { v4 as uuid } from 'uuid';

export const MAX_MESSAGES = 500; // oldest are dropped beyond this, keeping the room small
export const MAX_LENGTH = 2000;
const FLOOD_WINDOW_MS = 4000;
const FLOOD_MAX = 6;

// A stable id for this browser, so "my messages" stay mine after a reconnect or a rename.
export const userId = () => {
    try {
        let id = localStorage.getItem('cwf:uid');
        if (!id) { id = uuid(); localStorage.setItem('cwf:uid', id); }
        return id;
    } catch { return uuid(); }
};

const recent = [];

/** Append a message. Returns { error } if it was rejected (empty, or sending too fast). */
export function sendMessage(chat, { uid, user, color, text }) {
    const body = text.trim().slice(0, MAX_LENGTH);
    if (!body) return { error: 'empty' };
    const now = Date.now();
    while (recent.length && now - recent[0] > FLOOD_WINDOW_MS) recent.shift();
    if (recent.length >= FLOOD_MAX) return { error: 'You’re sending messages too fast — slow down a little.' };
    recent.push(now);

    chat.doc.transact(() => {
        chat.push([{ id: uuid().slice(0, 8), uid, user, color, text: body, ts: now }]);
        const extra = chat.length - MAX_MESSAGES;
        if (extra > 0) chat.delete(0, extra); // two clients trimming at once delete the same items
    });
    return {};
}

// ---- rendering text safely (no HTML injection: everything becomes React text nodes) ------------
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

const linkify = (text, keyPrefix) =>
    text.split(URL_RE).map((part, i) => {
        if (i % 2 === 0) return part;
        const trailing = part.match(/[.,;:!?)\]]+$/)?.[0] || '';
        const url = trailing ? part.slice(0, -trailing.length) : part;
        return [{ type: 'link', url, key: `${keyPrefix}-${i}` }, trailing];
    }).flat();

/**
 * Turn a message into a list of parts: { type: 'text'|'code'|'inline'|'link', value|url }.
 * Supports ```fenced blocks```, `inline code`, and http(s) links.
 */
export function parseMessage(text) {
    const parts = [];
    text.split(/```([\s\S]*?)```/g).forEach((chunk, i) => {
        if (i % 2 === 1) { parts.push({ type: 'code', value: chunk.replace(/^\n/, '').replace(/\n$/, '') }); return; }
        chunk.split(/`([^`\n]+)`/g).forEach((piece, j) => {
            if (j % 2 === 1) { parts.push({ type: 'inline', value: piece }); return; }
            linkify(piece, `${i}-${j}`).forEach((p) => {
                if (typeof p === 'string') { if (p) parts.push({ type: 'text', value: p }); } else parts.push(p);
            });
        });
    });
    return parts;
}
