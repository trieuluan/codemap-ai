import React, { useState } from 'react';
import {
  annotationExists,
  roles,
  type Annotation,
  type AnnotationTarget,
  type WorkspaceLibrary,
} from '../../shared/library';
import type { NavigationLocation } from '../../shared/navigation';
import type { GraphSnapshot } from '../../shared/model';
import { send } from '../bridge';
import { PanelHeading, PanelTabs } from './InspectorParts';

export function LibraryPanel({
  library,
  snapshot,
  capture,
  restore,
  onClose,
}: {
  library: WorkspaceLibrary;
  snapshot: GraphSnapshot;
  capture: () => NavigationLocation;
  restore: (location: NavigationLocation) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(!library.views.length);
  const [tab, setTab] = useState<'views' | 'notes'>('views');
  const [renaming, setRenaming] = useState<string>();
  const [rename, setRename] = useState('');
  const [menu, setMenu] = useState<string>();
  const rootId = snapshot.root.id;
  return (
    <aside className="inspector library-panel" aria-label="Saved Views">
      <PanelHeading
        eyebrow="Workspace library"
        title="Saved Views"
        subtitle="Pick up where you left off."
        action={
          <button
            className="icon-button"
            aria-label="Close Saved Views"
            title="Close Saved Views"
            onClick={onClose}
          >
            ×
          </button>
        }
      />
      <PanelTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'views', label: 'Views', count: library.views.length },
          { id: 'notes', label: 'Notes', count: library.annotations.length },
        ]}
      />
      <div className="inspector-body">
        {tab === 'views' ? (
          <>
            <div className="section-toolbar">
              <span className="eyebrow">Your views</span>
              <button
                className="quiet-button"
                onClick={() => setCreating(!creating)}
                aria-expanded={creating}
              >
                + Save view
              </button>
            </div>
            {creating && (
              <form
                className="save-view-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!name.trim()) {
                    return;
                  }
                  send({ type: 'saveBookmark', rootId, name, location: capture() });
                  setName('');
                  setCreating(false);
                }}
              >
                <label htmlFor="saved-view-name">Name this view</label>
                <input
                  id="saved-view-name"
                  autoFocus
                  placeholder="e.g. Dashboard dependencies"
                  aria-label="View name"
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <p className="helper-text">Includes layout, filters, selection and camera.</p>
                <div className="form-actions">
                  <button className="primary" disabled={!name.trim()}>
                    Save current view
                  </button>
                  <button type="button" className="quiet-button" onClick={() => setCreating(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
            {!library.views.length && (
              <div className="library-empty">
                <span className="empty-mark" aria-hidden="true">
                  ◇
                </span>
                <h3>Your first saved view</h3>
                <p>Arrange your graph, then save it here for later.</p>
              </div>
            )}
            <div className="view-list">
              {library.views.map((v) => {
                const state = v.location.view;
                const filters = [
                  state.folder,
                  state.hideTests && 'Hide tests',
                  state.hideIsolated && 'Hide isolated',
                  state.focus && `${state.focus}-hop focus`,
                ].filter(Boolean);
                const context = v.location.path
                  ? 'Import path'
                  : v.location.symbolsFileId
                    ? 'Symbol canvas'
                    : v.location.impact
                      ? 'Impact analysis'
                      : state.mode === 'folders'
                        ? `Folders · depth ${state.depth}`
                        : 'Files';
                return (
                  <article className="view-card" key={v.id}>
                    {renaming === v.id ? (
                      <form
                        className="rename-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (rename.trim()) {
                            send({ type: 'renameBookmark', rootId, id: v.id, name: rename });
                            setRenaming(undefined);
                          }
                        }}
                      >
                        <label htmlFor={`rename-${v.id}`}>Rename view</label>
                        <input
                          id={`rename-${v.id}`}
                          autoFocus
                          aria-label="Rename view"
                          maxLength={100}
                          value={rename}
                          onChange={(e) => setRename(e.target.value)}
                        />
                        <div className="form-actions">
                          <button className="primary" disabled={!rename.trim()}>
                            Save name
                          </button>
                          <button
                            type="button"
                            className="quiet-button"
                            onClick={() => setRenaming(undefined)}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div className="view-card-top">
                          <span className="view-icon" aria-hidden="true">
                            ◇
                          </span>
                          <button
                            className="view-name"
                            onClick={() => restore(v.location)}
                            aria-label={`Open ${v.name}`}
                            title={v.name}
                          >
                            {v.name}
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`Manage ${v.name}`}
                            aria-expanded={menu === v.id}
                            title="View actions"
                            onClick={() => setMenu(menu === v.id ? undefined : v.id)}
                          >
                            ⋯
                          </button>
                        </div>
                        <div className="view-card-meta">
                          <span>{context}</span>
                          <span>{filters.length ? `${filters.length} filters` : 'All files'}</span>
                        </div>
                        <button
                          className="view-open"
                          onClick={() => restore(v.location)}
                          aria-label={`Restore ${v.name}`}
                        >
                          Restore view <span aria-hidden="true">↗</span>
                        </button>
                        {menu === v.id && (
                          <div className="view-menu" aria-label={`Actions for ${v.name}`}>
                            <button
                              onClick={() => {
                                setRenaming(v.id);
                                setRename(v.name);
                                setMenu(undefined);
                              }}
                            >
                              Rename
                            </button>
                            <button
                              onClick={() => {
                                send({
                                  type: 'saveBookmark',
                                  rootId,
                                  id: v.id,
                                  name: v.name,
                                  location: capture(),
                                });
                                setMenu(undefined);
                              }}
                            >
                              Replace with current view
                            </button>
                            <button
                              className="danger-button"
                              onClick={() => {
                                send({ type: 'deleteBookmark', rootId, id: v.id });
                                setMenu(undefined);
                              }}
                            >
                              Delete view
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="section-toolbar">
              <span className="eyebrow">Architecture notes</span>
              <span className="muted">{library.annotations.length} saved</span>
            </div>
            {!library.annotations.length && (
              <div className="library-empty">
                <h3>Give your graph context</h3>
                <p>Select a file or folder, then add its purpose and role in Notes.</p>
              </div>
            )}
            {library.annotations.map((a) => {
              const path =
                a.target.kind === 'file'
                  ? (snapshot.nodes.find((n) => n.id === a.target.id)?.path ??
                    a.target.id.split('/').at(-1) ??
                    a.target.id)
                  : a.target.id;
              const exists = annotationExists(a.target, snapshot);
              return (
                <article className="note-card" key={JSON.stringify(a.target)}>
                  <div className="note-card-title">
                    <strong title={a.target.id}>{path}</strong>
                    {a.role && <span className="badge">{a.role}</span>}
                  </div>
                  {!exists && (
                    <span className="missing-target">Missing target · note retained</span>
                  )}
                  <p className="architecture-text">{a.text || 'Role only · no note added.'}</p>
                  <button
                    className="quiet-button danger-button"
                    onClick={() => send({ type: 'deleteAnnotation', rootId, annotation: a })}
                  >
                    Delete note
                  </button>
                </article>
              );
            })}
          </>
        )}
      </div>
      <div className="inspector-footnote">Saved in this workspace · source stays unchanged</div>
    </aside>
  );
}
export function AnnotationEditor({
  rootId,
  target,
  annotation,
}: {
  rootId: string;
  target: AnnotationTarget;
  annotation?: Annotation;
}) {
  const [text, setText] = useState(annotation?.text ?? '');
  const [role, setRole] = useState(annotation?.role ?? '');
  const dirty = text !== (annotation?.text ?? '') || role !== (annotation?.role ?? '');
  return (
    <section className="annotation-editor">
      <h3>Architecture note</h3>
      <p className="helper-text">Describe the purpose, boundaries or design decisions.</p>
      <label>
        Role
        <select
          aria-label="Architecture role"
          value={role}
          onChange={(e) => setRole(e.target.value as typeof role)}
        >
          <option value="">No role</option>
          {roles.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <textarea
        aria-label="Architecture note"
        maxLength={4000}
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Purpose, boundaries, or design decisions…"
      />
      <div className="form-actions">
        <button
          className="primary"
          disabled={!dirty}
          onClick={() =>
            send({
              type: 'saveAnnotation',
              rootId,
              annotation: { target, text, role: role ? (role as Annotation['role']) : undefined },
            })
          }
        >
          Save note
        </button>
        {dirty && <small className="dirty-note">Unsaved changes</small>}
        {annotation && (
          <button
            className="quiet-button danger-button"
            onClick={() => {
              send({ type: 'deleteAnnotation', rootId, annotation });
              setText('');
              setRole('');
            }}
          >
            Delete note
          </button>
        )}
      </div>
    </section>
  );
}
