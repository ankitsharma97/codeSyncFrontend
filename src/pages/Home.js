import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { v4 as uuid } from 'uuid';
import { useNavigate } from 'react-router-dom';
import useCustomWebSocket from '../ws/Websocket';

function Home() {
    // const BASE_URL = 'http://localhost:8000/';
    const BASE_URL = 'https://codesyncbackend.onrender.com/';

    const navigate = useNavigate();
    const [room, setRoom] = useState('newRoom');
    const [username, setUsername] = useState('');

    const { sendMessage, lastMessage } = useCustomWebSocket(room);

    
    const createNewRoom = (e) => {
        e.preventDefault();
        const id = uuid();
        setRoom(id);
        toast.success('New Room Created');
    };

    const joinRoom = (e) => {
        e.preventDefault();
        if (room.trim() === '' || username.trim() === '') {
            toast.error('Room ID & Username are Required');
            return;
        }
        fetch(`${BASE_URL}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                group_id: room,
                user_id : username
            })
        })
        .then(response => {
            if (response.ok) {
                sendMessage(JSON.stringify({ type: 'join', room, username }));
                navigate(`/editor/${room}`, {
                    state: { username }
                });
            } else {
                toast.error('Failed to join the room');
            }
        })
        .catch(error => {
            toast.error('An error occurred: ' + error.message);
        });
    };

    const handleInput = (e) => {
        if (e.code === 'Enter') {
            joinRoom(e);
        }
    };

    return (
        <div className='homePageWrapper'>
            <div className='formWrapper'>
                <img src='./cwf3.png' alt='logo' className='logo' />
                <h4 className='mainLable'>Paste Invitation ROOM ID</h4>
                <div className='inputGroup'>
                    <input
                        type='text'
                        id='room'
                        className='inputBox'
                        placeholder='ROOM ID'
                        onChange={(e) => setRoom(e.target.value)}
                        value={room}
                        onKeyUp={handleInput}
                    />
                    <input
                        type='text'
                        className='inputBox'
                        placeholder='Username'
                        onChange={(e) => setUsername(e.target.value)}
                        value={username}
                        onKeyUp={handleInput}
                    />
                    <button
                        className='btn joinBtn'
                        onClick={joinRoom}
                    >Join</button>
                    <span className='createInfo'>
                        Don't have an invite? Create a&nbsp;
                        <a
                            className='createNewBtn'
                            onClick={createNewRoom}
                        ><b>New Room</b></a>
                    </span>
                </div>
            </div>
            <footer>
                <h4>Built with <span className='heart'> ♥️ </span>By <a href='https://github.com/ankitsharma97'><b>Ankit Sharma</b></a></h4>
            </footer>
        </div>
    );
}

export default Home;

