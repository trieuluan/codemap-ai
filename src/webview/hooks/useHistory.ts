import { useEffect, useRef, useState } from 'react';
import { NavigationHistory, type NavigationLocation } from '../../shared/navigation';

export function useHistory(
  root: string | undefined,
  capture: () => NavigationLocation,
  restore: (location: NavigationLocation) => void,
) {
  const history = useRef(new NavigationHistory());
  const historyRoot = useRef<string | undefined>(undefined);
  const pending = useRef(false);
  const [, render] = useState(0);
  const begin = () => {
    history.current.update(capture());
    pending.current = true;
  };
  useEffect(() => {
    if (!root) {
      historyRoot.current = undefined;
      history.current = new NavigationHistory();
      pending.current = false;
      return;
    }
    if (root !== historyRoot.current) {
      historyRoot.current = root;
      history.current = new NavigationHistory();
      history.current.visit(capture());
      pending.current = false;
      render((n) => n + 1);
    } else if (pending.current) {
      pending.current = false;
      history.current.visit(capture());
      render((n) => n + 1);
    }
  });
  return {
    begin,
    canBack: history.current.canBack,
    canForward: history.current.canForward,
    move: (direction: -1 | 1) => {
      pending.current = false;
      history.current.update(capture());
      const location = history.current.move(direction);
      if (location) {
        restore(location);
      }
      render((n) => n + 1);
    },
  };
}
