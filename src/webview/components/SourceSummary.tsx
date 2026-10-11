import React, { useEffect, useState } from 'react';
import type { ContextBundle } from '../../shared/context';
import { contextSummary } from '../../shared/assistant-view';
import type { PreparedContext } from '../hooks/useContextPreview';

export function SourceSummary({
  bundle,
  fileCount,
  regionKey,
  mode,
  ready,
  busy,
  prepare,
  onManage,
}: {
  bundle?: ContextBundle;
  fileCount: number;
  regionKey: string;
  mode: 'ask' | 'propose';
  ready: boolean;
  busy: boolean;
  prepare: (action: 'ask' | 'propose') => Promise<PreparedContext>;
  onManage: () => void;
}) {
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    let active = true;
    if (!ready || busy) {
      return;
    }
    const timer = setTimeout(() => {
      void prepare(mode).catch((error) => {
        if (active) {
          setError(String(error));
        }
      });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // Prepare is a per-render closure; rebuild only when its source inputs change.
  }, [regionKey, mode, ready, busy]);
  const current = bundle && (mode !== 'propose' || bundle.mode === 'full');
  const summary = current ? contextSummary(bundle) : undefined;
  return (
    <details className="assistant-source-summary">
      <summary>
        {!fileCount
          ? 'Select files to prepare source'
          : !ready
            ? 'Source changed · waiting for sync'
            : summary
              ? `${summary.files} ${summary.files === 1 ? 'file' : 'files'} · ~${summary.tokens.toLocaleString()} context tokens · ${bundle?.mode === 'focused' ? 'Focused excerpts' : 'Whole files'}`
              : error
                ? 'Source preparation failed · view details'
                : 'Preparing local source summary…'}
      </summary>
      <p>
        Each submission uses freshly validated source. This estimate excludes your prompt,
        conversation history and provider overhead. Edit uses whole files.
      </p>
      {error && (
        <p role="alert" className="context-warning">
          {error}
        </p>
      )}
      {current && (
        <ul>
          {bundle.files.map((file) => (
            <li key={file.id}>
              <strong>{file.path}</strong>
              <small>
                {file.truncated
                  ? 'Truncated · unavailable for Edit'
                  : file.excerpts?.length
                    ? file.excerpts.map((e) => `L${e.startLine}–${e.endLine}`).join(', ')
                    : 'Whole file'}{' '}
                · {file.content.length.toLocaleString()} characters
              </small>
            </li>
          ))}
        </ul>
      )}
      {!!summary?.omitted && (
        <p className="context-warning">{summary.omitted} selected files could not be included.</p>
      )}
      {!!summary?.truncated && (
        <p className="context-warning">
          {summary.truncated} files were cut to the source budget. Narrow the selection for complete
          source.
        </p>
      )}
      <button onClick={onManage}>Manage source →</button>
    </details>
  );
}
