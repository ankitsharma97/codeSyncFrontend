import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FiSend, FiX } from 'react-icons/fi';
import { MAX_LENGTH, parseMessage } from '../utils/chat';
import { initialsOf } from '../utils/colors';

const GROUP_MS = 5 * 60 * 1000;
const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function MessageBody({ text }) {
    return parseMessage(text).map((part, i) => {
        switch (part.type) {
            case 'code': return <pre key={i} className="chatCode">{part.value}</pre>;
            case 'inline': return <code key={i} className="docCode">{part.value}</code>;
            case 'link': return <a key={i} href={part.url} target="_blank" rel="noopener noreferrer">{part.url}</a>;
            default: return <React.Fragment key={i}>{part.value}</React.Fragment>;
        }
    });
}

const typingLine = (names) => {
    if (!names.length) return '';
    if (names.length === 1) return `${names[0]} is typing…`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
    return 'Several people are typing…';
};

// Right-hand chat sidebar. Messages come from the shared document; typing uses presence.
function ChatPanel({ open, messages, myUid, typingNames, onSend, onTyping, onClose }) {
    const list = useRef(null);
    const box = useRef(null);
    const stick = useRef(true); // keep following new messages unless the reader scrolled up
    const [draft, setDraft] = useState('');
    const typingTimer = useRef(null);

    const onScroll = () => {
        const el = list.current;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    };

    useLayoutEffect(() => {
        const el = list.current;
        if (el && (stick.current || messages[messages.length - 1]?.uid === myUid)) el.scrollTop = el.scrollHeight;
    }, [messages, open, myUid]);

    useEffect(() => { if (open) box.current?.focus(); }, [open]);
    useEffect(() => () => clearTimeout(typingTimer.current), []);

    const change = (e) => {
        setDraft(e.target.value);
        onTyping(true);
        clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => onTyping(false), 2500);
    };

    const send = () => {
        const result = onSend(draft);
        if (result?.error && result.error !== 'empty') { toast.error(result.error, { id: 'chat-flood' }); return; }
        if (!result?.error) { setDraft(''); stick.current = true; }
        clearTimeout(typingTimer.current);
        onTyping(false);
    };

    const onKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
    };

    return (
        <aside className={`chat ${open ? 'open' : ''}`} aria-label="Chat" aria-hidden={!open}>
            <div className="chatInner">
                <header className="chatHead">
                    <span className="dockTitle">Chat</span>
                    <span className="spacer" />
                    <button className="iconBtn chatClose" onClick={onClose} aria-label="Close chat"><FiX /></button>
                </header>

                <div className="chatList" ref={list} onScroll={onScroll} role="log" aria-live="polite">
                    {messages.length === 0 && (
                        <div className="chatEmpty">
                            <p>No messages yet</p>
                            <p className="muted">Say hi to everyone in this room.</p>
                        </div>
                    )}
                    {messages.map((m, i) => {
                        const prev = messages[i - 1];
                        const grouped = prev && prev.uid === m.uid && m.ts - prev.ts < GROUP_MS;
                        const mine = m.uid === myUid;
                        return (
                            <div key={m.id} className={`chatMsg ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}`}>
                                {!grouped && (
                                    <div className="chatMeta">
                                        <span className="avatar" style={{ background: m.color, width: 22, height: 22 }}>{initialsOf(m.user)}</span>
                                        <b>{mine ? 'You' : m.user}</b>
                                        <time dateTime={new Date(m.ts).toISOString()}>{time(m.ts)}</time>
                                    </div>
                                )}
                                <div className="chatBubble"><MessageBody text={m.text} /></div>
                            </div>
                        );
                    })}
                </div>

                <div className="chatTyping" aria-live="polite">{typingLine(typingNames)}</div>
                <div className="chatComposer">
                    <textarea
                        ref={box}
                        value={draft}
                        onChange={change}
                        onKeyDown={onKeyDown}
                        placeholder="Message the room…"
                        aria-label="Message"
                        rows={1}
                        maxLength={MAX_LENGTH}
                    />
                    <button className="btn primary" onClick={send} disabled={!draft.trim()} aria-label="Send message"><FiSend /></button>
                </div>
                <p className="chatHint">Enter to send · Shift+Enter for a new line · ``` for code</p>
            </div>
        </aside>
    );
}

export default ChatPanel;
