import { useEffect, useRef, useCallback } from "react";
import type { WsClientEvent } from "@aurex/shared";

type NotificationEvent = {
  type: "escalation" | "completed" | "failed";
  title: string;
  body: string;
  missionId: string;
};

function toNotificationEvent(event: WsClientEvent): NotificationEvent | null {
  switch (event.type) {
    case "escalation":
      return {
        type: "escalation",
        title: "Checkpoint Pending",
        body: `Mission ${event.missionId.slice(0, 8)}… needs your decision`,
        missionId: event.missionId,
      };
    case "mission_completed":
      if (event.finalState === "completed") {
        return {
          type: "completed",
          title: "Mission Complete",
          body: `Mission ${event.missionId.slice(0, 8)}… finished successfully`,
          missionId: event.missionId,
        };
      }
      return {
        type: "failed",
        title: "Mission Failed",
        body: `Mission ${event.missionId.slice(0, 8)}… has failed`,
        missionId: event.missionId,
      };
    default:
      return null;
  }
}

export function useNotifications(wsEvent: WsClientEvent | null, selectedMissionId: string | null, enabled: boolean = true) {
  const permissionRef = useRef<NotificationPermission>("default");
  const lastNotifiedRef = useRef<Set<string>>(new Set());

  // Request permission on mount (only if enabled)
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
      permissionRef.current = "granted";
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((p) => {
        permissionRef.current = p;
      });
    }
  }, [enabled]);

  const notify = useCallback((event: WsClientEvent) => {
    const notif = toNotificationEvent(event);
    if (!notif) return;
    // Don't notify for the currently selected mission (user is already looking at it)
    // unless it's an escalation they might miss
    if (notif.type !== "escalation" && notif.missionId === selectedMissionId) return;

    // Deduplicate: don't re-notify the same event
    const key = `${notif.type}:${notif.missionId}`;
    if (lastNotifiedRef.current.has(key)) return;
    lastNotifiedRef.current.add(key);

    if (!enabled || permissionRef.current !== "granted") return;

    try {
      const n = new Notification(notif.title, {
        body: notif.body,
        tag: key,
        silent: notif.type === "completed",
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      // Notification constructor may throw in some contexts
    }
  }, [selectedMissionId]);

  // Fire notification when a new WS event arrives
  useEffect(() => {
    if (!wsEvent) return;
    notify(wsEvent);
  }, [wsEvent, notify]);
}
