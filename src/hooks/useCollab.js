import { useCallback, useEffect, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import toast from 'react-hot-toast';
import { WS_URL } from '../config';
import { DEFAULT_LANGUAGE } from '../languages';
import { colorFor } from '../utils/colors';
import { initProject, readNodes } from '../utils/fs';

const readUsers = (awareness) =>
    [...awareness.getStates()]
        .filter(([, state]) => state.user)
        .map(([clientId, state]) => ({ clientId, name: state.user.name, color: state.user.color, file: state.file || null, typing: !!state.typing }));

/**
 * Joins a room: one Yjs doc synced over a single WebSocket. The doc carries the project's
 * file tree and every file's text, plus the latest run output, so all of it is shared.
 */
export default function useCollab(roomId, username) {
    const [session, setSession] = useState(null);
    const [status, setStatus] = useState('connecting');
    const [users, setUsers] = useState([]);
    const [nodes, setNodes] = useState([]);
    const [ready, setReady] = useState(false);
    const [run, setRunState] = useState({});
    const [messages, setMessages] = useState([]);

    useEffect(() => {
        const doc = new Y.Doc();
        const provider = new WebsocketProvider(WS_URL, roomId, doc);
        const { awareness } = provider;
        const files = doc.getMap('files');
        const gitfs = doc.getMap('gitfs'); // the repository's .git contents, shared by the room
        const meta = doc.getMap('meta');
        const runMap = doc.getMap('run');
        const chat = doc.getArray('chat'); // messages, in the order everyone agrees on
        const color = colorFor(username);
        awareness.setLocalStateField('user', { name: username, color, colorLight: `${color}33` });

        // Don't toast for people already in the room while the initial state loads.
        let announce = false;
        provider.on('sync', (synced) => {
            if (!synced) return;
            initProject(doc, files, meta, DEFAULT_LANGUAGE); // only after the server's state has arrived
            setReady(true);
            setTimeout(() => { announce = true; }, 1000);
        });
        provider.on('status', ({ status: s }) => setStatus(s));

        const onChange = ({ added, removed }) => {
            setUsers(readUsers(awareness));
            if (!announce) return;
            const states = awareness.getStates();
            added.filter((id) => id !== doc.clientID).forEach((id) => {
                const name = states.get(id)?.user?.name;
                if (name) toast.success(`${name} joined`);
            });
            if (removed.length) toast('Someone left', { icon: '👋' });
        };
        awareness.on('change', onChange);
        setUsers(readUsers(awareness));

        // Typing changes file text constantly; only structural changes matter to the tree.
        const onFiles = (events) => {
            if (events.some((e) => !(e.target instanceof Y.Text))) setNodes(readNodes(files));
        };
        const onRun = () => setRunState(runMap.toJSON());
        const onChat = () => setMessages(chat.toArray());
        files.observeDeep(onFiles);
        runMap.observe(onRun);
        chat.observe(onChat);
        onChat();
        setNodes(readNodes(files));
        onRun();

        setSession({ files, gitfs, awareness, runMap, chat });
        return () => {
            awareness.off('change', onChange);
            provider.destroy();
            doc.destroy();
            setSession(null);
            setReady(false);
            setNodes([]);
            setMessages([]);
        };
    }, [roomId, username]);

    const publishRun = useCallback((value) => {
        if (!session) return;
        // Replace the whole record so no field from a previous run lingers.
        session.runMap.doc.transact(() => {
            session.runMap.clear();
            Object.entries(value).forEach(([k, v]) => session.runMap.set(k, v));
        });
    }, [session]);

    return { ...session, status, users, nodes, ready, run, publishRun, messages };
}
