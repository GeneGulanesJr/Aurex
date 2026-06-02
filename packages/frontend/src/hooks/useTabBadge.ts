import { useEffect, useRef } from "react";

export function useTabBadge(pendingEscalations: number, terminalCount: number) {
  const baseTitleRef = useRef(document.title.replace(/^\(\d+\)\s*/, ""));

  useEffect(() => {
    // Capture base title on first render
    const stripped = document.title.replace(/^\(\d+\)\s*/, "");
    if (stripped) baseTitleRef.current = stripped;
  }, []);

  useEffect(() => {
    const total = pendingEscalations + terminalCount;
    if (total > 0) {
      document.title = `(${total}) ${baseTitleRef.current}`;
    } else {
      document.title = baseTitleRef.current;
    }
  }, [pendingEscalations, terminalCount]);
}
