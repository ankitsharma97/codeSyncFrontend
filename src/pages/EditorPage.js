import React, { useState, useEffect } from 'react';
import Client from './Client';
import Editor from './Editor';
import { useParams ,useLocation} from 'react-router-dom';
import  toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';


function EditorPage() {

    const navigate = useNavigate(); 

    // const BASE_URL = 'http://localhost:8000';
    const BASE_URL = 'https://codesyncbackend.onrender.com';
    const { groupId } = useParams();
    const [clients, setClients] = useState([]);
    
    const location = useLocation();
    const { username } = location.state || {};

    const fetchClients = () => {
        fetch(`${BASE_URL}/get/${groupId}`)
            .then(response => {
                if (response.ok) {
                    return response.json();
                }
                throw response;
            })
            .then(data => {
                const formattedClients = data.map(user => ({
                    socketId: user.socket_id,
                    username: user.user_id
                }))
                setClients(formattedClients);
            })
            .catch(error => {
                console.error('An error occurred: ', error);
            });
    };

    useEffect(() => {
        fetchClients();
    }, [groupId]);

    useEffect(() => {
        const intervalId = setInterval(() => {
            fetchClients();
        }, 1000); 

        return () => clearInterval(intervalId); 
    }, [groupId]); 



    const handleCopyRoomId = () => {
        navigator.clipboard.writeText(groupId).then(() => {
            toast.success('Room ID copied to clipboard');
        }, (err) => {
            console.error('Could not copy text: ', err);
        });
    };
    const handleLeaveRoom = () => {
        fetch(`${BASE_URL}/delete/${groupId}/${username}`, {
            method: 'DELETE'
        })
        .then(response => {
            if (response.ok) {
                toast.success('Left the room');
                navigate('/');

            } else {
                toast.error('Failed to leave the room');
            }
        })
    }


    return (
        <div className='mainWrap'>
            <div className='left '>
                <div className='aside'>
                    <div className='asideInner'>
                        <div className='logoWrap'>
                            <img src='/cwf3.png' alt='logo' className='logoImg' />
                        </div>
                        <h3> Connected </h3>

                        <div className='active'>

                            <div id='clist' className='clientList'>
                                {clients.map((client) => (
                                    <Client key={client.socketId} username={client.username} />
                                ))}
                            </div>
                        </div>
                    </div>
                    <button className='btn leaveBtn' onClick={handleLeaveRoom}>Leave Room</button>
                    <button className='btn copyBtn' onClick={handleCopyRoomId}>Copy RoomId</button>
                </div>
            </div>
                <div className='editorWrap'>
                    <Editor />
                </div>

        </div>
    );
}

export default EditorPage;
