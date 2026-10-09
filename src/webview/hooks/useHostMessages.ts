import { useEffect, useRef } from 'react';
import type { HostMessage } from '../../shared/model';
import { send } from '../bridge';

/** Subscribe once; a re-render must not trigger another host scan via ready. */
export function useHostMessages(receive: (message: HostMessage) => void): void {
  const receiveRef = useRef(receive);
  useEffect(() => {
    receiveRef.current = receive;
  }, [receive]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<HostMessage>) => receiveRef.current(event.data);
    window.addEventListener('message', handleMessage);
    send({ type: 'ready' });
    return () => window.removeEventListener('message', handleMessage);
  }, []);
}
