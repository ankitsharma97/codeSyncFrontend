import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { v4 as uuid } from 'uuid';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FiZap, FiPlay, FiUsers, FiFolder, FiShuffle } from 'react-icons/fi';
import { ROOM_ID_PATTERN } from '../config';

const FEATURES = [
    { icon: <FiUsers />, title: 'Live cursors', text: 'See who is where, edit together with no conflicts.' },
    { icon: <FiPlay />, title: 'Run in the browser', text: 'Execute JavaScript and Python — output is shared.' },
    { icon: <FiFolder />, title: 'Real projects', text: 'Folders and multiple files that import each other.' },
    { icon: <FiZap />, title: 'Rooms that persist', text: 'Come back later and pick up where you left off.' },
];

const newRoomId = () => uuid().slice(0, 8);

const remembered = () => {
    try { return localStorage.getItem('cwf:username') || ''; } catch { return ''; }
};

function Home() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const invited = params.get('room');
    const [room, setRoom] = useState(invited || '');
    const [username, setUsername] = useState(remembered);

    const join = (e) => {
        e.preventDefault();
        const id = room.trim() || newRoomId();
        const name = username.trim();
        if (!name) {
            toast.error('Pick a display name first');
            return;
        }
        if (!ROOM_ID_PATTERN.test(id)) {
            toast.error('Room ID can use letters, numbers, - and _ (max 64)');
            return;
        }
        try { localStorage.setItem('cwf:username', name); } catch { /* storage unavailable */ }
        navigate(`/editor/${id}`, { state: { username: name } });
    };

    return (
        <div className="home">
            <section className="hero">
                <img src="/cwf3.png" alt="CodeWithFriend" className="heroLogo" />
                <h1>Code together,<br /><span>in real time.</span></h1>
                <p className="lead">A shared editor for pair programming, interviews and teaching. No sign-up — just share a link.</p>
                <ul className="features">
                    {FEATURES.map((f) => (
                        <li key={f.title}>
                            <span className="featureIcon">{f.icon}</span>
                            <div><b>{f.title}</b><p>{f.text}</p></div>
                        </li>
                    ))}
                </ul>
            </section>

            <form className="card" onSubmit={join}>
                <h2>{invited ? "You've been invited" : 'Start coding'}</h2>
                <p className="cardSub">
                    {invited ? <>Enter your name to join room <b>{invited}</b>.</> : 'Create a room or join one with its ID.'}
                </p>

                <label htmlFor="username">Your name</label>
                <input
                    id="username"
                    className="input"
                    placeholder="e.g. Ankit"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    maxLength={30}
                    autoFocus={!window.matchMedia('(pointer: coarse)').matches}
                    autoComplete="nickname"
                />

                <label htmlFor="room">Room ID <span className="optional">leave empty to create a new room</span></label>
                <div className="inputRow">
                    <input
                        id="room"
                        className="input"
                        placeholder="paste a room ID"
                        value={room}
                        onChange={(e) => setRoom(e.target.value)}
                        spellCheck={false}
                    />
                    <button type="button" className="btn ghost" onClick={() => setRoom(newRoomId())} title="Generate a room ID">
                        <FiShuffle />
                    </button>
                </div>

                <button type="submit" className="btn primary block">
                    {room.trim() ? 'Join room' : 'Create room'}
                </button>
            </form>

            <footer className="homeFooter">
                <Link to="/docs">Guide</Link> · Built by <a href="https://github.com/ankitsharma97" target="_blank" rel="noreferrer">Ankit Sharma</a>
            </footer>
        </div>
    );
}

export default Home;
