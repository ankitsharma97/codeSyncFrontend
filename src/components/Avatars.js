import React, { useEffect, useRef, useState } from 'react';
import { initialsOf } from '../utils/colors';

const VISIBLE = 4;

function Avatar({ user, size = 30 }) {
    return (
        <span className="avatar" title={user.name} style={{ background: user.color, width: size, height: size }}>
            {initialsOf(user.name)}
        </span>
    );
}

// Overlapping avatar stack; clicking opens the full list of people in the room.
function Avatars({ users, me }) {
    const [open, setOpen] = useState(false);
    const box = useRef(null);

    useEffect(() => {
        if (!open) return;
        const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    return (
        <div className="people" ref={box}>
            <button className="avatarStack" onClick={() => setOpen(!open)} aria-label={`${users.length} people in this room`}>
                {users.slice(0, VISIBLE).map((u) => <Avatar key={u.clientId} user={u} />)}
                {users.length > VISIBLE && <span className="avatar more">+{users.length - VISIBLE}</span>}
            </button>
            {open && (
                <div className="popover">
                    <p className="popoverTitle">In this room · {users.length}</p>
                    {users.map((u) => (
                        <div className="person" key={u.clientId}>
                            <Avatar user={u} size={26} />
                            <span>{u.name}</span>
                            {u.name === me && <em>you</em>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default Avatars;
