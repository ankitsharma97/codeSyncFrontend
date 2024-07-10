import useWebSocket from 'react-use-websocket';

function useCustomWebSocket(group) {
  const socketUrl = `wss://codesyncbackend.onrender.com/ws/code_sync/${group}/`;
  // const socketUrl = `ws://localhost:8000/ws/code_sync/${group}/`;

  const { sendMessage, lastMessage, readyState } = useWebSocket(socketUrl, {
    onOpen: () => console.log('WebSocket connection established.'),
    onClose: () => console.log('WebSocket connection closed.'),
    onError: (error) => console.error('WebSocket error:', error),
  });

  return { sendMessage, lastMessage, readyState };
}

export default useCustomWebSocket;
