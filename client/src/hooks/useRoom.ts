import { useCallback, useState } from 'react'

export function useRoom() {
  const [roomId, setRoomId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('roomid'))
  const [inputRoomId, setInputRoomId] = useState(
    () => new URLSearchParams(window.location.search).get('roomid') ?? ''
  )

  const joinRoom = useCallback((id: string) => {
    const trimmedId = id.trim();
    if (!trimmedId) return;
    
    setRoomId(trimmedId);
    
    // Update URL without reloading
    const url = new URL(window.location.href);
    url.searchParams.set('roomid', trimmedId);
    window.history.pushState({}, '', url);
  }, []);

  const generateRoomId = useCallback(() => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }, []);

  const leaveRoom = useCallback(() => {
    setRoomId(null);
    setInputRoomId('');
    
    // Clear URL
    const url = new URL(window.location.href);
    url.searchParams.delete('roomid');
    window.history.pushState({}, '', url);
  }, []);

  const copyRoomLink = useCallback(() => {
    if (!roomId) return;
    const url = new URL(window.location.href);
    url.searchParams.set('roomid', roomId);
    navigator.clipboard.writeText(url.toString());
  }, [roomId]);

  return {
    roomId,
    inputRoomId,
    setInputRoomId,
    joinRoom,
    leaveRoom,
    generateRoomId,
    copyRoomLink
  };
}
