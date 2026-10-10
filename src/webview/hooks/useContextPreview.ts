import { useEffect, useRef, useState } from 'react';
import { contextRegionKey, type ContextBundle, type ContextOptions } from '../../shared/context';
import type { GraphSnapshot, HostMessage } from '../../shared/model';
import { send } from '../bridge';

export interface PreparedContext {
  bundle: ContextBundle;
  contextId: string;
}

/** Preview and Ask share one preparation; selection changes reject pending callers. */
export function useContextPreview(
  snapshot: GraphSnapshot,
  fileIds: string[],
  options: ContextOptions = { mode: 'full' },
) {
  const [bundle, setBundle] = useState<ContextBundle>();
  const [building, setBuilding] = useState(false);
  const [message, setMessage] = useState('');
  const request = useRef<string | undefined>(undefined);
  const prepared = useRef<PreparedContext | undefined>(undefined);
  const pending = useRef<
    | {
        promise: Promise<PreparedContext>;
        resolve: (value: PreparedContext) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
        mode: 'full' | 'focused';
      }
    | undefined
  >(undefined);
  const focus = snapshot.nodes
    .find((n) => n.id === options.symbol?.nodeId)
    ?.declarations?.find((s) => s.id === options.symbol?.symbolId);
  const conversationKey = contextRegionKey(
    snapshot.root.id,
    fileIds,
    focus ? `${options.symbol!.nodeId}:${focus.kind}:${focus.name}` : '',
  );
  const regionKey = JSON.stringify([conversationKey, snapshot.revision, options.mode]);
  useEffect(() => {
    request.current = undefined;
    prepared.current = undefined;
    setBundle(undefined);
    setBuilding(false);
    setMessage('');
    return () => {
      if (pending.current) {
        clearTimeout(pending.current.timer);
        pending.current.reject(new Error('Selection changed. Ask again with the current files.'));
        pending.current = undefined;
      }
    };
  }, [regionKey]);
  useEffect(() => {
    const receive = (event: MessageEvent<HostMessage>) => {
      const value = event.data;
      if (
        (value.type !== 'contextResult' && value.type !== 'contextCopied') ||
        value.rootId !== snapshot.root.id ||
        value.requestId !== request.current
      ) {
        return;
      }
      if (value.type === 'contextCopied') {
        setMessage('Copied to clipboard.');
        return;
      }
      const waiting = pending.current;
      pending.current = undefined;
      if (waiting) {
        clearTimeout(waiting.timer);
      }
      setBuilding(false);
      const valid = value.bundle?.revision === snapshot.revision ? value.bundle : undefined;
      prepared.current = valid ? { bundle: valid, contextId: value.requestId } : undefined;
      setBundle(valid);
      setMessage(value.error ?? '');
      if (valid) {
        waiting?.resolve({ bundle: valid, contextId: value.requestId });
      } else {
        waiting?.reject(new Error(value.error ?? 'Context could not be prepared. Try again.'));
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [snapshot.root.id, snapshot.revision]);
  const prepare = (action: 'ask' | 'propose' = 'ask'): Promise<PreparedContext> => {
    const mode = action === 'propose' ? 'full' : options.mode;
    if (pending.current) {
      return pending.current.mode === mode
        ? pending.current.promise
        : pending.current.promise.then(() => prepare(action));
    }
    if (prepared.current && (prepared.current.bundle.mode ?? 'full') === mode) {
      return Promise.resolve(prepared.current);
    }
    const requestId = crypto.randomUUID();
    request.current = requestId;
    setBuilding(true);
    setMessage('');
    let resolve!: (value: PreparedContext) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<PreparedContext>((success, failure) => {
      resolve = success;
      reject = failure;
    });
    const timer = setTimeout(() => {
      if (request.current === requestId) {
        pending.current = undefined;
        request.current = undefined;
        setBuilding(false);
        setMessage('Context preparation timed out. Try again.');
        reject(new Error('Context preparation timed out. Try again.'));
      }
    }, 30000);
    pending.current = { promise, resolve, reject, timer, mode };
    send({
      type: 'buildContext',
      rootId: snapshot.root.id,
      revision: snapshot.revision,
      requestId,
      fileIds,
      options: { ...options, mode },
    });
    return promise;
  };
  return {
    bundle,
    building,
    message,
    contextId: bundle ? request.current : undefined,
    regionKey,
    conversationKey,
    prepare,
  };
}
