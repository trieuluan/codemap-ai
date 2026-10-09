import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useNodes, useReactFlow, type Node } from '@xyflow/react';
import type { GraphViewState } from '../../shared/model';
import { width, height, viewportForNodes } from '../graph-layout';

/** Own camera requests separately from graph analysis and persisted layout state. */
export function useCanvasNavigation(
  nodes: Node[],
  canvasKey: string,
  viewRef: RefObject<GraphViewState>,
  inspecting: boolean,
) {
  const flow = useReactFlow();
  const canvasRef = useRef<HTMLElement>(null);
  const fitCanvas = useCallback(
    (candidates = nodes, duration = 0, padding = 0.15) => {
      const size = canvasRef.current?.getBoundingClientRect();
      if (!size || !candidates.length) {
        return;
      }
      void flow.setViewport(viewportForNodes(candidates, size.width, size.height, padding), {
        duration,
      });
    },
    [nodes, flow],
  );
  const renderedNodes = useNodes();
  const needsViewport = useRef(true);
  const fitMembers = useRef<string[] | undefined>(undefined);
  const pendingCenter = useRef<string | undefined>(undefined);
  const readyToSaveViewport = useRef(false);
  useEffect(() => {
    if (
      !nodes.length ||
      renderedNodes.length !== nodes.length ||
      nodes.some((node) => {
        const rendered = renderedNodes.find((item) => item.id === node.id);
        return (
          rendered?.data.layoutKey !== canvasKey ||
          rendered.position.x !== node.position.x ||
          rendered.position.y !== node.position.y
        );
      })
    ) {
      return;
    }
    if (fitMembers.current?.every((id) => flow.getNode(id))) {
      const members = fitMembers.current;
      fitMembers.current = undefined;
      needsViewport.current = false;
      fitCanvas(
        nodes.filter((node) => members.includes(node.id)),
        250,
        0.2,
      );
    } else if (pendingCenter.current) {
      const node = flow.getNode(pendingCenter.current);
      if (node) {
        pendingCenter.current = undefined;
        needsViewport.current = false;
        void flow.setCenter(node.position.x + width / 2, node.position.y + height / 2, {
          zoom: 1,
          duration: 250,
        });
      }
    } else if (needsViewport.current) {
      needsViewport.current = false;
      const viewport = inspecting ? undefined : viewRef.current.viewport;
      if (viewport) {
        void flow.setViewport(viewport);
      } else {
        fitCanvas();
      }
    }
    readyToSaveViewport.current = true;
  }, [nodes, renderedNodes, flow, inspecting, canvasKey, fitCanvas]);
  return {
    flow,
    canvasRef,
    fitCanvas,
    needsViewport,
    fitMembers,
    pendingCenter,
    readyToSaveViewport,
  };
}
