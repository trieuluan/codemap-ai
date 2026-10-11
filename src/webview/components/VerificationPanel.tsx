import React from 'react';
import type { VerificationReport } from '../../shared/verification';
import type { AiGraphAction } from '../../shared/ai-actions';
import { send } from '../bridge';

export function VerificationPanel({
  report,
  error,
  include,
  onInclude,
  onAction,
  onRepair,
  historical = false,
}: {
  report: VerificationReport;
  error: string;
  include: boolean;
  onInclude: (value: boolean) => void;
  onAction: (action: AiGraphAction) => void;
  onRepair?: () => void;
  historical?: boolean;
}) {
  const running = report.test?.state === 'running';
  const focus = (ids: string[]) =>
    onAction({
      id: `verification:${report.id}`,
      kind: 'focus',
      fileIds: ids,
      paths: [],
      reason: 'Post-Apply impact',
    });
  return (
    <section className="ai-verification" aria-label="Post-Apply verification">
      <div className="section-toolbar">
        <strong>After Apply</strong>
        <span className={`ai-connection ${report.stale ? '' : 'connected'}`}>
          {report.stale ? 'Out of date' : 'Observed'}
        </span>
      </div>
      <small>
        {new Date(report.observedAt).toLocaleTimeString()} · revision {report.revision}
      </small>
      {report.stale && (
        <p className="context-warning">
          {historical
            ? 'Earlier round · kept for reference. Use the latest report to test or prepare a repair.'
            : 'Source changed since this report. These observations describe the previous Apply.'}
        </p>
      )}
      <div className="ai-verification-stats">
        <span>
          <strong>{report.changedFiles.length}</strong> changed files
        </span>
        <span>
          <strong>{report.affectedFiles.length}</strong> static dependents
        </span>
      </div>
      <div className="ai-connection-actions">
        <button onClick={() => focus(report.changedFiles.map((f) => f.id))}>
          Show changed files
        </button>
        <button
          disabled={!report.affectedFiles.length}
          onClick={() => focus([...report.changedFiles.map((f) => f.id), ...report.affectedFiles])}
        >
          Show impact
        </button>
      </div>
      <details open={report.diagnostics.some((d) => d.severity === 'error')}>
        <summary>
          VS Code diagnostics · +{report.addedDiagnostics.length} / −
          {report.removedDiagnostics.length}
        </summary>
        <p className="helper-text">
          Current observations, up to 100 diagnostics. Language providers may still be updating;
          absence of errors does not prove correctness.
        </p>
        {report.diagnostics.length ? (
          report.diagnostics.map((d, i) => (
            <div className="ai-diagnostic" key={i}>
              <button
                className="quiet-button"
                disabled={report.stale || historical}
                onClick={() => send({ type: 'aiOpenDiagnostic', reportId: report.id, index: i })}
              >
                {d.path}:L{d.line} · {d.severity} ↗
              </button>
              <p>{d.message}</p>
            </div>
          ))
        ) : (
          <p className="helper-text">No diagnostics reported by VS Code yet.</p>
        )}
      </details>
      <details>
        <summary>
          Imports · +{report.addedImports.length} / −{report.removedImports.length}
        </summary>
        {report.graphError && (
          <p className="context-warning">Graph refresh failed: {report.graphError}</p>
        )}
        {report.addedImports.map((e, i) => (
          <p key={`a${i}`}>
            + {e.source} → {e.target}
          </p>
        ))}
        {report.removedImports.map((e, i) => (
          <p key={`r${i}`}>
            − {e.source} → {e.target}
          </p>
        ))}
      </details>
      <div className="ai-test-section">
        <span className="eyebrow">Project tests</span>
        <p className="helper-text">
          Choose a package test script. Tests read files on disk; unsaved buffers are excluded.
          Saving can trigger project save hooks.
        </p>
        <div className="ai-test-actions">
          {historical ? (
            <p className="helper-text">
              Historical round; tests and repair are available only for the latest current report.
            </p>
          ) : running ? (
            <button onClick={() => send({ type: 'aiStopTest' })}>Stop test</button>
          ) : (
            <>
              <button onClick={() => send({ type: 'aiRunTest', reportId: report.id, save: false })}>
                Choose test · disk only
              </button>
              <button onClick={() => send({ type: 'aiRunTest', reportId: report.id, save: true })}>
                Save changed files & choose test
              </button>
            </>
          )}
        </div>
        {error && (
          <p className="context-warning" role="alert">
            {error}
          </p>
        )}
        {report.test && (
          <details open={running || report.test.state === 'failed'}>
            <summary>
              {report.test.name} · {report.test.state}
              {report.test.exitCode !== undefined ? ` (exit ${report.test.exitCode})` : ''}
            </summary>
            <p className="helper-text">
              {report.test.saved
                ? 'Changed files saved before test. Other buffers may remain unsaved.'
                : 'Disk only: unsaved AI edits may not be tested.'}
            </p>
            <pre className="ai-test-output">
              {report.test.output || (running ? 'Waiting for output…' : 'No output captured.')}
              {report.test.truncated ? '\n… Output truncated at 32,000 characters.' : ''}
            </pre>
          </details>
        )}
      </div>
      <label className="ai-verification-share">
        <input
          type="checkbox"
          checked={include && !report.stale && !running}
          disabled={report.stale || running || historical}
          onChange={(event) => onInclude(event.target.checked)}
        />
        Include this report and test output in the next AI request
      </label>
      {onRepair && (
        <button
          disabled={
            report.stale ||
            historical ||
            running ||
            (!report.diagnostics.some((d) => d.severity === 'error') &&
              report.test?.state !== 'failed')
          }
          onClick={onRepair}
        >
          Prepare repair plan →
        </button>
      )}
      <small>Stays local until you include it and submit an AI request.</small>
    </section>
  );
}
