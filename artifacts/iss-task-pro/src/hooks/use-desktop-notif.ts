import { useCallback, useEffect, useSyncExternalStore } from "react";
import { enableBackgroundPush, disableBackgroundPush } from "@/lib/push";

// Users who enabled popups before background push existed should get
// subscribed automatically — but only try once per page load.
let pushSyncAttempted = false;

// Tiny shared store so the toggle (Sidebar) and the popup-firing logic
// (NotificationBell) stay in sync across the app.
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const storageKey = (userId: number) => `desktopNotif:${userId}`;

export function useDesktopNotif(userId: number) {
  const getSnapshot = useCallback(() => {
    try {
      return localStorage.getItem(storageKey(userId)) === "1";
    } catch {
      return false;
    }
  }, [userId]);

  const enabled = useSyncExternalStore(subscribe, getSnapshot, () => false);

  // Keep the background-push subscription in sync for users who already
  // enabled popups (idempotent; reuses the existing browser subscription).
  useEffect(() => {
    if (pushSyncAttempted || !enabled) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    pushSyncAttempted = true;
    void enableBackgroundPush();
  }, [enabled]);

  const setEnabled = useCallback(
    (val: boolean) => {
      try {
        localStorage.setItem(storageKey(userId), val ? "1" : "0");
      } catch {
        /* ignore */
      }
      emit();
    },
    [userId]
  );

  // Fire a desktop popup (no-op unless this user enabled it + granted permission).
  // Reads localStorage directly so callers never hit a stale value.
  const notify = useCallback(
    (title: string, body: string): boolean => {
      try {
        if (localStorage.getItem(storageKey(userId)) !== "1") return false;
      } catch {
        return false;
      }
      if (!("Notification" in window) || Notification.permission !== "granted") return false;
      try {
        new Notification(title, { body, icon: "/favicon.ico" });
        return true;
      } catch {
        return false;
      }
    },
    [userId]
  );

  const toggle = useCallback(async () => {
    if (enabled) {
      setEnabled(false);
      // Also stop background pushes to this browser (fire-and-forget).
      void disableBackgroundPush();
      return;
    }
    if (!("Notification" in window)) {
      alert("Your browser does not support desktop notifications.");
      return;
    }
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm === "granted") {
      setEnabled(true);
      // Background push: popups keep coming even after this tab is closed.
      void enableBackgroundPush();
      // Sample popup so the user sees exactly how a real one looks — but only
      // the very first time they enable it, so it doesn't reappear on every
      // toggle-on.
      const welcomeKey = `desktopNotifWelcomed:${userId}`;
      let alreadyWelcomed = false;
      try {
        alreadyWelcomed = localStorage.getItem(welcomeKey) === "1";
      } catch {
        /* ignore */
      }
      if (!alreadyWelcomed) {
        try {
          new Notification("✅ Laptop popup enabled!", {
            body: "You'll now get a popup like this whenever a new task arrives.",
            icon: "/favicon.ico",
          });
          localStorage.setItem(welcomeKey, "1");
        } catch {
          /* ignore */
        }
      }
    } else {
      alert(
        "Notification permission is blocked. Click the 🔒 icon in the browser's address bar, select 'Allow', then turn it on again."
      );
    }
  }, [enabled, setEnabled]);

  return { enabled, toggle, notify };
}
