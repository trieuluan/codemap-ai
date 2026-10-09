import dagre from '@dagrejs/dagre';
import { getViewportForBounds, type Node, type Edge } from '@xyflow/react';
import { send } from './bridge';

export const width = 300;
export const height = 70;
export function layout(nodes: Node[], edges: Edge[], direction: 'LR' | 'TB' = 'LR'): Node[] {
  const started = performance.now();
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: direction, nodesep: 28, ranksep: 90 });
  graph.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((node) =>
    graph.setNode(node.id, { width, height: Number(node.style?.height ?? height) }),
  );
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);
  send({ type: 'layoutStats', milliseconds: performance.now() - started, nodes: nodes.length });
  return nodes.map((node) => {
    const position = graph.node(node.id);
    return {
      ...node,
      position: {
        x: position.x - width / 2,
        y: position.y - Number(node.style?.height ?? height) / 2,
      },
    };
  });
}

/** Use known card geometry: virtualized nodes may not have DOM measurements yet. */
export function viewportForNodes(
  nodes: Node[],
  canvasWidth: number,
  canvasHeight: number,
  padding = 0.15,
) {
  const left = Math.min(...nodes.map((node) => node.position.x));
  const top = Math.min(...nodes.map((node) => node.position.y));
  const right = Math.max(...nodes.map((node) => node.position.x + width));
  const bottom = Math.max(
    ...nodes.map((node) => node.position.y + Number(node.style?.height ?? height)),
  );
  return getViewportForBounds(
    { x: left, y: top, width: right - left, height: bottom - top },
    canvasWidth,
    canvasHeight,
    0.05,
    2,
    padding,
  );
}
