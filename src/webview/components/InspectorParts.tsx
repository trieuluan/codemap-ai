import React from 'react';
import type { DependencyEdge, FileNode } from '../../shared/model';
import { ImportSiteDetails } from './ImportSiteDetails';

export function PanelHeading({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="inspector-heading">
      <div className="eyebrow">{eyebrow}</div>
      <div className="inspector-title">
        <h2>{title}</h2>
        {action}
      </div>
      {subtitle && <p className="path inspector-subtitle">{subtitle}</p>}
    </div>
  );
}
export function PanelTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="panel-tabs" role="group" aria-label="Panel sections">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          aria-pressed={value === tab.id}
          className={value === tab.id ? 'active' : ''}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && <span className="tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
export function PanelSection({
  title,
  count,
  children,
  open = true,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details className="panel-section" open={open}>
      <summary>
        <span>{title}</span>
        {count !== undefined && <span className="tab-count">{count}</span>}
      </summary>
      <div className="section-content">{children}</div>
    </details>
  );
}
export function ConnectionCard({
  edge,
  nodeId,
  filesById,
  onSelectFile,
}: {
  edge: DependencyEdge;
  nodeId: string;
  filesById: Map<string, FileNode>;
  onSelectFile: (id: string) => void;
}) {
  const file = filesById.get(nodeId);
  const bindings = edge.sites.flatMap((site) => site.symbols?.map((s) => s.local) ?? []);
  return (
    <div className="connection-card">
      <button className="file-row" onClick={() => onSelectFile(nodeId)} title={file?.path}>
        <span className="file-glyph" aria-hidden="true">
          ↗
        </span>
        <span className="file-row-text">
          <strong>{file?.name ?? nodeId}</strong>
          <small>{file?.path}</small>
        </span>
      </button>
      <details className="connection-imports">
        <summary>
          <span>
            {bindings.length
              ? bindings.slice(0, 3).join(', ') +
                (bindings.length > 3 ? ` +${bindings.length - 3}` : '')
              : 'Module import'}
          </span>
          <small>
            {edge.sites.length} {edge.sites.length === 1 ? 'location' : 'locations'}
          </small>
        </summary>
        {edge.sites.map((site) => (
          <ImportSiteDetails key={site.id} nodeId={edge.source} site={site} filesById={filesById} />
        ))}
      </details>
    </div>
  );
}
