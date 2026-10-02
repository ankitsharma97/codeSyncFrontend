// Base WebSocket URL; y-websocket appends "/<roomId>". Override with REACT_APP_WS_URL.
export const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:8000/ws/code_sync';

export const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
