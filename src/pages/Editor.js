import React, { useEffect, useRef } from 'react';
import { useParams,useLocation } from 'react-router-dom';
import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { dracula } from '@uiw/codemirror-theme-dracula';
import { EditorState } from '@codemirror/state';
import useCustomWebSocket from '../ws/Websocket';
import toast from 'react-hot-toast';

function Editor() {
    const location = useLocation();
    const { groupId } = useParams();
    const editorRef = useRef(null);
    const view = useRef(null);
    const { sendMessage, lastMessage } = useCustomWebSocket(groupId);
    const isRemoteChange = useRef(false);
    const username = location.state || {};

    useEffect(() => {
        if (!editorRef.current) return;

        view.current = new EditorView({
            state: EditorState.create({
                extensions: [
                    basicSetup,
                    javascript(),
                    dracula,
                    EditorView.updateListener.of((update) => {
                        if (!isRemoteChange.current && update.docChanged) {
                            update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
                                const changes = inserted.toString();
                                sendActiveChangesToDjango(fromA, toA, changes);
                            });
                        }
                    })
                ],
            }),
            parent: editorRef.current,
        });

        return () => {
            if (view.current) {
                view.current.destroy();
            }
        };
    }, []);

    useEffect(() => {
        if (lastMessage !== null) {
            const message = JSON.parse(lastMessage.data);
            if (message.type === 'join' || message.type === 'leave') {
                if(message.type === 'leave' && message.username !== username)
                    toast.error(`${message.username} has left the room`);
                else
                    toast.success(`${message.username} has joined the room`);
            } else {
                if (view.current) {
                    const docLength = view.current.state.doc.length;
                    const from = Math.min(message.from, docLength);
                    const to = Math.min(message.to, docLength);
                    isRemoteChange.current = true;
                    view.current.dispatch({
                        changes: {
                            from,
                            to,
                            insert: message.insert
                        }
                    });
                    isRemoteChange.current = false;
                }
            }
        }
    }, [lastMessage]);

    const sendActiveChangesToDjango = (from, to, changes) => {
        console.log('Changes:', changes);
        sendMessage(JSON.stringify({ from, to, insert: changes }));
    };

    return <div ref={editorRef}></div>;
}

export default Editor;
