import { useState, useMemo, useEffect } from "react";
import type { DateRange } from "react-day-picker";
import { useQueryClient } from "@tanstack/react-query";
import { useListTasks, useListUsers, useListAttendance, useGenerateMyDailyTasks, getListTasksQueryKey, getGetTaskSummaryQueryKey } from "@workspace/api-client-react";
import { buildHierarchySet, buildAbsenceSet, isTaskHiddenByAbsence, cn, isAllCentersViewer, resolveAllowedCenters, isNonWorkingDayFor, nonWorkingDayLabel } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateRangePicker } from "@/components/DateRangePicker";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

// Local-date "YYYY-MM-DD" (avoids UTC/locale quirks of toISOString/toLocaleDateString)
const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseISO = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const DEPTS = ["All", "Management", "Accounts", "MIS", "HR", "IT"];
const DEPT_COLORS: Record<string, string> = {
  Management: "#8b5cf6", Accounts: "#3b82f6", MIS: "#14b8a6", HR: "#ec4899", IT: "#f97316",
};

const TYPE_META = [
  { ty: "daily", label: "Daily", icon: "📅" },
  { ty: "weekly", label: "Weekly", icon: "📆" },
  { ty: "monthly", label: "Monthly", icon: "🗓" },
] as const;

type DateMode = "all" | "range" | "month";

function Avatar({ name, dept }: { name: string; dept: string }) {
  const c = DEPT_COLORS[dept] ?? "#6366f1";
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ background: c }}>
      {name[0]}
    </div>
  );
}

interface DashboardProps {
  currentUser?: { id: number; name: string; role: string; department: string } | null;
}

export default function Dashboard({ currentUser }: DashboardProps) {
  const [centerFilter, setCenterFilter] = useState("All");
  const [deptFilter, setDeptFilter] = useState("All");
  const [memberFilter, setMemberFilter] = useState<number | "all">("all");
  const [dateMode, setDateMode] = useState<DateMode>("all");
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [month, setMonth] = useState(""); // YYYY-MM
  const fromDate = range?.from ? toISO(range.from) : "";
  const toDate = range?.to ? toISO(range.to) : "";
  const [typeFilter, setTypeFilter] = useState<"all" | "daily" | "weekly" | "monthly">("all");
  const [detailStatus, setDetailStatus] = useState<"pending" | "inProgress" | "done" | "all" | null>(null);
  const [detailPerson, setDetailPerson] = useState<number | "none" | "all">("all");
  // Sort direction for the Assigned To (name) column (A→Z / Z→A), matching the Team page.
  const [nameSort, setNameSort] = useState<"az" | "za">("az");

  const openDetail = (s: "pending" | "inProgress" | "done" | "all") => {
    setDetailPerson("all");
    setDetailStatus(s);
  };
  const closeDetail = () => {
    setDetailStatus(null);
    setDetailPerson("all");
  };

  const { data: allTasks = [] } = useListTasks({});
  const { data: users = [] } = useListUsers();
  const { data: attendance = [] } = useListAttendance({});

  // Live clock for the header
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  const clock = now
    .toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })
    .toLowerCase();
  // Lunch banner is only shown around lunch time (11:30 AM – 2:00 PM IST),
  // regardless of the viewer's own timezone. `now` re-renders every 30s so it
  // appears/disappears on its own. IST time is read via Asia/Kolkata.
  const istParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const istHour = Number(istParts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const istMin = Number(istParts.find((p) => p.type === "minute")?.value ?? "0");
  const istMinutes = istHour * 60 + istMin;
  const showLunchBanner = istMinutes >= 11 * 60 + 30 && istMinutes < 14 * 60;
  // Today's date in IST ("YYYY-MM-DD") — day boundaries follow the office day.
  const istDate = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  // ── Hierarchy gate: boss sees everyone; MIS sees EVERY center (including
  // Head Office); everyone else sees self + their reports ──
  const isMis = isAllCentersViewer(currentUser);
  // Per-user center restriction (Boss/MIS only). Resolved from the logged-in
  // user's own record (centerPermissions lives on the full user row, not the
  // slim currentUser prop). null = no restriction → existing behavior.
  const me = useMemo(() => users.find((u) => u.id === currentUser?.id) ?? null, [users, currentUser]);

  // ── Off-day banner + self-serve "Generate Today's Tasks" ──────
  // Daily tasks are NOT auto-generated on non-working days (Sunday / 1st
  // Saturday / Head Office Saturdays). Someone who IS working today can
  // generate their own daily tasks on demand — idempotent, own tasks only.
  const isOffDayToday = !!me && isNonWorkingDayFor(me, istDate);
  const qc = useQueryClient();
  const { toast } = useToast();
  const generateMyDaily = useGenerateMyDailyTasks({
    mutation: {
      onSuccess: (data) => {
        qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
        qc.invalidateQueries({ queryKey: getGetTaskSummaryQueryKey() });
        toast({
          title: data.created > 0 ? "Daily tasks generated" : "Already up to date",
          description:
            data.created > 0
              ? `${data.created} daily task${data.created === 1 ? "" : "s"} created for today.`
              : "Your daily tasks for today are already generated.",
        });
      },
      onError: () => {
        toast({ title: "Generation failed", description: "Could not generate today's tasks. Please try again.", variant: "destructive" });
      },
    },
  });
  const allowedCenters = useMemo(() => resolveAllowedCenters(me, users), [me, users]);
  const allowedIds = useMemo(() => {
    if (!currentUser) return null;
    let ids = isMis
      ? new Set(users.map((u) => u.id))
      : buildHierarchySet(currentUser.id, users);
    if (allowedCenters) {
      const centerOf = new Map(users.map((u) => [u.id, u.center]));
      ids = new Set([...ids].filter((id) => { const c = centerOf.get(id); return !!c && allowedCenters.has(c); }));
    }
    return ids;
  }, [currentUser, users, isMis, allowedCenters]);
  const seesAll = !allowedIds || allowedIds.size >= users.length;

  // Hide tasks whose assignee was marked absent/leave on the task's due date.
  const absenceSet = useMemo(() => buildAbsenceSet(attendance), [attendance]);

  // Tasks this user is allowed to see (hierarchy subtree + tasks they delegated)
  const hierarchyTasks = useMemo(() => {
    const visible = allTasks.filter((t) => !isTaskHiddenByAbsence(t, absenceSet));
    if (seesAll || !allowedIds || !currentUser) return visible;
    return visible.filter((t) =>
      (t.assignedTo != null && allowedIds.has(t.assignedTo)) ||
      // MIS is itself in Head Office, so its own delegated tasks must NOT pull
      // Head Office work into scope — strictly limit MIS to the allowed centers.
      (!isMis && t.assignedBy === currentUser.id)
    );
  }, [allTasks, allowedIds, currentUser, seesAll, isMis, absenceSet]);

  // Members allowed for the member filter (hierarchy subtree only)
  const hierarchyMembersAll = useMemo(
    () => (allowedIds ? users.filter((u) => allowedIds.has(u.id)) : users),
    [users, allowedIds]
  );

  // Map of userId → center, used to scope tasks/members by center
  const userCenter = useMemo(
    () => new Map(users.map((u) => [u.id, u.center])),
    [users]
  );

  // Centers available across this user's hierarchy (for the center filter pills)
  const centers = useMemo(() => {
    const set = new Set(hierarchyMembersAll.map((u) => u.center).filter((c): c is string => Boolean(c)));
    // Preferred display order for known centers; anything else follows alphabetically.
    const order = ["Head Office", "Thane Center", "Malad Center", "Pune Center", "Navi Mumbai Center"];
    const rank = (c: string) => {
      const i = order.indexOf(c);
      return i === -1 ? order.length : i;
    };
    const sorted = Array.from(set).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    return ["All", ...sorted];
  }, [hierarchyMembersAll]);

  // Once a center is chosen, members/depts/tasks are scoped to that center
  const hierarchyMembers = useMemo(
    () => (centerFilter === "All" ? hierarchyMembersAll : hierarchyMembersAll.filter((u) => u.center === centerFilter)),
    [hierarchyMembersAll, centerFilter]
  );

  // Filtered tasks
  const baseTasks = useMemo(() => {
    let t = hierarchyTasks;
    if (centerFilter !== "All") t = t.filter((x) => x.assignedTo != null && userCenter.get(x.assignedTo) === centerFilter);
    if (deptFilter !== "All") t = t.filter((x) => x.department === deptFilter);
    if (memberFilter !== "all") t = t.filter((x) => x.assignedTo === memberFilter);
    if (dateMode !== "all") {
      t = t.filter((x) => {
        const d = x.dueDate || x.createdAt?.split("T")[0] || "";
        if (!d) return false;
        if (dateMode === "range") {
          if (fromDate && d < fromDate) return false;
          if (toDate && d > toDate) return false;
          return true;
        }
        // month mode
        if (!month) return true;
        return d.startsWith(month);
      });
    }
    return t;
  }, [hierarchyTasks, centerFilter, userCenter, deptFilter, memberFilter, dateMode, fromDate, toDate, month]);

  // Active type tab (daily/weekly/monthly) filters all charts & KPIs below
  const tasks = useMemo(
    () => (typeFilter === "all" ? baseTasks : baseTasks.filter((x) => x.type === typeFilter)),
    [baseTasks, typeFilter]
  );

  // Daily / Weekly / Monthly task analytics (by task type)
  const typeStats = useMemo(
    () =>
      TYPE_META.map((m) => {
        const list = baseTasks.filter((x) => x.type === m.ty);
        const d = list.filter((x) => x.status === "done").length;
        const total = list.length;
        return { ...m, total, done: d, pending: total - d, rate: total ? Math.round((d / total) * 100) : 0 };
      }),
    [baseTasks]
  );

  // Members shown for member filter
  // Member pills show only people with a login (Sales Agents have no username and are
  // tracked in the Team page, so they are excluded from this analytics member filter).
  const visibleMembers = useMemo(() => {
    const withLogin = hierarchyMembers.filter((u) => !!u.username);
    return deptFilter === "All" ? withLogin : withLogin.filter((u) => u.department === deptFilter);
  }, [hierarchyMembers, deptFilter]);

  // Department pills: only departments within this user's hierarchy subtree
  const visibleDepts = useMemo(() => {
    const set = new Set(hierarchyMembers.map((u) => u.department).filter(Boolean));
    return ["All", ...DEPTS.filter((d) => d !== "All" && set.has(d))];
  }, [hierarchyMembers]);

  // KPIs
  const pending = tasks.filter((t) => t.status === "pending").length;
  const inProgress = tasks.filter((t) => t.status === "inProgress").length;
  const done = tasks.filter((t) => t.status === "done").length;
  const total = tasks.length;
  const doneRate = total > 0 ? Math.round((done / total) * 100) : 0;

  // Date used to place a task on the timeline (same basis as the date filter)
  const taskDateOf = (t: { dueDate?: string | null; createdAt?: string | null }) =>
    t.dueDate || t.createdAt?.split("T")[0] || "";

  // The set of days the timeline charts span — follows the selected filter:
  // month -> all days of that month, range -> from..to, otherwise -> last 7 days.
  const periodDays = useMemo(() => {
    const fmt = (d: Date) => ({
      iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      label: `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, "0")}`,
    });
    const out: { iso: string; label: string }[] = [];
    if (dateMode === "month" && month) {
      const [y, m] = month.split("-").map(Number);
      const days = new Date(y, m, 0).getDate();
      for (let i = 1; i <= days; i++) out.push(fmt(new Date(y, m - 1, i)));
    } else if (dateMode === "range" && fromDate && toDate) {
      const end = new Date(`${toDate}T00:00:00`);
      for (let d = new Date(`${fromDate}T00:00:00`); d <= end; d.setDate(d.getDate() + 1)) {
        out.push(fmt(new Date(d)));
        if (out.length >= 92) break; // cap ~3 months of bars
      }
    } else {
      const today = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        out.push(fmt(d));
      }
    }
    return out;
  }, [dateMode, month, fromDate, toDate]);

  const periodLabel =
    dateMode === "month" && month ? month
    : dateMode === "range" && fromDate && toDate ? `${fromDate} → ${toDate}`
    : dateMode === "range" && fromDate ? `${fromDate} → …`
    : "7 Days";

  // Daily completion trend across the selected period
  const dailyTrend = useMemo(
    () =>
      periodDays.map(({ iso, label }) => {
        const dayTasks = tasks.filter((t) => taskDateOf(t) === iso);
        return { date: iso, label, Completed: dayTasks.filter((t) => t.status === "done").length, "Total Due": dayTasks.length };
      }),
    [tasks, periodDays]
  );

  // Day-wise status tracker (Completed / Ongoing / Pending per day) across the
  // selected period. Follows every active filter (dept, member, type, date).
  const dailyStatusTrend = useMemo(
    () =>
      periodDays.map(({ iso, label }) => {
        const dayTasks = tasks.filter((t) => taskDateOf(t) === iso);
        return {
          date: iso,
          label,
          Completed: dayTasks.filter((t) => t.status === "done").length,
          Ongoing: dayTasks.filter((t) => t.status === "inProgress").length,
          Pending: dayTasks.filter((t) => t.status === "pending").length,
        };
      }),
    [tasks, periodDays]
  );

  // Status distribution
  const statusDist = [
    { name: "Pending", value: pending, fill: "#ef4444" },
    { name: "In Progress", value: inProgress, fill: "#f59e0b" },
    { name: "Done", value: done, fill: "#10b981" },
  ].filter((s) => s.value > 0);

  // Priority breakdown
  const priorityBreakdown = useMemo(() => {
    const map: Record<string, number> = { high: 0, medium: 0, low: 0, urgent: 0 };
    tasks.forEach((t) => { map[t.priority] = (map[t.priority] ?? 0) + 1; });
    return Object.entries(map).filter(([, v]) => v > 0).map(([name, count]) => ({ name: name[0].toUpperCase() + name.slice(1), count }));
  }, [tasks]);

  // Done vs pending per day across the selected period
  const weeklyDvP = useMemo(
    () =>
      periodDays.map(({ iso, label }) => ({
        label,
        Done: tasks.filter((t) => taskDateOf(t) === iso && t.status === "done").length,
        Pending: tasks.filter((t) => taskDateOf(t) === iso && t.status === "pending").length,
      })),
    [tasks, periodDays]
  );

  // Goal progress: cumulative completed vs an even target line across the period
  const monthlyGoal = useMemo(() => {
    const data: { day: string; Completed: number; Target: number }[] = [];
    let cumDone = 0;
    const n = periodDays.length || 1;
    periodDays.forEach(({ iso, label }, idx) => {
      cumDone += tasks.filter((t) => taskDateOf(t) === iso && t.status === "done").length;
      data.push({ day: label, Completed: cumDone, Target: Math.round((total / n) * (idx + 1)) });
    });
    return data;
  }, [tasks, periodDays, total]);

  // By category
  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    tasks.forEach((t) => { const c = t.category ?? "Other"; map.set(c, (map.get(c) ?? 0) + 1); });
    return Array.from(map.entries()).map(([cat, count]) => ({ cat, count }));
  }, [tasks]);

  const deptLabel = deptFilter === "All" ? "" : deptFilter;
  const selectedMember = users.find((u) => u.id === memberFilter);

  return (
    <div className="p-4 space-y-4">
      {/* Off-day banner — daily tasks are not auto-generated today; someone
          who IS working can generate their own with one click. */}
      {isOffDayToday && (
        <div className="rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap text-sm font-medium border border-sky-300/60 bg-gradient-to-r from-sky-50 to-indigo-50 text-sky-900 dark:border-sky-500/30 dark:from-sky-500/10 dark:to-indigo-500/10 dark:text-sky-200">
          <span className="flex items-center gap-2.5 min-w-0">
            <span className="text-lg shrink-0" aria-hidden>🌤️</span>
            <span>
              Today is a non-working day — <span className="font-bold">{nonWorkingDayLabel(istDate)}</span>. Daily tasks are not auto-generated. Working today? Generate yours below.
            </span>
          </span>
          <button
            onClick={() => generateMyDaily.mutate()}
            disabled={generateMyDaily.isPending}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {generateMyDaily.isPending ? "Generating…" : "Generate Today's Tasks"}
          </button>
        </div>
      )}
      {/* Fun lunch reminder banner — shown to everyone (not a task), but only
          around lunch time (11:30 AM – 2:00 PM IST). */}
      {showLunchBanner && (
        <div className="rounded-xl px-4 py-2.5 flex items-center gap-3 text-sm font-medium border border-amber-300/60 bg-gradient-to-r from-amber-50 to-orange-50 text-amber-900 dark:border-amber-500/30 dark:from-amber-500/10 dark:to-orange-500/10 dark:text-amber-200">
          <span className="text-lg shrink-0" aria-hidden>🍱</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span><span className="font-bold">12:00 PM</span> — Order your lunch</span>
            <span className="text-amber-400 dark:text-amber-500/60">•</span>
            <span><span className="font-bold">1:00 PM</span> — Lunch break, enjoy your meal!</span>
          </span>
        </div>
      )}
      {/* Hero header — brand + live clock on the left, dept & member filters on the right */}
      <div
        className="rounded-2xl px-5 py-4 text-white relative overflow-hidden"
        style={{ background: "linear-gradient(120deg, hsl(222 47% 10%) 0%, hsl(215 42% 15%) 60%, hsl(199 60% 18%) 100%)" }}
      >
        <div className="flex items-start justify-between gap-5 flex-wrap">
          {/* Left: brand, title, meta */}
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-cyan-300/90 mb-1.5">
              <span className="flex items-end gap-[2px] h-4" aria-hidden>
                <span className="w-1 h-2.5 bg-cyan-400 rounded-sm" />
                <span className="w-1 h-4 bg-teal-300 rounded-sm" />
                <span className="w-1 h-3 bg-emerald-400 rounded-sm" />
              </span>
              Management Task Pro
            </div>
            <h1 className="text-3xl font-extrabold leading-tight">Task Analytics Dashboard</h1>
            {currentUser && (
              <div className="text-sm text-slate-300 mt-2 flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-100">{currentUser.name}</span>
                <span className="text-slate-500">·</span>
                <span>{currentUser.role}</span>
                <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
                </span>
                <span className="text-slate-500">·</span>
                <span className="tabular-nums">{clock}</span>
                {!seesAll && !isMis && (
                  <span className="ml-1 px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 text-xs font-semibold">
                    Only your team's data
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Right: filters */}
          <div className="flex flex-col items-end gap-2 ml-auto">
            {/* Center pills — pick a center to scope everything below */}
            {(seesAll || isMis) && centers.length > 1 && (
              <div className="flex gap-1.5 flex-wrap justify-end items-center">
                <span className="text-xs font-semibold text-cyan-300/90 mr-1">🏢 Center</span>
                {centers.map((c) => {
                  const active = centerFilter === c;
                  return (
                    <button
                      key={c}
                      onClick={() => { setCenterFilter(c); setDeptFilter("All"); setMemberFilter("all"); }}
                      aria-pressed={active}
                      className={cn(
                        "px-3.5 py-1.5 rounded-full text-sm font-semibold transition border",
                        active
                          ? "bg-cyan-400 text-slate-900 border-cyan-300 shadow"
                          : "bg-white/10 text-slate-200 border-white/10 hover:bg-white/20"
                      )}
                    >
                      {c === "All" ? "All Centers" : c}
                    </button>
                  );
                })}
              </div>
            )}
            {/* Department pills */}
            <div className="flex gap-1.5 flex-wrap justify-end">
              {visibleDepts.map((d) => {
                const active = deptFilter === d;
                const dot = DEPT_COLORS[d];
                return (
                  <button
                    key={d}
                    onClick={() => { setDeptFilter(d); setMemberFilter("all"); }}
                    aria-pressed={active}
                    className={cn(
                      "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold transition border",
                      active
                        ? "bg-white text-slate-900 border-white shadow"
                        : "bg-white/10 text-slate-200 border-white/10 hover:bg-white/20"
                    )}
                  >
                    {dot && <span className="w-2 h-2 rounded-full" style={{ background: dot }} />}
                    {d}
                  </button>
                );
              })}
            </div>

            {/* Member pills */}
            <div className="flex gap-1.5 flex-wrap justify-end max-w-2xl">
              <button
                onClick={() => setMemberFilter("all")}
                aria-pressed={memberFilter === "all"}
                className={cn(
                  "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-bold transition",
                  memberFilter === "all"
                    ? "text-slate-900 shadow-lg"
                    : "bg-white/10 text-slate-200 border border-white/10 hover:bg-white/20"
                )}
                style={memberFilter === "all" ? { background: "linear-gradient(90deg,#22d3ee,#2dd4bf)" } : undefined}
              >
                All Members
              </button>
              {visibleMembers.map((u) => {
                const active = memberFilter === u.id;
                const c = DEPT_COLORS[u.department] ?? "#6366f1";
                return (
                  <button
                    key={u.id}
                    onClick={() => setMemberFilter(u.id)}
                    title={`${u.name} · ${u.department}`}
                    aria-pressed={active}
                    className={cn(
                      "flex items-center gap-1.5 pl-1 pr-3.5 py-1 rounded-full text-sm font-semibold transition border",
                      active
                        ? "bg-white text-slate-900 border-white shadow"
                        : "bg-white/10 text-slate-200 border-white/10 hover:bg-white/20"
                    )}
                  >
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ background: c }}
                    >
                      {u.name[0]}
                    </span>
                    {u.name.split(" ")[0]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Date filter bar */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-3 flex items-center gap-3 flex-wrap">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">📅 Filter by Date</span>
        <DateRangePicker
          from={fromDate}
          to={toDate}
          onApply={({ from, to }) => {
            if (!from) {
              setRange(undefined);
              setDateMode("all");
            } else {
              setRange({ from: parseISO(from), to: parseISO(to || from) });
              setDateMode("range");
            }
          }}
        />
        <span className="ml-auto text-xs text-muted-foreground">Showing: <span className="font-semibold text-foreground">{periodLabel}</span></span>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-5 gap-3">
        <button type="button" onClick={() => openDetail("pending")} className="text-left rounded-xl p-4 text-white bg-red-500 hover:brightness-110 hover:-translate-y-0.5 transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/60">
          <div className="text-3xl font-black">{pending}</div>
          <div className="text-xs font-semibold mt-1 flex items-center gap-1">⚠ Pending</div>
          <div className="text-xs opacity-75 mt-0.5">Click to view ›</div>
        </button>
        <button type="button" onClick={() => openDetail("inProgress")} className="text-left rounded-xl p-4 text-white bg-amber-500 hover:brightness-110 hover:-translate-y-0.5 transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/60">
          <div className="text-3xl font-black">{inProgress}</div>
          <div className="text-xs font-semibold mt-1 flex items-center gap-1">⏱ In Progress</div>
          <div className="text-xs opacity-75 mt-0.5">Click to view ›</div>
        </button>
        <button type="button" onClick={() => openDetail("done")} className="text-left rounded-xl p-4 text-white bg-green-500 hover:brightness-110 hover:-translate-y-0.5 transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/60">
          <div className="text-3xl font-black">{done}</div>
          <div className="text-xs font-semibold mt-1 flex items-center gap-1">✓ Completed</div>
          <div className="text-xs opacity-75 mt-0.5">{total > 0 ? Math.round((done / total) * 100) : 0}% · Click to view ›</div>
        </button>
        <button type="button" onClick={() => openDetail("all")} className="text-left rounded-xl p-4 text-white bg-blue-600 hover:brightness-110 hover:-translate-y-0.5 transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/60">
          <div className="text-3xl font-black">{total}</div>
          <div className="text-xs font-semibold mt-1 flex items-center gap-1">📋 Total Tasks</div>
          <div className="text-xs opacity-75 mt-0.5">{deptLabel || "All Depts"} · Click to view ›</div>
        </button>
        <div className="rounded-xl p-4 text-white" style={{ background: "#1e293b" }}>
          <div className="text-3xl font-black text-red-400">{doneRate}%</div>
          <div className="text-xs font-semibold mt-1 flex items-center gap-1">📊 Done Rate</div>
          <div className="text-xs opacity-75 mt-0.5">Completion rate</div>
        </div>
      </div>

      {/* Daily / Weekly / Monthly task analytics */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">📊 Quick Analytics — Daily / Weekly / Monthly</span>
        {typeFilter !== "all" && (
          <button
            type="button"
            onClick={() => setTypeFilter("all")}
            className="text-xs font-semibold text-primary hover:underline"
          >
            Showing {typeFilter} only · Clear ✕
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {typeStats.map((s) => (
          <button
            key={s.ty}
            type="button"
            onClick={() => setTypeFilter((prev) => (prev === s.ty ? "all" : (s.ty as typeof typeFilter)))}
            className={`text-left bg-card rounded-xl border shadow-sm p-4 transition cursor-pointer hover:shadow-md ${typeFilter === s.ty ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
          >
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                {s.icon} {s.label} Tasks
              </div>
              <span className="text-xs font-bold text-primary">{s.rate}%</span>
            </div>
            <div className="text-3xl font-black text-foreground mt-1">{s.total}</div>
            <div className="flex gap-3 mt-1 text-xs">
              <span className="text-green-600 dark:text-green-300 font-semibold">✓ {s.done} done</span>
              <span className="text-red-500 dark:text-red-400 font-semibold">⚠ {s.pending} pending</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${s.rate}%` }} />
            </div>
          </button>
        ))}
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">📅 Daily Completion Trend ({periodLabel})</div>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={dailyTrend}>
              <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} />
              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Line type="monotone" dataKey="Completed" stroke="#6366f1" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="Total Due" stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 2" dot={false} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 9 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">🔴 Status Distribution</div>
          {statusDist.length > 0 ? (
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={statusDist} dataKey="value" cx="50%" cy="50%" innerRadius={35} outerRadius={55}>
                  {statusDist.map((s, i) => <Cell key={i} fill={s.fill} />)}
                </Pie>
                <Tooltip />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 9 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-36 flex items-center justify-center text-muted-foreground text-xs">No data</div>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">📊 Priority Breakdown</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={priorityBreakdown} barSize={20}>
              <XAxis dataKey="name" tick={{ fontSize: 9 }} tickLine={false} />
              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#ef4444" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">📆 Weekly Done vs Pending</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={weeklyDvP} barSize={8}>
              <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} />
              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar dataKey="Done" fill="#10b981" radius={[2, 2, 0, 0]} />
              <Bar dataKey="Pending" fill="#ef4444" radius={[2, 2, 0, 0]} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 9 }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">🎯 Monthly Goal Progress</div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={monthlyGoal.filter((_, i) => monthlyGoal.length <= 14 || i % 3 === 0)}>
              <XAxis dataKey="day" tick={{ fontSize: 9 }} tickLine={false} />
              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Line type="monotone" dataKey="Completed" stroke="#10b981" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Target" stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 2" dot={false} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 9 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">🗂 Tasks by Category</div>
          {byCategory.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={byCategory} barSize={28}>
                <XAxis dataKey="cat" tick={{ fontSize: 9 }} tickLine={false} />
                <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-40 flex items-center justify-center text-muted-foreground text-xs">No data</div>
          )}
        </div>
      </div>

      {/* Day-wise status tracker — clustered column chart, full width, follows all filters */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">📊 Daily Status Tracker — Completed / Ongoing / Pending ({periodLabel})</div>
          <div className="text-xs text-muted-foreground">Per day · follows filters above</div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={dailyStatusTrend} barGap={2} barCategoryGap="20%" margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Completed" fill="#10b981" radius={[2, 2, 0, 0]} />
            <Bar dataKey="Ongoing" fill="#f59e0b" radius={[2, 2, 0, 0]} />
            <Bar dataKey="Pending" fill="#ef4444" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Task detail modal — opens when a KPI card is clicked */}
      {detailStatus && (() => {
        const meta: Record<string, { title: string; icon: string }> = {
          pending: { title: "Pending Tasks", icon: "⚠" },
          inProgress: { title: "In Progress Tasks", icon: "⏱" },
          done: { title: "Completed Tasks", icon: "✓" },
          all: { title: "All Tasks", icon: "📋" },
        };
        const baseList = detailStatus === "all" ? tasks : tasks.filter((t) => t.status === detailStatus);
        // Build per-person chips (name + count) from the current status list
        const peopleMap = new Map<number | "none", { id: number | "none"; name: string; count: number }>();
        for (const t of baseList) {
          const id = t.assignedTo ?? "none";
          const name = t.assignedToName ?? "Unassigned";
          const cur = peopleMap.get(id);
          if (cur) cur.count++;
          else peopleMap.set(id, { id, name, count: 1 });
        }
        const people = [...peopleMap.values()].sort((a, b) => b.count - a.count);
        const list =
          detailPerson === "all" ? baseList : baseList.filter((t) => (t.assignedTo ?? "none") === detailPerson);
        const displayList = [...list].sort((a, b) => {
          const an = a.assignedToName ?? "Unassigned";
          const bn = b.assignedToName ?? "Unassigned";
          return nameSort === "za" ? bn.localeCompare(an) : an.localeCompare(bn);
        });
        const statusBadge = (s: string) =>
          s === "done"
            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
            : s === "inProgress"
            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
        const statusLabel = (s: string) =>
          s === "done" ? "Completed" : s === "inProgress" ? "In Progress" : "Pending";
        return (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.45)" }}
            onClick={closeDetail}
          >
            <div
              className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-base font-extrabold text-foreground flex items-center gap-2">
                  <span>{meta[detailStatus].icon}</span> {meta[detailStatus].title}
                  <span className="text-xs font-semibold text-muted-foreground">({list.length})</span>
                </h2>
                <button
                  onClick={closeDetail}
                  className="text-muted-foreground hover:text-foreground text-lg px-1"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              {people.length > 0 && (
                <div className="px-5 py-3 border-b border-border flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setDetailPerson("all")}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                      detailPerson === "all"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/70"
                    }`}
                  >
                    All <span className="opacity-80">({baseList.length})</span>
                  </button>
                  {people.map((p) => (
                    <button
                      key={String(p.id)}
                      type="button"
                      onClick={() => setDetailPerson(p.id)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                        detailPerson === p.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/70"
                      }`}
                    >
                      {p.name} <span className="opacity-80">({p.count})</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="overflow-y-auto">
                {list.length === 0 ? (
                  <div className="px-5 py-10 text-center text-muted-foreground text-sm">No tasks</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted">
                      <tr className="text-xs text-muted-foreground">
                        <th className="text-left px-4 py-2 font-semibold">Task</th>
                        <th className="text-left px-4 py-2 font-semibold">
                          <div className="flex items-center gap-2">
                            <span>Assigned To</span>
                            <select
                              value={nameSort}
                              onChange={(e) => setNameSort(e.target.value as "az" | "za")}
                              className="px-1.5 py-0.5 border border-border rounded-md text-xs font-normal normal-case bg-card focus:outline-none focus:ring-2 focus:ring-ring"
                              title="Sort by name"
                            >
                              <option value="az">A → Z</option>
                              <option value="za">Z → A</option>
                            </select>
                          </div>
                        </th>
                        <th className="text-left px-4 py-2 font-semibold">Status</th>
                        <th className="text-left px-4 py-2 font-semibold">Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayList.map((t) => (
                        <tr key={t.id} className="border-b border-border last:border-0">
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-foreground">{t.title}</div>
                            {t.category && <div className="text-xs text-muted-foreground">{t.category}</div>}
                          </td>
                          <td className="px-4 py-2.5 text-foreground">
                            {t.assignedToName ?? <span className="text-muted-foreground italic text-xs">Unassigned</span>}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusBadge(t.status)}`}>
                              {statusLabel(t.status)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{t.dueDate || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
