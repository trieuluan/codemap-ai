import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';
import { send } from './bridge';

export const width = 300;
export const height = 70;
export function layout(nodes: Node[], edges: Edge[]): Node[] {
  const started = performance.now();
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 90 });
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
