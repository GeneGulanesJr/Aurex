import { useEffect, useRef } from "react";

export function useTabBadge(pendingEscalations: number, terminalCount: number) {
  const baseTitleRef = useRef(document.title.replace(/^\(\d+\)\s*/, ""));

  // Capture base title on first render
  useEffect(() => {
    const stripped = document.title.replace(/^\(\d+\)\s*/, "");
    if (stripped) baseTitleRef.current = stripped;
  }, []);

  // Update the badge whenever the counts change. No cleanup here — resetting
  // the title on every count change would cause a wasteful reset→reapply
  // cycle (and a brief flicker) each time the badge number updates.
  useEffect(() => {
    const total = pendingEscalations + terminalCount;
    if (total > 0) {
      document.title = `(${total}) ${baseTitleRef.current}`;
    } else {
      document.title = baseTitleRef.current;
    }
  }, [pendingEscalations, terminalCount]);

  // Restore the base title only on unmount (empty deps = cleanup runs once).
  useEffect(() => {
    return () => {
      document.title = baseTitleRef.current;
    };
  }, []);
}
