import { useEffect, useCallback, useState } from "react";

export interface ShortcutMap {
  /** Select mission by 1-based position */
  onSelectMissionByIndex?: (index: number) => void;
  /** Approve escalation checkpoint */
  onApprove?: () => void;
  /** Reject escalation checkpoint */
  onReject?: () => void;
  /** Dismiss escalation overlay */
  onDismiss?: () => void;
  /** Open new mission form */
  onNewMission?: () => void;
  /** Toggle sidebar */
  onToggleSidebar?: () => void;
  /** Toggle help overlay */
  onToggleHelp?: () => void;
}

export function useKeyboardShortcuts(map: ShortcutMap) {
  const [helpOpen, setHelpOpen] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Skip if typing in input/textarea/select/contenteditable
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const isContentEditable = (e.target as HTMLElement)?.isContentEditable;
    if (isContentEditable) return;

    // Skip if modifier keys held (allow browser shortcuts)
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const key = e.key;

    // ? — help overlay
    if (key === "?") {
      e.preventDefault();
      setHelpOpen((prev) => !prev);
      map.onToggleHelp?.();
      return;
    }

    // Escape — close help if open, otherwise dismiss escalation
    if (key === "Escape") {
      if (helpOpen) {
        setHelpOpen(false);
        return;
      }
      map.onDismiss?.();
      return;
    }

    // Enter — approve escalation
    if (key === "Enter") {
      map.onApprove?.();
      return;
    }

    // R — reject escalation (only if escalation active)
    if (key === "r" || key === "R") {
      map.onReject?.();
      return;
    }

    // N — new mission
    if (key === "n" || key === "N") {
      e.preventDefault();
      map.onNewMission?.();
      return;
    }

    // [ / ] — toggle sidebar
    if (key === "[" || key === "]") {
      map.onToggleSidebar?.();
      return;
    }

    // 1-9 — select mission by position
    if (/^[1-9]$/.test(key)) {
      const index = parseInt(key, 10) - 1;
      map.onSelectMissionByIndex?.(index);
      return;
    }
  }, [map, helpOpen]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return { helpOpen, setHelpOpen };
}
