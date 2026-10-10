import type { AiReference } from '../../shared/ai';
import { linkCitations } from '../../shared/markdown';
import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** No raw HTML, images or command links from model output are executed. */
export function AiMarkdown({
  text,
  references = [],
  onReference,
  onCopy,
}: {
  text: string;
  references?: AiReference[];
  onReference?: (ref: AiReference) => void;
  onCopy?: (text: string) => void;
}) {
  return (
    <div className="ai-markdown">
      <Markdown
        skipHtml
        remarkPlugins={[
          remarkGfm,
          () => (tree: unknown) => {
            linkCitations(tree, references);
          },
        ]}
        components={{
          img: ({ alt }) => (
            <span className="helper-text">{alt ? `[Image: ${alt}]` : '[Image omitted]'}</span>
          ),
          a: ({ href, children }) => {
            const citation = /^#codemap-citation-(\d+)$/.exec(href ?? '');
            const reference = citation ? references[Number(citation[1])] : undefined;
            if (reference) {
              return (
                <button
                  className="ai-inline-citation"
                  disabled={!onReference}
                  title={`${reference.path} · L${reference.line}`}
                  onClick={() => onReference?.(reference)}
                >
                  {children}
                </button>
              );
            }
            return /^https?:\/\//i.test(href ?? '') ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            );
          },
          table: ({ children }) => (
            <div className="ai-table-scroll">
              <table>{children}</table>
            </div>
          ),
          pre: ({ children }) => {
            const code = React.isValidElement<{ className?: string; children?: React.ReactNode }>(
              children,
            )
              ? children.props
              : undefined;
            const language = code?.className?.replace(/^language-/, '') ?? 'code';
            return (
              <div className="ai-code-block">
                <div className="ai-code-heading">
                  <span>{language}</span>
                  {onCopy && typeof code?.children === 'string' && (
                    <button onClick={() => onCopy(code.children as string)}>Copy code</button>
                  )}
                </div>
                <pre>{children}</pre>
              </div>
            );
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
