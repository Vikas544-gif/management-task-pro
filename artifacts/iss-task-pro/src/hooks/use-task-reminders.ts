import { useEffect, useRef } from "react";
import { useListTasks, getListTasksQueryKey } from "@workspace/api-client-react";
import { useDesktopNotif } from "./use-desktop-notif";

const pad2 = (n: number) => String(n).padStart(2, "0");
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

// ── Personal (self-set) reminders ───────────────────────────────────────────
// Each user can set their OWN reminder timing for any of their tasks, stored
// per-user in localStorage (separate from the task's assigner-set dueTime).
// A reminder has a START time and an END time: one popup fires at the start
// time and one at the end time. After the end time it can keep nagging a fixed
// number of extra times (the user picks HOW MANY) until the task is marked
// done — the spacing of those nags is fixed so the user never has to think
// about minutes.
// Stored as JSON: { start, end, afterEndCount }.
// Legacy values ({ at, count, interval } or a plain "YYYY-MM-DDTHH:MM" string)
// are still read: `at` becomes the start time, with no end and no extra nags.
export const personalReminderKey = (userId: number, taskId: number) =>
  `taskReminder:${userId}:${taskId}`;

// Default gap (minutes) between the post-end "keep nagging" reminders, used
// when a stored reminder has no explicit interval (legacy / fallback).
export const AFTER_END_INTERVAL_MIN = 10;

export type PersonalReminder = {
  start: string; // "YYYY-MM-DDTHH:MM" (matches <input type="datetime-local">)
  end: string; // "YYYY-MM-DDTHH:MM" or "" when no end time is set
  afterEndCount: number; // extra reminders AFTER the end time (>= 0)
  afterEndInterval: number; // minutes between those post-end reminders (>= 1)
};

export function getPersonalReminderConfig(
  userId: number,
  taskId: number
): PersonalReminder | null {
  let raw = "";
  try {
    raw = localStorage.getItem(personalReminderKey(userId, taskId)) ?? "";
  } catch {
    return null;
  }
  if (!raw) return null;
  // New JSON format.
  if (raw.startsWith("{")) {
    try {
      const o = JSON.parse(raw) as Partial<PersonalReminder> & { at?: string };
      if (o.start) {
        const end = typeof o.end === "string" ? o.end : "";
        const afterEndCount = Math.max(0, Math.floor(Number(o.afterEndCount) || 0));
        const afterEndInterval = Math.max(1, Math.floor(Number(o.afterEndInterval) || AFTER_END_INTERVAL_MIN));
        return { start: o.start, end, afterEndCount, afterEndInterval };
      }
      // Legacy { at, count, interval } → start only.
      if (o.at) return { start: o.at, end: "", afterEndCount: 0, afterEndInterval: AFTER_END_INTERVAL_MIN };
      return null;
    } catch {
      return null;
    }
  }
  // Legacy plain-string format → start only.
  return { start: raw, end: "", afterEndCount: 0, afterEndInterval: AFTER_END_INTERVAL_MIN };
}

export function setPersonalReminderConfig(
  userId: number,
  taskId: number,
  config: PersonalReminder | null
) {
  try {
    if (config && config.start) {
      const end = typeof config.end === "string" ? config.end : "";
      const afterEndCount = Math.max(0, Math.floor(config.afterEndCount || 0));
      const afterEndInterval = Math.max(1, Math.floor(config.afterEndInterval || AFTER_END_INTERVAL_MIN));
      localStorage.setItem(
        personalReminderKey(userId, taskId),
        JSON.stringify({ start: config.start, end, afterEndCount, afterEndInterval })
      );
    } else {
      localStorage.removeItem(personalReminderKey(userId, taskId));
    }
  } catch {
    /* ignore */
  }
}

// Back-compat helper: returns just the start date+time string ("" when unset).
export function getPersonalReminder(userId: number, taskId: number): string {
  return getPersonalReminderConfig(userId, taskId)?.start ?? "";
}

// Fires a desktop popup reminder for the current user's own tasks. Two sources:
//  1) The assigner-set dueTime (only for tasks due today).
//  2) The user's own personal reminder date+time (any day, today or future).
// Each reminder fires exactly once (dedup in localStorage). Requires the
// per-user "laptop popup" toggle ON + browser notification permission granted.
export function useTaskReminders(userId: number) {
  const { notify } = useDesktopNotif(userId);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const params = { assignedTo: userId };
  const { data: tasks = [] } = useListTasks(params, {
    query: { queryKey: getListTasksQueryKey(params), refetchInterval: 60000 },
  });
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  useEffect(() => {
    const fireOnce = (key: string, title: string, body: string) => {
      try {
        if (localStorage.getItem(key) === "1") return;
      } catch {
        return;
      }
      const shown = notifyRef.current(title, body);
      if (shown) {
        try {
          localStorage.setItem(key, "1");
        } catch {
          /* ignore */
        }
      }
    };

    const check = () => {
      const today = todayStr();
      const now = new Date();
      for (const t of tasksRef.current) {
        if (t.status === "done") continue;

        // 1) Assigner-set due time (today only).
        if (t.dueTime && t.dueDate === today) {
          const due = new Date(`${t.dueDate}T${t.dueTime}`);
          if (!isNaN(due.getTime()) && now >= due) {
            fireOnce(
              `reminded:${userId}:${t.id}:${t.dueDate}:${t.dueTime}`,
              "⏰ Task is due now!",
              `"${t.title}" — needs to be done now (${t.dueTime})`
            );
          }
        }

        // 2) Personal self-set reminder. One popup at the start time, one at
        //    the end time, then `afterEndCount` extra nags every
        //    AFTER_END_INTERVAL_MIN minutes after the end time. Each occurrence
        //    fires once and past days are never replayed. Done tasks are skipped
        //    above, so completing a task stops all further reminders.
        const cfg = getPersonalReminderConfig(userId, t.id);
        if (cfg) {
          const occurrences: { at: Date; label: string }[] = [];
          const start = new Date(cfg.start);
          if (!isNaN(start.getTime())) {
            occurrences.push({ at: start, label: "starting now" });
          }
          const end = cfg.end ? new Date(cfg.end) : null;
          if (end && !isNaN(end.getTime())) {
            occurrences.push({ at: end, label: "due now (end time)" });
            const gapMin = Math.max(1, Math.floor(cfg.afterEndInterval || AFTER_END_INTERVAL_MIN));
            for (let i = 1; i <= cfg.afterEndCount; i++) {
              const occ = new Date(end.getTime() + i * gapMin * 60000);
              occurrences.push({
                at: occ,
                label: `still pending (${i}/${cfg.afterEndCount} after end time)`,
              });
            }
          }
          for (const o of occurrences) {
            const occDate = `${o.at.getFullYear()}-${pad2(o.at.getMonth() + 1)}-${pad2(o.at.getDate())}`;
            if (occDate < today) continue; // don't replay past days
            if (now < o.at) continue; // not due yet
            // Dedup by the occurrence's absolute time, so editing the reminder
            // later never re-fires an occurrence that already happened.
            fireOnce(
              `remindedPersonal:${userId}:${t.id}:${o.at.getTime()}`,
              "🔔 Your reminder!",
              `"${t.title}" — ${o.label}`
            );
          }
        }
      }
    };

    check();
    const iv = setInterval(check, 30000);
    return () => clearInterval(iv);
  }, [userId]);
}
