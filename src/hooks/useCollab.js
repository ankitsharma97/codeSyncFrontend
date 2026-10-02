import { useCallback, useEffect, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import toast from 'react-hot-toast';
import { WS_URL } from '../config';
import { DEFAULT_LANGUAGE } from '../languages';
import { colorFor } from '../utils/colors';

const readUsers = (awareness) =>
    [...awareness.getStates()]
        .filter(([, state]) => state.user)
        .map(([clientId, state]) => ({ clientId, name: state.user.name, color: state.user.color }));

/**
 * Joins a room: one Yjs doc synced over a single WebSocket. Besides the code itself, the doc
 * carries the room's language and the latest run output, so both are shared by everyone.
 */
export default function useCollab(roomId, username) {
    const [session, setSession] = useState(null);
    const [status, setStatus] = useState('connecting');
    const [users, setUsers] = useState([]);
    const [language, setLanguageState] = useState(DEFAULT_LANGUAGE);
    const [run, setRunState] = useState({});

    useEffect(() => {
        const doc = new Y.Doc();
        const provider = new WebsocketProvider(WS_URL, roomId, doc);
        const { awareness } = provider;
        const meta = doc.getMap('meta');
        const runMap = doc.getMap('run');
        const color = colorFor(username);
        awareness.setLocalStateField('user', { name: username, color, colorLight: `${color}33` });

        // Don't toast for people already in the room while the initial state loads.
        let announce = false;
        provider.on('sync', (synced) => {
            if (synced) setTimeout(() => { announce = true; }, 1000);
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

        const onMeta = () => setLanguageState(meta.get('language') || DEFAULT_LANGUAGE);
        const onRun = () => setRunState(runMap.toJSON());
        meta.observe(onMeta);
        runMap.observe(onRun);
        onMeta();
        onRun();

        setSession({ ytext: doc.getText('codemirror'), awareness, meta, runMap });
        return () => {
            awareness.off('change', onChange);
            provider.destroy();
            doc.destroy();
            setSession(null);
        };
    }, [roomId, username]);

    const setLanguage = useCallback((id) => session?.meta.set('language', id), [session]);
    const publishRun = useCallback((value) => {
        if (!session) return;
        // Replace the whole record so no field from a previous run lingers.
        session.runMap.doc.transact(() => {
            session.runMap.clear();
            Object.entries(value).forEach(([k, v]) => session.runMap.set(k, v));
        });
    }, [session]);

    return { ...session, status, users, language, setLanguage, run, publishRun };
}
