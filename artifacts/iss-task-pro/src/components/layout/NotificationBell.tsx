import { useState, useEffect, useRef } from "react";
import {
  useListNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useDeleteNotification,
  useClearAllNotifications,
  useUpdateTaskStatus,
  useUpdateTask,
  getListNotificationsQueryKey,
  getListTasksQueryKey,
  getGetTaskSummaryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useDesktopNotif } from "@/hooks/use-desktop-notif";

interface NotificationBellProps {
  userId: number;
}

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending", emoji: "🔔", active: "bg-red-500 text-white border-red-500", idle: "bg-red-50 text-red-600 border-red-200 hover:border-red-400 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800 dark:hover:border-red-600" },
  { value: "inProgress", label: "Ongoing", emoji: "⏳", active: "bg-amber-500 text-white border-amber-500", idle: "bg-amber-50 text-amber-600 border-amber-200 hover:border-amber-400 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 dark:hover:border-amber-600" },
  { value: "done", label: "Completed", emoji: "✅", active: "bg-green-600 text-white border-green-600", idle: "bg-green-50 text-green-700 border-green-200 hover:border-green-400 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800 dark:hover:border-green-600" },
];

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

interface AssignPopup {
  notifId: number;
  taskId: number;
  message: string;
}

export default function NotificationBell({ userId }: NotificationBellProps) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; message: string; type: string }[]>([]);
  const [assignQueue, setAssignQueue] = useState<AssignPopup[]>([]);
  const [popupStatus, setPopupStatus] = useState("pending");
  const [popupRemark, setPopupRemark] = useState("");
  const [popupError, setPopupError] = useState("");
  const seenIds = useRef<Set<number> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { enabled: desktopOn } = useDesktopNotif(userId);
  const desktopOnRef = useRef(desktopOn);
  desktopOnRef.current = desktopOn;

  // Reset the "already seen" set on user switch so we don't replay/cross over.
  useEffect(() => {
    seenIds.current = null;
  }, [userId]);

  // Show a laptop/desktop popup for a fresh notification (only when toggle is ON + permission granted)
  const showDesktop = (title: string, body: string) => {
    if (!desktopOnRef.current) return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    try { new Notification(title, { body, icon: "/favicon.ico" }); } catch { /* ignore */ }
  };

  const currentPopup = assignQueue[0] ?? null;

  const { data: notifications = [], isSuccess } = useListNotifications(
    { userId },
    { query: { refetchInterval: 15000, queryKey: getListNotificationsQueryKey({ userId }) } }
  );
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const deleteNotif = useDeleteNotification();
  const clearAll = useClearAllNotifications();
  const updateStatus = useUpdateTaskStatus();
  const updateTask = useUpdateTask();

  const unreadCount = notifications.filter((n) => !n.read).length;

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListNotificationsQueryKey({ userId }) });

  // Pop a notification whenever a brand-new unread one arrives.
  useEffect(() => {
    // Wait for the first real fetch to resolve before snapshotting the "already
    // seen" ids. While the query is still loading, `notifications` is the empty
    // default array — snapshotting that would leave the set empty, so when the
    // real data arrived on the next render every existing notification would look
    // brand-new and re-pop. That was the bug: old, already-seen notifications
    // replayed their toast/popup on every login or refresh.
    if (!isSuccess) return;
    if (seenIds.current === null) {
      // First successful load — remember existing ids, don't pop old ones.
      seenIds.current = new Set(notifications.map((n) => n.id));
      return;
    }
    const fresh = notifications.filter((n) => !seenIds.current!.has(n.id) && !n.read);
    if (fresh.length > 0) {
      // Laptop/desktop screen popups (only when the user turned the toggle ON).
      fresh.forEach((n) =>
        showDesktop(
          n.type === "task_completed"
            ? "✅ Task Complete!"
            : n.type === "due_reminder"
              ? "⏰ Task Due Soon!"
              : "📋 New Task!",
          n.message
        )
      );
      // Newly-assigned tasks → center popup queue (status + remark). Others → corner toast.
      const freshAssigns = fresh.filter((n) => n.type === "task_assigned" && n.taskId);
      if (freshAssigns.length > 0) {
        setAssignQueue((prev) => [
          ...prev,
          ...freshAssigns.map((n) => ({ notifId: n.id, taskId: n.taskId!, message: n.message })),
        ]);
      }
      const cornerOnes = fresh.filter((n) => !(n.type === "task_assigned" && n.taskId));
      if (cornerOnes.length > 0) {
        setToasts((prev) => [...cornerOnes.map((n) => ({ id: n.id, message: n.message, type: n.type })), ...prev]);
        cornerOnes.forEach((n) => {
          setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== n.id)), 8000);
        });
      }
    }
    notifications.forEach((n) => seenIds.current!.add(n.id));
  }, [notifications, isSuccess]);

  // Reset the form whenever a different popup reaches the front of the queue.
  useEffect(() => {
    setPopupStatus("pending");
    setPopupRemark("");
    setPopupError("");
  }, [currentPopup?.notifId]);

  const dequeue = () => setAssignQueue((prev) => prev.slice(1));

  const handlePopupSave = () => {
    if (!currentPopup) return;
    setPopupError("");
    const { notifId, taskId } = currentPopup;
    const finishUp = () => {
      qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
      qc.invalidateQueries({ queryKey: getGetTaskSummaryQueryKey() });
      markRead.mutate({ id: notifId }, { onSuccess: invalidate });
      dequeue();
    };
    // Update status first (this fires the giver's completion notification on "done").
    updateStatus.mutate(
      { id: taskId, data: { status: popupStatus } },
      {
        onSuccess: () => {
          if (popupRemark.trim()) {
            updateTask.mutate(
              { id: taskId, data: { remark: popupRemark.trim() } },
              { onSuccess: finishUp, onError: () => setPopupError("Remark could not be saved. Please try again.") }
            );
          } else {
            finishUp();
          }
        },
        onError: () => setPopupError("Could not save. Please try again."),
      }
    );
  };

  const handlePopupClose = () => {
    if (currentPopup) markRead.mutate({ id: currentPopup.notifId }, { onSuccess: invalidate });
    dequeue();
  };

  // Close dropdown on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const handleItemClick = (id: number, read: boolean) => {
    if (!read) markRead.mutate({ id }, { onSuccess: invalidate });
  };

  const handleMarkAll = () => {
    markAllRead.mutate({ data: { userId } }, { onSuccess: invalidate });
  };

  const handleClearOne = (id: number) => {
    deleteNotif.mutate({ id }, { onSuccess: invalidate });
  };

  const handleClearAll = () => {
    clearAll.mutate({ data: { userId } }, { onSuccess: invalidate });
  };

  const popupSaving = updateStatus.isPending || updateTask.isPending;

  return (
    <>
      {/* Center popup for a newly-assigned task (status + remark) */}
      {currentPopup && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }}>
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md mx-4 animate-in zoom-in-95" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4 text-center">
              <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-3">
                <span className="text-3xl">📋</span>
              </div>
              <h2 className="text-lg font-extrabold text-foreground">You Got a New Task!</h2>
              <p className="text-sm text-muted-foreground mt-1">{currentPopup.message}</p>
              {assignQueue.length > 1 && (
                <p className="text-xs text-primary font-semibold mt-1">+{assignQueue.length - 1} more new task(s)</p>
              )}
            </div>

            <div className="px-6 pb-2">
              <label className="block text-sm font-bold text-foreground mb-2">Set status</label>
              <div className="grid grid-cols-3 gap-2">
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setPopupStatus(s.value)}
                    className={`py-2.5 rounded-xl border-2 text-xs font-bold transition ${popupStatus === s.value ? s.active : s.idle}`}
                  >
                    <div className="text-base">{s.emoji}</div>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="px-6 py-4">
              <label className="block text-sm font-bold text-foreground mb-1">Remark (optional)</label>
              <textarea
                value={popupRemark}
                onChange={(e) => setPopupRemark(e.target.value)}
                rows={2}
                placeholder="Add a note or reply..."
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {popupError && (
              <div className="mx-6 mb-2 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-sm px-3 py-2 rounded-lg">{popupError}</div>
            )}

            <div className="flex gap-3 px-6 pb-6">
              <button
                type="button"
                onClick={handlePopupClose}
                disabled={popupSaving}
                className="flex-1 py-2.5 border border-border text-muted-foreground font-bold rounded-xl text-sm hover:bg-muted transition disabled:opacity-60"
              >
                Later
              </button>
              <button
                type="button"
                onClick={handlePopupSave}
                disabled={popupSaving}
                className="flex-1 py-2.5 bg-primary text-white font-bold rounded-xl text-sm hover:bg-primary/90 transition disabled:opacity-60"
              >
                {popupSaving ? "Saving..." : "✔ Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast popups (top-right) */}
      <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 w-80 max-w-[90vw]">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="bg-card border border-primary/30 shadow-lg rounded-xl p-3 flex items-start gap-2 animate-in slide-in-from-right"
          >
            <span className="text-xl shrink-0">{t.type === "task_completed" ? "✅" : t.type === "due_reminder" ? "⏰" : "📋"}</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-primary">
                {t.type === "task_completed" ? "Task Complete!" : t.type === "due_reminder" ? "Task Due Soon!" : "New Task!"}
              </div>
              <div className="text-sm text-foreground mt-0.5">{t.message}</div>
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="text-muted-foreground hover:text-muted-foreground text-sm shrink-0"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Bell */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen((o) => !o)}
          data-testid="btn-notifications"
          className="relative w-10 h-10 rounded-full bg-muted hover:bg-muted flex items-center justify-center transition"
          aria-label="Notifications"
        >
          <span className="text-lg">🔔</span>
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
              <span className="font-bold text-foreground text-sm">Notifications</span>
              <div className="flex items-center gap-3">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAll}
                    className="text-xs text-primary hover:text-primary font-medium"
                  >
                    Mark all read
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    onClick={handleClearAll}
                    disabled={clearAll.isPending}
                    className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium disabled:opacity-60"
                  >
                    🗑 Clear all
                  </button>
                )}
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-muted-foreground text-sm">No notifications</div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`w-full px-4 py-3 border-b border-border hover:bg-muted flex items-start gap-2 transition ${
                      n.read ? "opacity-60" : "bg-primary/10/40"
                    }`}
                  >
                    <button
                      onClick={() => handleItemClick(n.id, n.read)}
                      className="flex items-start gap-2 flex-1 min-w-0 text-left"
                    >
                      <span className="text-base shrink-0">{n.type === "task_completed" ? "✅" : n.type === "due_reminder" ? "⏰" : "📋"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-foreground">{n.message}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{timeAgo(n.createdAt)}</div>
                      </div>
                      {!n.read && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                    </button>
                    <button
                      onClick={() => handleClearOne(n.id)}
                      disabled={deleteNotif.isPending}
                      aria-label="Clear notification"
                      title="Clear"
                      className="text-muted-foreground hover:text-red-500 dark:hover:text-red-400 text-sm shrink-0 px-1 disabled:opacity-60"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
