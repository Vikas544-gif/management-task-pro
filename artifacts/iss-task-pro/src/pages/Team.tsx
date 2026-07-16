import { useState, useMemo, useEffect } from "react";
import {
  useListUsers, useListTasks, useCreateUser, useDeleteUser, useUpdateUser,
  useUpdateTaskStatus, useListAgentMetrics, useUpsertAgentMetric,
  useListAttendance, useUpsertAttendance, useListTaskTransfers,
  getListUsersQueryKey, getListTasksQueryKey, getGetTaskSummaryQueryKey,
  getListAgentMetricsQueryKey, getListAttendanceQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { buildHierarchySet, isAllCentersViewer, resolveAllowedCenters } from "@/lib/utils";
import { DateRangePicker } from "@/components/DateRangePicker";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell,
} from "recharts";

interface CurrentUser { id: number; name: string; role: string; department: string; }
interface TeamProps { currentUser: CurrentUser; }

const DEPT_COLORS: Record<string, string> = {
  Management: "#8b5cf6", Accounts: "#3b82f6", MIS: "#14b8a6", HR: "#ec4899", IT: "#f97316", "Quality & Training": "#10b981", Quality: "#06b6d4", Training: "#f59e0b",
};
const DEPT_BG: Record<string, string> = {
  Management: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300", Accounts: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  MIS: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300", HR: "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300", IT: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  "Quality & Training": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  Quality: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  Training: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

// The four outer centers MIS is allowed to manage (never Head Office).
const OUTER_CENTERS = ["Thane Center", "Malad Center", "Pune Center", "Navi Mumbai Center"];

// Local "YYYY-MM-DD" for today (avoids UTC quirks).
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Parse a DOJ string into a LOCAL date (avoids UTC-shift bugs for "YYYY-MM-DD").
function parseDojLocal(doj: string | null | undefined): Date | null {
  if (!doj) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(doj.trim());
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(doj);
  return isNaN(d.getTime()) ? null : d;
}

// Breakdown of tenure into years / months / days from DOJ to today.
function tenureBreakdown(doj: string | null | undefined): { years: number; months: number; days: number } | null {
  const start = parseDojLocal(doj);
  if (start == null) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (start.getTime() > today.getTime()) return { years: 0, months: 0, days: 0 };

  let years = today.getFullYear() - start.getFullYear();
  let months = today.getMonth() - start.getMonth();
  let days = today.getDate() - start.getDate();

  if (days < 0) {
    months -= 1;
    // days in the calendar month immediately before "today"
    const prevMonthDays = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
    days += prevMonthDays;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years: Math.max(0, years), months: Math.max(0, months), days: Math.max(0, days) };
}

// Total whole months of tenure from DOJ to today (used for bucketing).
function tenureMonths(doj: string | null | undefined): number | null {
  const b = tenureBreakdown(doj);
  if (b == null) return null;
  return b.years * 12 + b.months;
}

// Human-readable tenure like "1 Year 4 Months 15 Days".
function tenureLabel(doj: string | null | undefined): string {
  const b = tenureBreakdown(doj);
  if (b == null) return "—";
  const parts: string[] = [];
  parts.push(`${b.years} ${b.years === 1 ? "Year" : "Years"}`);
  parts.push(`${b.months} ${b.months === 1 ? "Month" : "Months"}`);
  parts.push(`${b.days} ${b.days === 1 ? "Day" : "Days"}`);
  return parts.join(" ");
}

// Tenure bucket derived from total months: only 3 buckets.
function tenureBucket(doj: string | null | undefined): string {
  const m = tenureMonths(doj);
  if (m == null) return "—";
  if (m < 3) return "0-3 Months";
  if (m < 6) return "3-6 Months";
  return "6+ Months";
}

const ATTENDANCE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "—" },
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "half_day", label: "HD" },
  { value: "leave", label: "Leave" },
];

const AGENT_CENTERS = ["Thane Center", "Malad Center", "Pune Center", "Navi Mumbai Center"] as const;
const TENURE_FILTERS = ["All", "0-3 Months", "3-6 Months", "6+ Months"] as const;

const METRIC_FIELDS = ["dc", "prospectCount", "salesFd", "salesMtd", "target", "last3mAvg", "last6mAvg"] as const;
type MetricField = typeof METRIC_FIELDS[number];
type MetricDraft = Record<MetricField, string>;
const emptyDraft = (): MetricDraft => ({ dc: "", prospectCount: "", salesFd: "", salesMtd: "", target: "", last3mAvg: "", last6mAvg: "" });

// Roll up metric rows per agent for the "All dates" view. DC / Prospect Count /
// Sales FD are daily activity counts, so they SUM across every date. Sales MTD,
// Target and the running averages are point-in-time figures, so we keep the most
// recent entry per agent (the API returns rows newest-first, so first wins).
function aggregateMetricsByAgent(rows: any[]) {
  const sums = new Map<number, { dc: number; prospectCount: number; salesFd: number }>();
  // Point-in-time fields keep the latest NON-NULL value each agent ever recorded, so a
  // blank newest day (e.g. only DC entered) doesn't wipe a target/MTD set earlier. Rows
  // arrive newest-first, so the first non-null we see per field is the most recent.
  const latestNonNull = new Map<number, Record<string, any>>();
  const POINT_FIELDS = ["salesMtd", "target", "last3mAvg", "last6mAvg", "remark"] as const;
  for (const m of rows) {
    const s = sums.get(m.agentId) ?? { dc: 0, prospectCount: 0, salesFd: 0 };
    s.dc += Number(m.dc) || 0;
    s.prospectCount += Number(m.prospectCount) || 0;
    s.salesFd += Number(m.salesFd) || 0;
    sums.set(m.agentId, s);
    const p = latestNonNull.get(m.agentId) ?? {};
    for (const f of POINT_FIELDS) {
      if (p[f] == null && m[f] != null) p[f] = m[f];
    }
    latestNonNull.set(m.agentId, p);
  }
  const out = new Map<number, any>();
  for (const [id, s] of sums) {
    const p = latestNonNull.get(id) ?? {};
    out.set(id, {
      agentId: id,
      dc: s.dc,
      prospectCount: s.prospectCount,
      salesFd: s.salesFd,
      salesMtd: p.salesMtd ?? null,
      target: p.target ?? null,
      last3mAvg: p.last3mAvg ?? null,
      last6mAvg: p.last6mAvg ?? null,
      remark: p.remark ?? null,
    });
  }
  return out;
}

type StatusKey = "done" | "inProgress" | "pending";
const STATUSES: StatusKey[] = ["done", "inProgress", "pending"];
const STATUS_LABELS: Record<StatusKey, string> = { done: "Done", inProgress: "In Progress", pending: "Pending" };
const STATUS_SELECT: Record<StatusKey, string> = { pending: "Pending", inProgress: "In Progress", done: "Done" };

// ── Member Detail View ───────────────────────────────────────────────────────
function MemberDetail({
  member, allTasks, onBack, isMis,
}: {
  member: any;
  allTasks: any[];
  onBack: () => void;
  isMis: boolean;
}) {
  const qc = useQueryClient();
  const updateStatus = useUpdateTaskStatus();
  const updateUser = useUpdateUser();
  const { data: transfers = [] } = useListTaskTransfers();
  const transferStats = useMemo(() => {
    const away = transfers.filter((t: any) => t.fromUserId === member.id).length;
    const incoming = transfers.filter((t: any) => t.toUserId === member.id).length;
    return { away, incoming };
  }, [transfers, member.id]);
  const memberTransfers = useMemo(
    () =>
      transfers.filter(
        (t: any) => t.fromUserId === member.id || t.toUserId === member.id
      ),
    [transfers, member.id]
  );
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [emailInput, setEmailInput] = useState<string>(member.email ?? "");
  const [savedEmail, setSavedEmail] = useState<string>(member.email ?? "");
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [centerInput, setCenterInput] = useState<string>(member.center ?? "Head Office");
  const [savedCenter, setSavedCenter] = useState<string>(member.center ?? "Head Office");
  const [centerSaved, setCenterSaved] = useState(false);
  const [centerError, setCenterError] = useState("");

  const handleSaveCenter = () => {
    setCenterSaved(false);
    setCenterError("");
    const value = centerInput.trim() || (isMis ? "Thane Center" : "Head Office");
    if (isMis && value === "Head Office") {
      setCenterError("MIS cannot assign anyone to Head Office");
      return;
    }
    updateUser.mutate(
      { id: member.id, data: { center: value } },
      {
        onSuccess: () => {
          setSavedCenter(value);
          setCenterInput(value);
          setCenterSaved(true);
          qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
        },
        onError: () => setCenterError("Center could not be saved — please try again"),
      }
    );
  };

  const handleSaveEmail = () => {
    setEmailSaved(false);
    setEmailError("");
    const value = emailInput.trim();
    updateUser.mutate(
      { id: member.id, data: { email: value || null } },
      {
        onSuccess: () => {
          setSavedEmail(value);
          setEmailSaved(true);
          qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
        },
        onError: () => setEmailError("Email could not be saved — please try again"),
      }
    );
  };

  const myTasks = useMemo(
    () => allTasks.filter((t) => t.assignedTo === member.id),
    [allTasks, member.id]
  );

  const stats = useMemo(() => {
    const done = myTasks.filter((t) => t.status === "done").length;
    const inProgress = myTasks.filter((t) => t.status === "inProgress").length;
    const pending = myTasks.filter((t) => t.status === "pending").length;
    const pct = myTasks.length > 0 ? Math.round((done / myTasks.length) * 100) : 0;
    return { done, inProgress, pending, total: myTasks.length, pct };
  }, [myTasks]);

  const visibleTasks = useMemo(() => {
    return myTasks.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (typeFilter !== "all" && t.type !== typeFilter) return false;
      return true;
    });
  }, [myTasks, statusFilter, typeFilter]);

  const handleStatusChange = (id: number, newStatus: string) => {
    updateStatus.mutate({ id, data: { status: newStatus } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
        qc.invalidateQueries({ queryKey: getGetTaskSummaryQueryKey() });
      },
    });
  };

  const avatarColor = DEPT_COLORS[member.department] ?? "#6366f1";
  const types = ["all", "daily", "weekly", "monthly", "one_time"];
  const statusTabData = [
    { key: "all", label: "All", count: stats.total },
    { key: "pending", label: "Pending", count: stats.pending },
    { key: "inProgress", label: "In Progress", count: stats.inProgress },
    { key: "done", label: "Done", count: stats.done },
  ];

  return (
    <div className="p-5">
      {/* Back button + header */}
      <div className="flex items-center gap-4 mb-5">
        <button onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-muted text-foreground text-sm font-semibold rounded-lg transition">
          ← Back
        </button>
        <h1 className="text-base font-bold text-muted-foreground">Team View</h1>
      </div>

      {/* Person card */}
      <div className="flex items-center gap-4 mb-5">
        <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-extrabold shadow-md shrink-0"
          style={{ background: avatarColor }}>
          {member.name[0]}
        </div>
        <div>
          <div className="text-xl font-extrabold text-foreground">{member.name}</div>
          <div className="text-sm text-muted-foreground mt-0.5">
            {member.role} ·{" "}
            <span className={`font-semibold ${DEPT_BG[member.department]?.split(" ")[1] ?? "text-muted-foreground"}`}>{member.department}</span>
          </div>
        </div>
      </div>

      {/* Email editor — set/update the address that task & reminder mails go to */}
      <div className="mb-5 bg-card rounded-xl border border-border shadow-sm p-4 max-w-md">
        <div className="text-xs font-bold text-muted-foreground mb-2">
          ✉ Email Address {savedEmail ? "" : <span className="text-amber-600 dark:text-amber-300">· No email set</span>}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="email"
            value={emailInput}
            onChange={(e) => { setEmailInput(e.target.value); setEmailSaved(false); setEmailError(""); }}
            placeholder="name@infinityservicesindia.com"
            className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={handleSaveEmail}
            disabled={updateUser.isPending || emailInput.trim() === savedEmail}
            className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 transition"
          >
            {updateUser.isPending ? "Saving..." : "Save"}
          </button>
        </div>
        {emailSaved && <div className="text-xs text-green-600 dark:text-green-300 font-medium mt-2">✅ Email saved — task & reminder mails will go here</div>}
        {emailError && <div className="text-xs text-red-600 dark:text-red-300 font-medium mt-2">{emailError}</div>}
        <p className="text-xs text-muted-foreground mt-2">Task assignment and reminder emails will be sent to this address.</p>
      </div>

      {/* Center editor — which office/center this member belongs to */}
      <div className="mb-5 bg-card rounded-xl border border-border shadow-sm p-4 max-w-md">
        <div className="text-xs font-bold text-muted-foreground mb-2">🏢 Center / Office</div>
        <div className="flex items-center gap-2">
          {isMis ? (
            <select
              value={centerInput}
              onChange={(e) => { setCenterInput(e.target.value); setCenterSaved(false); setCenterError(""); }}
              className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {OUTER_CENTERS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <input
              type="text"
              value={centerInput}
              onChange={(e) => { setCenterInput(e.target.value); setCenterSaved(false); setCenterError(""); }}
              placeholder="Head Office"
              className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}
          <button
            onClick={handleSaveCenter}
            disabled={updateUser.isPending || centerInput.trim() === savedCenter}
            className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 transition"
          >
            {updateUser.isPending ? "Saving..." : "Save"}
          </button>
        </div>
        {centerSaved && <div className="text-xs text-green-600 dark:text-green-300 font-medium mt-2">✅ Center saved</div>}
        {centerError && <div className="text-xs text-red-600 dark:text-red-300 font-medium mt-2">{centerError}</div>}
        <p className="text-xs text-muted-foreground mt-2">Use this to group members by office/center (e.g. Head Office, and your other centers).</p>
      </div>

      {/* 4 stat boxes — clicking filters tasks */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <button
          onClick={() => setStatusFilter("done")}
          className={`rounded-xl p-4 text-center border-2 transition hover:shadow ${statusFilter === "done" ? "border-green-500 bg-green-100 dark:border-green-600 dark:bg-green-900/40" : "border-green-200 bg-green-50 hover:border-green-400 hover:bg-green-100 dark:border-green-800 dark:bg-green-950/40 dark:hover:border-green-600 dark:hover:bg-green-900/40"}`}>
          <div className="text-3xl font-black text-green-600 dark:text-green-300">{stats.done}</div>
          <div className="text-xs font-bold text-green-600 dark:text-green-300 mt-1">✅ Done</div>
          <div className="text-xs text-green-500 dark:text-green-400 mt-0.5">Click to filter</div>
        </button>

        <button
          onClick={() => setStatusFilter("inProgress")}
          className={`rounded-xl p-4 text-center border-2 transition hover:shadow ${statusFilter === "inProgress" ? "border-amber-500 bg-amber-100 dark:border-amber-600 dark:bg-amber-900/40" : "border-amber-200 bg-amber-50 hover:border-amber-400 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:hover:border-amber-600 dark:hover:bg-amber-900/40"}`}>
          <div className="text-3xl font-black text-amber-600 dark:text-amber-300">{stats.inProgress}</div>
          <div className="text-xs font-bold text-amber-600 dark:text-amber-300 mt-1">⏳ In Progress</div>
          <div className="text-xs text-amber-500 dark:text-amber-400 mt-0.5">Click to filter</div>
        </button>

        <button
          onClick={() => setStatusFilter("pending")}
          className={`rounded-xl p-4 text-center border-2 transition hover:shadow ${statusFilter === "pending" ? "border-red-500 bg-red-100 dark:border-red-600 dark:bg-red-900/40" : "border-red-200 bg-red-50 hover:border-red-400 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:hover:border-red-600 dark:hover:bg-red-900/40"}`}>
          <div className="text-3xl font-black text-red-600 dark:text-red-300">{stats.pending}</div>
          <div className="text-xs font-bold text-red-600 dark:text-red-300 mt-1">🔔 Pending</div>
          <div className="text-xs text-red-500 dark:text-red-400 mt-0.5">Click to filter</div>
        </button>

        <button
          onClick={() => setStatusFilter("all")}
          className={`rounded-xl p-4 text-center border-2 transition hover:shadow ${statusFilter === "all" ? "border-blue-500 bg-blue-100 dark:border-blue-600 dark:bg-blue-900/40" : "border-blue-200 bg-blue-50 hover:border-blue-400 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:hover:border-blue-600 dark:hover:bg-blue-900/40"}`}>
          <div className="text-3xl font-black text-blue-600 dark:text-blue-300">{stats.pct}%</div>
          <div className="text-xs font-bold text-blue-600 dark:text-blue-300 mt-1">🎯 Done Rate</div>
          <div className="text-xs text-blue-500 dark:text-blue-400 mt-0.5">Show All</div>
        </button>
      </div>

      {/* Task transfer credit / debit — only shown when there is transfer activity */}
      {(transferStats.away > 0 || transferStats.incoming > 0) && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="rounded-xl p-4 text-center border-2 border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/40">
            <div className="text-3xl font-black text-red-600 dark:text-red-300">-{transferStats.away}</div>
            <div className="text-xs font-bold text-red-600 dark:text-red-300 mt-1">↗️ Transferred Away</div>
            <div className="text-xs text-red-500 dark:text-red-400 mt-0.5">Tasks reassigned from this person</div>
          </div>
          <div className="rounded-xl p-4 text-center border-2 border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/40">
            <div className="text-3xl font-black text-green-600 dark:text-green-300">+{transferStats.incoming}</div>
            <div className="text-xs font-bold text-green-600 dark:text-green-300 mt-1">↙️ Transferred In</div>
            <div className="text-xs text-green-500 dark:text-green-400 mt-0.5">Tasks received from someone else</div>
          </div>
        </div>
      )}

      {/* Task transfer history — detailed who-gave-what-to-whom log */}
      {memberTransfers.length > 0 && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-4 mb-5">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
            Transfer History ({memberTransfers.length})
          </div>
          <div className="flex flex-col gap-2">
            {memberTransfers.map((t: any) => {
              const isOutgoing = t.fromUserId === member.id;
              return (
                <div
                  key={t.id}
                  className={`rounded-lg border p-3 ${
                    isOutgoing
                      ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/40"
                      : "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-sm font-semibold text-foreground">
                      {t.taskTitle ?? "Task"}
                    </div>
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        isOutgoing
                          ? "bg-red-600 text-white"
                          : "bg-green-600 text-white"
                      }`}
                    >
                      {isOutgoing ? "Given away" : "Received"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-foreground">{t.fromUserName ?? "—"}</span>
                    <span>→</span>
                    <span className="font-semibold text-foreground">{t.toUserName ?? "—"}</span>
                    {t.taskStatus && (
                      <span className="ml-1 text-[10px] uppercase font-bold text-muted-foreground">
                        · {t.taskStatus}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {t.transferredByName ? `By ${t.transferredByName}` : "By system"}
                    {" · "}
                    {(() => {
                      const d = new Date(t.createdAt);
                      return isNaN(d.getTime())
                        ? "Unknown date"
                        : d.toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          });
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter section */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-4 mb-4">
        {/* Status filter */}
        <div className="mb-3">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">STATUS FILTER</div>
          <div className="flex gap-2 flex-wrap">
            {statusTabData.map((s) => (
              <button key={s.key} onClick={() => setStatusFilter(s.key)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition ${statusFilter === s.key ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted"}`}>
                {s.label} ({s.count})
              </button>
            ))}
          </div>
        </div>
        {/* Task type filter */}
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">TASK TYPE</div>
          <div className="flex gap-2 flex-wrap">
            {types.map((t) => {
              const count = t === "all" ? stats.total : myTasks.filter((tk) => tk.type === t).length;
              return (
                <button key={t} onClick={() => setTypeFilter(t)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition capitalize ${typeFilter === t ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted"}`}>
                  {t === "all" ? "All" : t[0].toUpperCase() + t.slice(1)} {count}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Task count */}
      <div className="text-sm text-muted-foreground mb-3 font-medium">{visibleTasks.length} task(s) shown</div>

      {/* Task cards */}
      {visibleTasks.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-10 text-center text-muted-foreground">
          No tasks for this filter
        </div>
      ) : (
        <div className="space-y-3">
          {visibleTasks.map((task) => (
            <div key={task.id} className="bg-card rounded-xl border border-border shadow-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-foreground text-sm">{task.title}</div>
                  {task.description && (
                    <div className="text-xs text-muted-foreground mt-1">{task.description}</div>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {task.category && (
                      <span className="px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs font-medium">{task.category}</span>
                    )}
                    <span className="px-2 py-0.5 bg-muted text-muted-foreground rounded-full text-xs capitalize">{task.type}</span>
                    {task.dueDate && (
                      <span className="px-2 py-0.5 bg-background border border-border text-muted-foreground rounded-full text-xs flex items-center gap-1">
                        📅 {new Date(task.dueDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                      </span>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                      task.priority === "high" || task.priority === "urgent" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" :
                      task.priority === "medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                    }`}>{task.priority}</span>
                  </div>
                  {task.remark && (
                    <div className="mt-1.5 text-xs text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 px-2 py-1 rounded-lg">💬 {task.remark}</div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                    task.status === "done" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" :
                    task.status === "inProgress" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-muted text-muted-foreground"
                  }`}>
                    {STATUS_SELECT[task.status as StatusKey] ?? task.status}
                  </span>
                  <select
                    value={task.status}
                    onChange={(e) => handleStatusChange(task.id, e.target.value)}
                    className="text-xs border border-border rounded-lg px-2 py-1 bg-card focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_SELECT[s]}</option>)}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Analytics Charts ─────────────────────────────────────── */}
      <MemberAnalytics tasks={myTasks} />
    </div>
  );
}

// ── Analytics charts component ────────────────────────────────────────────────
const PIE_COLORS = ["#10b981", "#f59e0b", "#ef4444"];

function MemberAnalytics({ tasks }: { tasks: any[] }) {
  // Chart 1: Tasks by Type — Done / InProgress / Pending
  const byTypeData = useMemo(() => {
    const types = ["daily", "weekly", "monthly", "one_time"];
    const labels: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", one_time: "One Time" };
    return types.map((t) => {
      const group = tasks.filter((tk) => tk.type === t);
      return {
        name: labels[t],
        Done: group.filter((tk) => tk.status === "done").length,
        "In Progress": group.filter((tk) => tk.status === "inProgress").length,
        Pending: group.filter((tk) => tk.status === "pending").length,
      };
    });
  }, [tasks]);

  // Chart 2: Last 7 days — daily completion line chart
  const last7Data = useMemo(() => {
    const days: { label: string; Done: number; Pending: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      days.push({ label: key, Done: 0, Pending: 0 });
    }
    for (const t of tasks) {
      if (!t.updatedAt) continue;
      const upd = new Date(t.updatedAt);
      const key = `${String(upd.getMonth() + 1).padStart(2, "0")}-${String(upd.getDate()).padStart(2, "0")}`;
      const entry = days.find((d) => d.label === key);
      if (!entry) continue;
      if (t.status === "done") entry.Done++;
      else entry.Pending++;
    }
    return days;
  }, [tasks]);

  // Chart 3: Donut — overall status distribution
  const pieData = useMemo(() => {
    const done = tasks.filter((t) => t.status === "done").length;
    const inProg = tasks.filter((t) => t.status === "inProgress").length;
    const pend = tasks.filter((t) => t.status === "pending").length;
    return [
      { name: "Done", value: done },
      { name: "In Progress", value: inProg },
      { name: "Pending", value: pend },
    ].filter((d) => d.value > 0);
  }, [tasks]);

  // Chart 4: Completion % by task type
  const pctByTypeData = useMemo(() => {
    const types = ["daily", "weekly", "monthly", "one_time"];
    const labels: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", one_time: "One Time" };
    return types.map((t) => {
      const group = tasks.filter((tk) => tk.type === t);
      const done = group.filter((tk) => tk.status === "done").length;
      const pct = group.length > 0 ? Math.round((done / group.length) * 100) : 0;
      return { name: labels[t], "Completion %": pct };
    });
  }, [tasks]);

  if (tasks.length === 0) return null;

  const chartCard = (title: string, content: React.ReactNode) => (
    <div className="bg-card rounded-xl border border-border shadow-sm p-4">
      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">{title}</div>
      {content}
    </div>
  );

  return (
    <div className="mt-6">
      <div className="text-base font-bold text-foreground mb-3">📊 Analytics</div>
      <div className="grid grid-cols-2 gap-4">
        {/* Chart 1 — Tasks by Type */}
        {chartCard("📋 Tasks by Type — Done vs Pending", (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={byTypeData} barCategoryGap="40%">
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Done" fill="#10b981" radius={[3,3,0,0]} />
              <Bar dataKey="In Progress" fill="#f59e0b" radius={[3,3,0,0]} />
              <Bar dataKey="Pending" fill="#ef4444" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        ))}

        {/* Chart 2 — Last 7 days */}
        {chartCard("📅 Last 7 Days — Daily Completion", (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={last7Data}>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Done" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Pending" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        ))}

        {/* Chart 3 — Donut */}
        {chartCard("🍩 Overall Status Distribution", (
          <div className="flex items-center gap-4">
            <ResponsiveContainer width={160} height={160}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value">
                  {pieData.map((_, idx) => (
                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-2">
              {pieData.map((d, idx) => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: PIE_COLORS[idx % PIE_COLORS.length] }} />
                  <span className="text-muted-foreground">{d.name}</span>
                  <span className="font-bold text-foreground ml-1">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Chart 4 — Completion % by type */}
        {chartCard("🎯 Completion % by Task Type", (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={pctByTypeData} barCategoryGap="50%">
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: any) => `${v}%`} />
              <Bar dataKey="Completion %" fill="#6366f1" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        ))}
      </div>
    </div>
  );
}

// ── Agent Tracking Table (Excel-like) ────────────────────────────────────────
function AgentTrackingTable({
  agents, allUsers, tlPool, headPool, currentUser, from, to, onRemove,
}: {
  agents: any[];
  allUsers: any[];
  tlPool: any[];
  headPool: any[];
  currentUser: CurrentUser;
  from: string;
  to: string;
  onRemove: (id: number, name: string) => void;
}) {
  const qc = useQueryClient();
  // A single concrete day (from === to) is the EDITABLE view. Any wider selection — a
  // date range, or "All dates" (both empty) — is a READ-ONLY per-agent roll-up.
  const isSingleDay = !!from && from === to;
  const isAllDates = !isSingleDay; // "aggregated / read-only" (range or all-time)
  // The one editable day's rows (only fetched when a single day is selected).
  const { data: dayMetrics = [] } = useListAgentMetrics(
    { date: from },
    { query: { enabled: isSingleDay, queryKey: getListAgentMetricsQueryKey({ date: from }) } }
  );
  const { data: dayAttendance = [] } = useListAttendance(
    { date: from },
    { query: { enabled: isSingleDay, queryKey: getListAttendanceQueryKey({ date: from }) } }
  );
  // Every metric/attendance row — used for Target carry-forward AND to aggregate over a
  // date range / all-time window (the API has no range filter, so we window client-side).
  const { data: allMetrics = [] } = useListAgentMetrics(
    {},
    { query: { queryKey: getListAgentMetricsQueryKey({}) } }
  );
  const { data: allAttendance = [] } = useListAttendance(
    {},
    { query: { queryKey: getListAttendanceQueryKey({}) } }
  );
  const windowMetrics = useMemo(
    () => (isSingleDay ? dayMetrics : allMetrics.filter((m) => (!from || m.date >= from) && (!to || m.date <= to))),
    [isSingleDay, dayMetrics, allMetrics, from, to]
  );
  const windowAttendance = useMemo(
    () => (isSingleDay ? dayAttendance : allAttendance.filter((a) => (!from || a.date >= from) && (!to || a.date <= to))),
    [isSingleDay, dayAttendance, allAttendance, from, to]
  );
  const metrics = dayMetrics;
  const aggMap = useMemo(() => aggregateMetricsByAgent(windowMetrics), [windowMetrics]);
  const latestTargetByAgent = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of allMetrics) {
      if (r.target != null && !m.has(r.agentId)) m.set(r.agentId, r.target);
    }
    return m;
  }, [allMetrics]);
  const upsertMetric = useUpsertAgentMetric();
  const upsertAttendance = useUpsertAttendance();
  const updateUser = useUpdateUser();

  // userId → name map, used to resolve each agent's TL (reportsTo) name.
  const nameById = useMemo(() => new Map(allUsers.map((u) => [u.id, u.name])), [allUsers]);

  // Boss / MIS / Center Head can (re)assign which TL an agent reports to.
  const isBossUser = currentUser.department === "Management" || currentUser.role === "Boss";
  const isMisUser = isAllCentersViewer(currentUser);
  const canAssignTl = isBossUser || isMisUser || currentUser.role === "Center Head";
  // Boss / MIS / Center Head, plus a Team Leader (for their own team's agents — the
  // server scopes a TL's center change to the Sales Agents in their subtree), can move
  // an agent to a different center.
  const canAssignCenter = canAssignTl || currentUser.role === "Team Leader";
  // A Team Leader can only move their own agents within their OWN center (server-enforced).
  const isTeamLeader = currentUser.role === "Team Leader";
  const myCenter = allUsers.find((u) => u.id === currentUser.id)?.center as string | undefined;

  // Managers available to assign an agent to — Center Heads first (an agent may report
  // directly to a head), then the center-scoped Team Leaders. Sourced from pools (not
  // the active department tab) so the dropdown is never emptied by a dept filter.
  const tlOptions = useMemo(
    () => [
      ...headPool
        .map((u) => ({ id: u.id, name: `${u.name} (Center Head)` }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      ...tlPool
        .map((u) => ({ id: u.id, name: u.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ],
    [tlPool, headPool]
  );

  // Local editable drafts for the numeric metric cells, keyed by agentId.
  const [drafts, setDrafts] = useState<Record<number, MetricDraft>>({});
  // Local editable drafts for DOJ, keyed by agentId.
  const [doj, setDoj] = useState<Record<number, string>>({});
  // Local editable drafts for the per-agent/per-date Remark cell, keyed by agentId.
  const [remarkDraft, setRemarkDraft] = useState<Record<number, string>>({});
  const [flash, setFlash] = useState<Record<number, string>>({});
  // Header dropdown controls: sort by name, filter by tenure bucket.
  const [nameSort, setNameSort] = useState<"az" | "za">("az");
  const [tenureFilter, setTenureFilter] = useState<typeof TENURE_FILTERS[number]>("All");

  // Seed metric drafts from the fetched metrics whenever the date/data changes.
  useEffect(() => {
    const byAgent = new Map<number, any>();
    for (const m of metrics) byAgent.set(m.agentId, m);
    const next: Record<number, MetricDraft> = {};
    for (const a of agents) {
      const m = byAgent.get(a.id);
      // Target carries forward: if this date has no target of its own, show the agent's
      // last-set target so it stays the same on future dates instead of blanking out.
      const carriedTarget = latestTargetByAgent.has(a.id) ? String(latestTargetByAgent.get(a.id)) : "";
      next[a.id] = m
        ? {
            dc: m.dc != null ? String(m.dc) : "",
            prospectCount: m.prospectCount != null ? String(m.prospectCount) : "",
            salesFd: m.salesFd != null ? String(m.salesFd) : "",
            salesMtd: m.salesMtd != null ? String(m.salesMtd) : "",
            target: m.target != null ? String(m.target) : carriedTarget,
            last3mAvg: m.last3mAvg != null ? String(m.last3mAvg) : "",
            last6mAvg: m.last6mAvg != null ? String(m.last6mAvg) : "",
          }
        : { ...emptyDraft(), target: carriedTarget };
    }
    setDrafts(next);
    const nextRemark: Record<number, string> = {};
    for (const a of agents) {
      const m = byAgent.get(a.id);
      nextRemark[a.id] = m && m.remark != null ? String(m.remark) : "";
    }
    setRemarkDraft(nextRemark);
  }, [metrics, agents, latestTargetByAgent]);

  // Seed DOJ drafts from the user records.
  useEffect(() => {
    const d: Record<number, string> = {};
    for (const a of agents) {
      d[a.id] = a.doj ?? "";
    }
    setDoj(d);
  }, [agents]);

  // status per agent for the selected (single) day — drives the editable dropdown
  const statusByAgent = useMemo(() => {
    const map = new Map<number, string>();
    for (const a of dayAttendance) map.set(a.userId, a.status);
    return map;
  }, [dayAttendance]);

  const showFlash = (agentId: number, msg: string) => {
    setFlash((f) => ({ ...f, [agentId]: msg }));
    setTimeout(() => setFlash((f) => ({ ...f, [agentId]: "" })), 1500);
  };

  const toNum = (s: string): number | null => {
    const t = s.trim();
    if (t === "") return null;
    const n = Number(t);
    return isNaN(n) ? null : n;
  };

  const saveMetrics = (agentId: number) => {
    if (!from) return; // editing is only possible on a concrete single day
    const d = drafts[agentId] ?? emptyDraft();
    upsertMetric.mutate(
      {
        data: {
          agentId,
          date: from,
          dc: toNum(d.dc),
          prospectCount: toNum(d.prospectCount),
          salesFd: toNum(d.salesFd),
          salesMtd: toNum(d.salesMtd),
          target: toNum(d.target),
          last3mAvg: toNum(d.last3mAvg),
          last6mAvg: toNum(d.last6mAvg),
          remark: remarkDraft[agentId]?.trim() || null,
          updatedBy: currentUser.id,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListAgentMetricsQueryKey({ date: from }) });
          // Also refresh the all-metrics source so a target set now carries forward
          // to other dates immediately (no reload needed).
          qc.invalidateQueries({ queryKey: getListAgentMetricsQueryKey({}) });
          showFlash(agentId, "Saved");
        },
        onError: () => showFlash(agentId, "Save failed"),
      }
    );
  };

  const saveAttendance = (agentId: number, status: string) => {
    if (!status || !from) return;
    const center = allUsers.find((u) => u.id === agentId)?.center ?? null;
    upsertAttendance.mutate(
      { data: { userId: agentId, date: from, status, center, markedBy: currentUser.id } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListAttendanceQueryKey({ date: from }) });
          qc.invalidateQueries({ queryKey: getListAttendanceQueryKey({}) });
          qc.invalidateQueries({ queryKey: getListAttendanceQueryKey() });
          showFlash(agentId, "Attendance saved");
        },
        onError: () => showFlash(agentId, "Save failed"),
      }
    );
  };

  const saveDoj = (agentId: number) => {
    updateUser.mutate(
      { id: agentId, data: { doj: doj[agentId]?.trim() || null } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
          showFlash(agentId, "DOJ saved");
        },
        onError: () => showFlash(agentId, "Save failed"),
      }
    );
  };

  const saveTl = (agentId: number, value: string) => {
    const reportsTo = value === "" ? null : Number(value);
    updateUser.mutate(
      { id: agentId, data: { reportsTo } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
          showFlash(agentId, "TL updated");
        },
        onError: () => showFlash(agentId, "Save failed"),
      }
    );
  };

  const saveCenter = (agentId: number, value: string) => {
    updateUser.mutate(
      { id: agentId, data: { center: value || undefined } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
          showFlash(agentId, "Center updated");
        },
        onError: () => showFlash(agentId, "Save failed"),
      }
    );
  };

  const saveStatus = (agentId: number, value: string) => {
    updateUser.mutate(
      { id: agentId, data: { status: value as "Active" | "Inactive" } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
          showFlash(agentId, "Status updated");
        },
        onError: () => showFlash(agentId, "Save failed"),
      }
    );
  };

  const setDraftField = (agentId: number, field: MetricField, value: string) => {
    setDrafts((d) => ({ ...d, [agentId]: { ...(d[agentId] ?? emptyDraft()), [field]: value } }));
  };

  // Apply the header dropdowns: filter by tenure bucket, then sort by name.
  const displayAgents = useMemo(() => {
    let list = agents;
    if (tenureFilter !== "All") list = list.filter((a) => tenureBucket(a.doj) === tenureFilter);
    return [...list].sort((a, b) =>
      nameSort === "za" ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)
    );
  }, [agents, tenureFilter, nameSort]);

  // Present-days per agent (used by the "All dates" view where a single agent has
  // many attendance rows). Half-days count as 0.5.
  const presentByAgent = useMemo(() => {
    const m = new Map<number, number>();
    for (const a of windowAttendance) {
      if (a.status === "present") m.set(a.userId, (m.get(a.userId) || 0) + 1);
      else if (a.status === "half_day") m.set(a.userId, (m.get(a.userId) || 0) + 0.5);
    }
    return m;
  }, [windowAttendance]);

  const colTotals = useMemo(() => {
    // Sales MTD is intentionally NOT totalled: each agent's figure is already a
    // month-to-date cumulative number, so summing it across the column inflates it.
    const t = { dc: 0, prospectCount: 0, salesFd: 0, target: 0, last3mAvg: 0, last6mAvg: 0, present: 0 };
    for (const a of displayAgents) {
      // In the All-dates view the per-agent numbers come from the aggregate roll-up;
      // otherwise they come from the editable drafts for the selected day.
      const src = isAllDates ? aggMap.get(a.id) : drafts[a.id];
      if (src) {
        t.dc += Number(src.dc) || 0;
        t.prospectCount += Number(src.prospectCount) || 0;
        t.salesFd += Number(src.salesFd) || 0;
        t.target += Number(src.target) || 0;
        t.last3mAvg += Number(src.last3mAvg) || 0;
        t.last6mAvg += Number(src.last6mAvg) || 0;
      }
      if (isAllDates) {
        t.present += presentByAgent.get(a.id) || 0;
      } else {
        const st = statusByAgent.get(a.id);
        if (st === "present") t.present += 1;
        else if (st === "half_day") t.present += 0.5;
      }
    }
    return t;
  }, [displayAgents, drafts, statusByAgent, isAllDates, aggMap, presentByAgent]);

  const numInput =
    "w-20 px-2 py-1 border border-border rounded-md text-sm text-right bg-card focus:outline-none focus:ring-2 focus:ring-ring";
  // Read-only value box used in the "All dates" (aggregated) view.
  const roVal = "inline-block w-20 px-2 py-1 text-sm text-right text-foreground tabular-nums";
  const showVal = (v: unknown) => (v == null || v === "" ? "—" : String(v));
  const th = "px-3 py-2 text-left font-bold text-muted-foreground whitespace-nowrap border-b border-border";
  const td = "px-3 py-2 whitespace-nowrap border-b border-border align-middle";

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm">
      {/* Toolbar */}
      <div className="flex items-center gap-3 p-4 flex-wrap border-b border-border">
        <span className="text-sm font-bold text-foreground">📋 Agent Tracking</span>
        <span className="text-xs text-muted-foreground ml-auto">
          All numbers are entered manually. Changes save automatically.
        </span>
      </div>

      {displayAgents.length === 0 ? (
        <div className="p-10 text-center text-muted-foreground">No agents for this filter</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-muted/50">
              <tr>
                <th className={th}>
                  <div className="flex items-center gap-2">
                    <span>Agent Name</span>
                    <select
                      value={nameSort}
                      onChange={(e) => setNameSort(e.target.value as "az" | "za")}
                      className="px-1.5 py-0.5 border border-border rounded-md text-xs font-normal bg-card focus:outline-none focus:ring-2 focus:ring-ring"
                      title="Sort by name"
                    >
                      <option value="az">A → Z</option>
                      <option value="za">Z → A</option>
                    </select>
                  </div>
                </th>
                <th className={th}>TL Name</th>
                <th className={th}>Center</th>
                <th className={th}>Status</th>
                <th className={th}>DOJ</th>
                <th className={th}>
                  <div className="flex items-center gap-2">
                    <span>Agent Tenure</span>
                    <select
                      value={tenureFilter}
                      onChange={(e) => setTenureFilter(e.target.value as typeof TENURE_FILTERS[number])}
                      className="px-1.5 py-0.5 border border-border rounded-md text-xs font-normal bg-card focus:outline-none focus:ring-2 focus:ring-ring"
                      title="Filter by tenure"
                    >
                      {TENURE_FILTERS.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                </th>
                <th className={th}>Tenure</th>
                <th className={th}>DC</th>
                <th className={th}>Prospect Count</th>
                <th className={th}>Sales FD</th>
                <th className={th}>Sales MTD</th>
                <th className={th}>Target</th>
                <th className={th}>Attendance</th>
                <th className={th}>Last 3M Avg</th>
                <th className={th}>Last 6M Avg</th>
                <th className={th}>Remark</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {displayAgents.map((a) => {
                const d = drafts[a.id] ?? emptyDraft();
                // In All-dates mode the visible metric values come from the aggregate roll-up.
                const mv: any = isAllDates ? (aggMap.get(a.id) ?? {}) : d;
                const status = statusByAgent.get(a.id) ?? "";
                const tlName = a.reportsTo != null ? nameById.get(a.reportsTo) ?? "—" : "—";
                const isTl = a.role === "Team Leader";
                return (
                  <tr key={a.id} className="hover:bg-muted/30">
                    <td className={`${td} font-semibold text-foreground`}>{a.name}</td>
                    <td className={td}>
                      {canAssignTl && !isTl ? (
                        <select
                          value={a.reportsTo != null ? String(a.reportsTo) : ""}
                          onChange={(e) => saveTl(a.id, e.target.value)}
                          className="px-2 py-1 border border-border rounded-md text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          <option value="">— Unassigned —</option>
                          {tlOptions.map((t) => (
                            <option key={t.id} value={String(t.id)}>{t.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-muted-foreground">{tlName}</span>
                      )}
                    </td>
                    <td className={td}>
                      {canAssignCenter ? (
                        <select
                          value={a.center ?? ""}
                          onChange={(e) => { if (e.target.value) saveCenter(a.id, e.target.value); }}
                          className="px-2 py-1 border border-border rounded-md text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          {!a.center && <option value="">— Select —</option>}
                          {(isTeamLeader ? AGENT_CENTERS.filter((c) => c === myCenter) : AGENT_CENTERS).map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                          {a.center && !(AGENT_CENTERS as readonly string[]).includes(a.center) && (
                            <option value={a.center}>{a.center}</option>
                          )}
                        </select>
                      ) : (
                        <span className="text-muted-foreground">{a.center ?? "—"}</span>
                      )}
                    </td>
                    <td className={td}>
                      <select
                        value={a.status ?? "Active"}
                        onChange={(e) => saveStatus(a.id, e.target.value)}
                        className={`px-2 py-1 border rounded-md text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring font-semibold ${
                          (a.status ?? "Active") === "Inactive"
                            ? "text-red-600 dark:text-red-300 border-red-300 dark:border-red-700"
                            : "text-green-600 dark:text-green-300 border-green-300 dark:border-green-700"
                        }`}
                      >
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                    </td>
                    <td className={td}>
                      <input
                        type="date"
                        value={doj[a.id] ?? ""}
                        onChange={(e) => setDoj((s) => ({ ...s, [a.id]: e.target.value }))}
                        onBlur={() => { if ((doj[a.id] ?? "") !== (a.doj ?? "")) saveDoj(a.id); }}
                        className="px-2 py-1 border border-border rounded-md text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </td>
                    <td className={`${td} text-muted-foreground`}>{tenureLabel(doj[a.id] ?? a.doj)}</td>
                    <td className={td}>
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
                        {tenureBucket(doj[a.id] ?? a.doj)}
                      </span>
                    </td>
                    {METRIC_FIELDS.slice(0, 5).map((f) => {
                      if (f === "salesMtd") {
                        // % is Sales MTD as a share of the agent's Target (achievement).
                        const val = Number(mv.salesMtd) || 0;
                        const tgt = Number(mv.target) || 0;
                        const isZero = val <= 0;
                        const hasTarget = tgt > 0;
                        // Real achievement % (can exceed 100 when the agent beats target).
                        const pct = hasTarget ? Math.round((val / tgt) * 100) : 0;
                        // Bar fill is clamped to 0–100 so overachievement doesn't overflow.
                        const barPct = Math.min(100, Math.max(5, pct));
                        return (
                          <td className={`${td} ${isZero ? "bg-red-50 dark:bg-red-950/40" : ""}`} key={f}>
                            <div className="flex flex-col gap-1">
                              {isAllDates ? (
                                <span className={`${roVal} ${isZero ? "text-red-600 dark:text-red-300 font-semibold" : ""}`}>{showVal(mv.salesMtd)}</span>
                              ) : (
                                <input
                                  type="number"
                                  value={d[f]}
                                  onChange={(e) => setDraftField(a.id, f, e.target.value)}
                                  onBlur={() => saveMetrics(a.id)}
                                  className={`${numInput} ${isZero ? "border-red-400 dark:border-red-600 text-red-600 dark:text-red-300 font-semibold" : ""}`}
                                />
                              )}
                              <div
                                className="flex items-center gap-1.5 w-28"
                                title={hasTarget ? `Sales MTD: ${val} / Target ${tgt} (${pct}%)` : "No target set"}
                              >
                                <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${isZero ? "bg-red-200 dark:bg-red-900/50" : "bg-muted"}`}>
                                  {hasTarget && !isZero && (
                                    <div
                                      className={`h-full rounded-full ${pct >= 100 ? "bg-green-500" : pct >= 50 ? "bg-amber-500" : "bg-orange-500"}`}
                                      style={{ width: `${barPct}%` }}
                                    />
                                  )}
                                </div>
                                <span className={`text-[10px] font-semibold tabular-nums w-10 text-right ${isZero ? "text-red-600 dark:text-red-300" : pct >= 100 ? "text-green-600 dark:text-green-300" : "text-muted-foreground"}`}>
                                  {hasTarget ? `${pct}%` : "—"}
                                </span>
                              </div>
                            </div>
                          </td>
                        );
                      }
                      return (
                        <td className={td} key={f}>
                          {isAllDates ? (
                            <span className={roVal}>{showVal(mv[f])}</span>
                          ) : (
                            <input
                              type="number"
                              value={d[f]}
                              onChange={(e) => setDraftField(a.id, f, e.target.value)}
                              onBlur={() => saveMetrics(a.id)}
                              className={numInput}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className={td}>
                      {isAllDates ? (
                        <span className="text-sm text-muted-foreground tabular-nums">{presentByAgent.get(a.id) || 0}d present</span>
                      ) : (
                        <select
                          value={status}
                          onChange={(e) => saveAttendance(a.id, e.target.value)}
                          className={`px-2 py-1 border rounded-md text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring font-semibold ${
                            status === "absent" || status === "leave"
                              ? "text-red-600 dark:text-red-300 border-red-300 dark:border-red-700"
                              : status === "half_day"
                              ? "text-amber-600 dark:text-amber-300 border-amber-300 dark:border-amber-700"
                              : status === "present"
                              ? "text-green-600 dark:text-green-300 border-green-300 dark:border-green-700"
                              : "border-border text-muted-foreground"
                          }`}
                        >
                          {ATTENDANCE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    {(["last3mAvg", "last6mAvg"] as MetricField[]).map((f) => (
                      <td className={td} key={f}>
                        {isAllDates ? (
                          <span className={roVal}>{showVal(mv[f])}</span>
                        ) : (
                          <input
                            type="number"
                            value={d[f]}
                            onChange={(e) => setDraftField(a.id, f, e.target.value)}
                            onBlur={() => saveMetrics(a.id)}
                            className={numInput}
                          />
                        )}
                      </td>
                    ))}
                    <td className={td}>
                      {isAllDates ? (
                        <span className="text-sm text-muted-foreground">{showVal(mv.remark)}</span>
                      ) : (
                        <input
                          type="text"
                          value={remarkDraft[a.id] ?? ""}
                          onChange={(e) => setRemarkDraft((r) => ({ ...r, [a.id]: e.target.value }))}
                          onBlur={() => saveMetrics(a.id)}
                          placeholder="—"
                          className="w-44 px-2 py-1 border border-border rounded-md text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      )}
                    </td>
                    <td className={`${td} text-xs`}>
                      <div className="flex items-center gap-2">
                        {flash[a.id] && (
                          <span className={flash[a.id]?.includes("fail") || flash[a.id]?.includes("taken") ? "text-red-500" : "text-green-600 dark:text-green-300"}>
                            {flash[a.id]}
                          </span>
                        )}
                        <button
                          onClick={() => onRemove(a.id, a.name)}
                          title="Remove agent"
                          className="ml-auto text-red-400 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 font-bold"
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-muted/60 font-bold border-t-2 border-border">
                <td className={`${td} text-foreground`} colSpan={7}>Grand Total ({displayAgents.length} agent{displayAgents.length === 1 ? "" : "s"})</td>
                <td className={`${td} text-right text-foreground`}>{colTotals.dc}</td>
                <td className={`${td} text-right text-foreground`}>{colTotals.prospectCount}</td>
                <td className={`${td} text-right text-foreground`}>{colTotals.salesFd}</td>
                <td className={`${td} text-right text-muted-foreground`}>—</td>
                <td className={`${td} text-right text-foreground`}>{colTotals.target}</td>
                <td className={`${td} text-foreground`}>{colTotals.present} present</td>
                <td className={`${td} text-right text-foreground`}>{colTotals.last3mAvg}</td>
                <td className={`${td} text-right text-foreground`}>{colTotals.last6mAvg}</td>
                <td className={td}></td>
                <td className={td}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Team Page ───────────────────────────────────────────────────────────
export default function Team({ currentUser }: TeamProps) {
  const qc = useQueryClient();
  const [selectedMember, setSelectedMember] = useState<any | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", role: "", username: "", password: "", department: "Accounts", center: isAllCentersViewer(currentUser) ? "Thane Center" : "Head Office", email: "" });
  const [addError, setAddError] = useState("");
  const [centerFilter, setCenterFilter] = useState("All");
  const [deptFilter, setDeptFilter] = useState("All");
  const [headFilter, setHeadFilter] = useState<number | "All">("All");
  const [tlFilter, setTlFilter] = useState<number | "All">("All");
  const [statusFilter, setStatusFilter] = useState<"Active" | "Inactive" | "All">("Active");
  const [view, setView] = useState<"cards" | "tracking">("cards");
  const [trackFrom, setTrackFrom] = useState(() => todayISO());
  const [trackTo, setTrackTo] = useState(() => todayISO());
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [agentForm, setAgentForm] = useState({ name: "", email: "", doj: "", center: "Thane Center", reportsTo: "", status: "Active", role: "Sales Agent", username: "", password: "" });
  const [agentError, setAgentError] = useState("");

  const { data: allUsers = [], isLoading } = useListUsers();
  const { data: allTasks = [] } = useListTasks({});
  const isMis = isAllCentersViewer(currentUser);
  const isBoss = currentUser.department === "Management" || currentUser.role === "Boss";
  // A Team Leader may add agents only to their OWN team: role is locked to Sales Agent
  // (no login), center to their own center, and the new agent reports to the TL. The
  // server enforces the same scope.
  const isTeamLeader = currentUser.role === "Team Leader";
  // Agent Tracking is restricted: only the Boss, MIS, Center Heads, and Team
  // Leaders may see it (TLs enter their agents' numbers). Everyone else — regular
  // staff like an Accounts Executive — only ever gets the Cards view.
  const canSeeTracking =
    isBoss || isMis || currentUser.role === "Center Head" || currentUser.role === "Team Leader";
  // Only fetch tracking data for users allowed to see Agent Tracking — otherwise
  // the data would still reach unauthorized users over the network even with the
  // tab hidden.
  // CSV export and the per-TL roll-up window client-side over [trackFrom, trackTo], so
  // we fetch every row once (the API has no range filter) and filter below.
  const { data: trackMetricsAll = [] } = useListAgentMetrics(
    {},
    { query: { enabled: canSeeTracking, queryKey: getListAgentMetricsQueryKey({}) } }
  );
  const { data: trackAttendanceAll = [] } = useListAttendance(
    {},
    { query: { enabled: canSeeTracking, queryKey: getListAttendanceQueryKey({}) } }
  );
  const trackIsSingleDay = !!trackFrom && trackFrom === trackTo;
  const inTrackWindow = (d: string) => (!trackFrom || d >= trackFrom) && (!trackTo || d <= trackTo);
  const trackMetrics = useMemo(
    () => trackMetricsAll.filter((m) => inTrackWindow(m.date)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackMetricsAll, trackFrom, trackTo]
  );
  const trackAttendance = useMemo(
    () => trackAttendanceAll.filter((a) => inTrackWindow(a.date)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackAttendanceAll, trackFrom, trackTo]
  );
  const createUser = useCreateUser();
  const deleteUser = useDeleteUser();

  // ── Hierarchy: full recursive org-chart subtree ─────────────────
  // hierarchyIds = currentUser + ALL direct & indirect reports (BFS)
  const hierarchyIds = useMemo(
    () => buildHierarchySet(currentUser.id, allUsers),
    [currentUser.id, allUsers]
  );

  // Force unauthorized users back to Cards if they ever land on the tracking view.
  useEffect(() => {
    if (!canSeeTracking && view === "tracking") setView("cards");
  }, [canSeeTracking, view]);
  // The current user's own center (used to default the "Add Member" center).
  const myCenter = allUsers.find((u) => u.id === currentUser.id)?.center as string | undefined;

  // id → user map + walk-up helper to find a person's Center Head ancestor.
  const userById = useMemo(() => new Map<number, any>(allUsers.map((u) => [u.id, u])), [allUsers]);
  const headAncestorId = (id: number): number | null => {
    let cur: any = userById.get(id);
    let guard = 0;
    while (cur && guard++ < 20) {
      if (cur.role === "Center Head") return cur.id;
      if (cur.reportsTo == null) return null;
      cur = userById.get(cur.reportsTo);
    }
    return null;
  };
  // MIS sees EVERY center (including Head Office). Boss sees EVERYONE regardless of
  // org-chart links (role-guaranteed, so missing reportsTo links never hide a center).
  // Everyone else sees their own org subtree. Always excluding the current user.
  // Per-user center restriction (Boss/MIS only). null = no restriction.
  const allowedCenters = useMemo(
    () => resolveAllowedCenters(allUsers.find((u) => u.id === currentUser.id) ?? null, allUsers),
    [allUsers, currentUser.id]
  );
  const teamToShow = useMemo(() => {
    let base: any[];
    if (isMis) base = allUsers.filter((u) => u.id !== currentUser.id);
    else if (isBoss) base = allUsers.filter((u) => u.id !== currentUser.id);
    else base = allUsers.filter((u) => hierarchyIds.has(u.id) && u.id !== currentUser.id);
    if (allowedCenters) base = base.filter((u) => u.center && allowedCenters.has(u.center));
    return base;
  }, [allUsers, hierarchyIds, currentUser.id, isMis, isBoss, allowedCenters]);

  // Agent Tracking is for CENTERS only — Head Office is never included. Boss is at
  // the top of the org chart so their subtree already spans every center; MIS already
  // sees all centers. So simply dropping Head Office gives Boss/MIS all four centers
  // (Thane / Malad / Pune / Navi Mumbai) and gives a Center Head their own center.
  // Center Heads, the Boss AND Team Leaders are managers, not tracked agents — never
  // list them as rows in Agent Tracking. Only Sales Agents appear here; each agent's
  // TL is shown (auto-filled) from its reportsTo link. TLs live in the Cards view.
  const trackingBase = useMemo(
    () =>
      teamToShow.filter(
        (u) =>
          u.role === "Sales Agent" &&
          u.center &&
          u.center !== "Head Office"
      ),
    [teamToShow]
  );

  // The list that drives center/dept filters + the rendered list depends on the view.
  const displayBase = view === "tracking" ? trackingBase : teamToShow;

  // Center filter pills — Head Office first, then known centers in display order.
  // In the Agent Tracking view always offer the four standard centers (even if a
  // center currently has no members) so Boss/MIS can always pick Thane/Malad/Pune/Navi Mumbai.
  const centerOptions = useMemo(() => {
    const set = new Set(displayBase.map((u) => u.center).filter((c): c is string => Boolean(c)));
    // Only Boss / MIS legitimately span every center, so only they get the full set of
    // center pills. A Center Head sees only the center(s) of their own people.
    if (view === "tracking" && (isBoss || isMis)) {
      for (const c of ["Thane Center", "Malad Center", "Pune Center", "Navi Mumbai Center"]) set.add(c);
    }
    // A custom center set hides any center the viewer isn't allowed to see.
    const allowed = allowedCenters;
    const order = ["Head Office", "Thane Center", "Malad Center", "Pune Center", "Navi Mumbai Center"];
    const rank = (c: string) => { const i = order.indexOf(c); return i === -1 ? order.length : i; };
    return ["All", ...Array.from(set).filter((c) => !allowed || allowed.has(c)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))];
  }, [displayBase, view, isBoss, isMis, allowedCenters]);

  // Department tabs reflect the selected center. "Sales" is excluded — Sales
  // Agents are shown in the Agent Tracking view, never in Cards, so the tab
  // would always be empty here.
  const deptSource = centerFilter === "All" ? displayBase : displayBase.filter((u) => u.center === centerFilter);
  const DEPTS = ["All", ...Array.from(new Set(deptSource.map((u) => u.department))).filter((d) => d !== "Sales").sort()];

  // Center Head filter (tracking view) — the heads who own the people in scope.
  // Selecting a head shows all TLs / agents under that head.
  const headOptions = useMemo(() => {
    const scope = centerFilter === "All" ? trackingBase : trackingBase.filter((u) => u.center === centerFilter);
    const ids = new Set<number>();
    for (const u of scope) { const h = headAncestorId(u.id); if (h != null) ids.add(h); }
    return Array.from(ids)
      .map((id) => userById.get(id))
      .filter(Boolean)
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingBase, centerFilter, userById]);

  // Known centers across the company (for the datalist when adding a member) —
  // always offer every standard center, even ones that have no members yet.
  const CENTER_ORDER = ["Head Office", "Thane Center", "Malad Center", "Pune Center", "Navi Mumbai Center"];
  const CENTERS = (() => {
    const set = new Set<string>([...CENTER_ORDER, ...allUsers.map((u) => u.center).filter((c): c is string => Boolean(c))]);
    const rank = (c: string) => { const i = CENTER_ORDER.indexOf(c); return i === -1 ? CENTER_ORDER.length : i; };
    // MIS may never assign anyone to Head Office; a custom center set further
    // limits which centers a new member can be assigned to.
    return Array.from(set)
      .filter((c) => !isMis || c !== "Head Office")
      .filter((c) => !allowedCenters || allowedCenters.has(c))
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  })();

  // If the selected Center Head is no longer in scope (e.g. after a center change
  // or data update), drop back to "All" so the table never silently goes empty.
  useEffect(() => {
    if (headFilter !== "All" && !headOptions.some((h: any) => h.id === headFilter)) {
      setHeadFilter("All");
    }
  }, [headFilter, headOptions]);

  const filtered = displayBase.filter((u) =>
    (centerFilter === "All" || u.center === centerFilter) &&
    (deptFilter === "All" || u.department === deptFilter) &&
    (headFilter === "All" || headAncestorId(u.id) === headFilter) &&
    (tlFilter === "All" || u.reportsTo === tlFilter) &&
    (view !== "tracking" || statusFilter === "All" || (u.status ?? "Active") === statusFilter) &&
    // Cards view excludes Sales Agents (they're tracked in the Agent Tracking view). So
    // sales centers show their Team Leaders / Center Head, and Head Office shows its office staff.
    (view !== "cards" || u.role !== "Sales Agent")
  );

  // Download the currently-scoped Agent Tracking rows (respects center / status / TL
  // filters and the selected date) as a CSV, matching the on-screen table columns.
  const downloadAgentTracking = () => {
    // A single day keeps that day's row (last-wins). Any wider window (a date range or
    // "All dates") rolls every in-window date up per agent. Attendance likewise: a
    // present-days count for a window, else the day's status label.
    const isAll = !trackIsSingleDay;
    const metricByAgent = isAll ? aggregateMetricsByAgent(trackMetrics) : new Map<number, any>();
    if (!isAll) for (const m of trackMetrics) metricByAgent.set(m.agentId, m);
    const attByAgent = new Map<number, string>();
    const presentDays = new Map<number, number>();
    for (const a of trackAttendance) {
      attByAgent.set(a.userId, a.status);
      if (a.status === "present") presentDays.set(a.userId, (presentDays.get(a.userId) || 0) + 1);
      else if (a.status === "half_day") presentDays.set(a.userId, (presentDays.get(a.userId) || 0) + 0.5);
    }
    const attLabel = (s: string | undefined) =>
      s === "present" ? "Present" : s === "absent" ? "Absent" : s === "half_day" ? "Half Day" : s === "leave" ? "Leave" : s === "week_off" ? "Week Off" : (s ?? "");
    const csvCell = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = ["Agent Name", "TL Name", "Center", "Status", "DOJ", "Tenure Bucket", "Tenure", "DC", "Prospect Count", "Sales FD", "Sales MTD", "Target", "Attendance", "Last 3M Avg", "Last 6M Avg", "Remark"];
    const rows = filtered.map((a: any) => {
      const m = metricByAgent.get(a.id) ?? {};
      const tlName = a.reportsTo != null ? userById.get(a.reportsTo)?.name ?? "—" : "—";
      return [
        a.name, tlName, a.center ?? "", a.status ?? "Active", a.doj ?? "",
        tenureBucket(a.doj), tenureLabel(a.doj),
        m.dc ?? "", m.prospectCount ?? "", m.salesFd ?? "", m.salesMtd ?? "", m.target ?? "",
        isAll ? `${presentDays.get(a.id) || 0}d present` : attLabel(attByAgent.get(a.id)), m.last3mAvg ?? "", m.last6mAvg ?? "", m.remark ?? "",
      ];
    });
    const csv = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agent-tracking-${trackIsSingleDay ? trackFrom : `${trackFrom || "all"}_to_${trackTo || "all"}`}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Managers an agent can report to within the chosen center (Center Head + its TLs).
  const agentFormManagers = useMemo(
    () =>
      allUsers
        .filter((u) => u.center === agentForm.center && (u.role === "Team Leader" || u.role === "Center Head"))
        .sort((a, b) => Number(b.role === "Center Head") - Number(a.role === "Center Head") || a.name.localeCompare(b.name)),
    [allUsers, agentForm.center]
  );

  // Team Leaders available to assign in the tracking table — scoped by center only
  // (NOT by the department tab) so the TL dropdown is never emptied by a dept filter.
  // Sourced from teamToShow (NOT trackingBase, which now excludes Team Leaders) so the
  // TL-assignment dropdown in the agent table still lists the center's Team Leaders.
  const tlPool = useMemo(() => {
    const inScope = (u: any) =>
      u && u.role === "Team Leader" && u.center && u.center !== "Head Office" &&
      (centerFilter === "All" || u.center === centerFilter);
    const tls = teamToShow.filter(inScope);
    // teamToShow excludes the viewer, but a Team Leader viewer directly manages
    // their own agents — add them back so their agents show as a TL card / drill-in
    // (otherwise a logged-in TL sees "No team leaders" with their agents hidden).
    const me = allUsers.find((u) => u.id === currentUser.id);
    if (me && inScope(me) && !tls.some((t) => t.id === me.id)) tls.push(me);
    return tls;
  }, [teamToShow, allUsers, currentUser.id, centerFilter]);

  // Center Heads in scope — also offered in the per-row TL-assignment dropdown so an
  // agent can be set to report directly to a Center Head (not only a Team Leader).
  const headPool = useMemo(() => {
    const inScope = (u: any) =>
      u && u.role === "Center Head" && u.center && u.center !== "Head Office" &&
      (centerFilter === "All" || u.center === centerFilter);
    const heads = teamToShow.filter(inScope);
    // teamToShow excludes the viewer, but a Center Head must be able to assign an agent
    // directly to THEMSELVES — so add the viewer back when they are an in-scope head.
    const me = allUsers.find((u) => u.id === currentUser.id);
    if (me && inScope(me) && !heads.some((h) => h.id === me.id)) heads.push(me);
    return heads;
  }, [teamToShow, allUsers, currentUser.id, centerFilter]);

  // Team Leaders shown in the TL filter pills — the TLs in scope (respecting the
  // chosen center / head). Lets a manager view just one TL's team of agents.
  // Center Heads who DIRECTLY own at least one agent also appear here (they have a
  // team too), so their directly-reporting agents can be filtered just like a TL's.
  const tlOptions = useMemo(() => {
    const scope = headFilter === "All" ? tlPool : tlPool.filter((t) => headAncestorId(t.id) === headFilter);
    const tls = [...scope].sort((a, b) => a.name.localeCompare(b.name));
    // Derive direct-owning Center Heads from the SAME center-scoped agent set the
    // TL pills use, so a head from another center never appears (which would let the
    // user pick a TL/head with zero agents in the selected center → empty table).
    const scopeAgents = centerFilter === "All" ? trackingBase : trackingBase.filter((a) => a.center === centerFilter);
    const directHeadIds = new Set<number>();
    for (const a of scopeAgents) {
      const mgr = a.reportsTo != null ? userById.get(a.reportsTo) : null;
      if (mgr && mgr.role === "Center Head") directHeadIds.add(mgr.id);
    }
    const heads = Array.from(directHeadIds)
      .filter((id) => headFilter === "All" || id === headFilter)
      .map((id) => userById.get(id))
      .filter(Boolean)
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
    return [...heads, ...tls];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tlPool, headFilter, centerFilter, trackingBase, userById]);

  // Safeguard for the TL filter — if the chosen TL leaves scope, reset to All.
  useEffect(() => {
    if (tlFilter !== "All" && !tlOptions.some((t: any) => t.id === tlFilter)) {
      setTlFilter("All");
    }
  }, [tlFilter, tlOptions]);

  // Per-TL roll-up for the TL cards grid: agent count + SUM of each agent's metrics
  // (Sales FD, DC, Prospect Count) for the selected date. Sales MTD is intentionally
  // NOT summed here — each agent's MTD is already a running month-to-date figure they
  // fill in daily, so adding them across a team inflates the number. It stays per-agent
  // (visible only when you drill into a TL). Uses the same center / head / status scope
  // as the table (minus the TL filter) so each card's numbers match what opens when you
  // click into that TL.
  const tlAgg = useMemo(() => {
    // Window view (range or all-dates): use the per-agent roll-up (DC/Prospect/Sales FD
    // already summed across every in-window date) so each TL card reflects the whole
    // period, not one day.
    const metricByAgent = !trackIsSingleDay ? aggregateMetricsByAgent(trackMetrics) : new Map<number, any>();
    if (trackIsSingleDay) for (const m of trackMetrics) metricByAgent.set(m.agentId, m);
    const scoped = displayBase.filter((u) =>
      (centerFilter === "All" || u.center === centerFilter) &&
      (deptFilter === "All" || u.department === deptFilter) &&
      (headFilter === "All" || headAncestorId(u.id) === headFilter) &&
      (statusFilter === "All" || (u.status ?? "Active") === statusFilter)
    );
    const map = new Map<number, { agents: number; salesFd: number; dc: number; prospectCount: number }>();
    for (const a of scoped) {
      if (a.reportsTo == null) continue;
      const cur = map.get(a.reportsTo) ?? { agents: 0, salesFd: 0, dc: 0, prospectCount: 0 };
      cur.agents += 1;
      const m = metricByAgent.get(a.id);
      if (m) {
        cur.salesFd += Number(m.salesFd) || 0;
        cur.dc += Number(m.dc) || 0;
        cur.prospectCount += Number(m.prospectCount) || 0;
      }
      map.set(a.reportsTo, cur);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayBase, centerFilter, deptFilter, headFilter, statusFilter, trackMetrics, trackIsSingleDay]);

  // Per-user task stats
  const userStats = useMemo(() => {
    const map = new Map<number, { done: number; inProgress: number; pending: number; total: number }>();
    for (const u of allUsers) map.set(u.id, { done: 0, inProgress: 0, pending: 0, total: 0 });
    for (const t of allTasks) {
      if (!t.assignedTo) continue;
      const s = map.get(t.assignedTo);
      if (!s) continue;
      s.total++;
      if (t.status === "done") s.done++;
      else if (t.status === "inProgress") s.inProgress++;
      else s.pending++;
    }
    return map;
  }, [allUsers, allTasks]);

  const handleDelete = (id: number, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    deleteUser.mutate({ id }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
        qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
      },
    });
  };

  const openAddAgent = () => {
    const realCenters = ["Thane Center", "Malad Center", "Pune Center", "Navi Mumbai Center"];
    const def = isTeamLeader
      ? myCenter && myCenter !== "Head Office"
        ? myCenter
        : "Thane Center"
      : realCenters.includes(centerFilter)
      ? centerFilter
      : myCenter && myCenter !== "Head Office"
      ? myCenter
      : "Thane Center";
    setAgentError("");
    setAgentForm({ name: "", email: "", doj: "", center: def, reportsTo: isTeamLeader ? String(currentUser.id) : "", status: "Active", role: "Sales Agent", username: "", password: "" });
    setShowAddAgent((v) => !v);
  };

  const handleAddAgent = (e: React.FormEvent) => {
    e.preventDefault();
    setAgentError("");
    const isTL = agentForm.role === "Team Leader";
    if (!agentForm.name.trim()) {
      setAgentError("Name is required");
      return;
    }
    if (!agentForm.reportsTo) {
      setAgentError(isTL ? "Please select the Center Head this TL reports to" : "Please select a TL or Center Head this agent reports to");
      return;
    }
    if (isTL && (!agentForm.username.trim() || !agentForm.password.trim())) {
      setAgentError("Username and password are required for a Team Leader");
      return;
    }
    const center = agentForm.center.trim() || "Thane Center";
    const reportsTo = Number(agentForm.reportsTo);
    // Sales Agents have NO login (username/password null); only Team Leaders, who
    // actually use the app, are created with credentials.
    createUser.mutate(
      {
        data: {
          name: agentForm.name.trim(),
          role: isTL ? "Team Leader" : "Sales Agent",
          username: isTL ? agentForm.username.trim() : null,
          password: isTL ? agentForm.password : null,
          department: "Sales",
          center,
          reportsTo,
          email: agentForm.email.trim() || null,
          doj: agentForm.doj || null,
          status: agentForm.status as "Active" | "Inactive",
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
          setShowAddAgent(false);
          setAgentForm({ name: "", email: "", doj: "", center, reportsTo: "", status: "Active", role: "Sales Agent", username: "", password: "" });
        },
        onError: () => setAgentError(isTL ? "Could not add (username may already be taken)" : "Could not add agent"),
      }
    );
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setAddError("");
    if (!addForm.name || !addForm.username || !addForm.password || !addForm.role) {
      setAddError("Name, username, password and role are required");
      return;
    }
    const center = (() => {
      const v = addForm.center.trim() || "Head Office";
      return isMis && v === "Head Office" ? "Thane Center" : v;
    })();
    createUser.mutate(
      { data: { name: addForm.name, role: addForm.role, username: addForm.username, password: addForm.password, department: addForm.department, center, reportsTo: currentUser.id, email: addForm.email || null } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
          setShowAddForm(false);
          setAddForm({ name: "", role: "", username: "", password: "", department: "Accounts", center: isMis ? "Thane Center" : "Head Office", email: "" });
        },
        onError: () => setAddError("Username already exists"),
      }
    );
  };

  // If a member is selected → show detail view
  if (selectedMember) {
    return (
      <MemberDetail
        member={selectedMember}
        allTasks={allTasks}
        onBack={() => setSelectedMember(null)}
        isMis={isMis}
      />
    );
  }

  return (
    <div className="p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-extrabold text-foreground">My Team</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {view === "tracking"
              ? tlFilter === "All"
                ? `${tlOptions.length} team leader${tlOptions.length === 1 ? "" : "s"} · click one to see their agents`
                : `${filtered.length} agent${filtered.length === 1 ? "" : "s"} in this team`
              : filtered.length > 0
              ? `${filtered.length} team leader${filtered.length === 1 ? "" : "s"} in your team`
              : `No team leaders`}
            {view === "tracking" ? "" : " · Click a card to see full details"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canSeeTracking && (
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button onClick={() => { setView("cards"); setHeadFilter("All"); setTlFilter("All"); }}
                className={`px-3 py-1.5 text-xs font-semibold transition ${view === "cards" ? "bg-primary text-white" : "bg-card text-muted-foreground hover:bg-muted"}`}>
                Cards
              </button>
              <button onClick={() => { setView("tracking"); setShowAddForm(false); setHeadFilter("All"); setTlFilter("All"); if (centerFilter === "Head Office") { setCenterFilter("All"); setDeptFilter("All"); } }}
                className={`px-3 py-1.5 text-xs font-semibold transition ${view === "tracking" ? "bg-primary text-white" : "bg-card text-muted-foreground hover:bg-muted"}`}>
                Agent Tracking
              </button>
            </div>
          )}
          {view === "tracking" && (
            <button onClick={downloadAgentTracking} disabled={filtered.length === 0}
              title="Download agent data (CSV)"
              className="px-3 py-1.5 bg-card border border-border text-foreground text-xs font-semibold rounded-lg hover:bg-muted transition disabled:opacity-50 disabled:cursor-not-allowed">
              ⬇ Download
            </button>
          )}
          {view === "tracking" && (
            <button onClick={openAddAgent}
              className="px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 transition">
              + Add Agent
            </button>
          )}
          {view === "cards" && (
            <button onClick={() => { setShowAddForm((v) => { const next = !v; if (next && myCenter) setAddForm((f) => ({ ...f, center: myCenter })); return next; }); }}
              className="px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 transition">
              + Add Member
            </button>
          )}
        </div>
      </div>

      {/* Center tabs (shown when more than one center exists) */}
      {centerOptions.length > 1 && (
        <div className="flex gap-1.5 mb-3 flex-wrap items-center">
          <span className="text-xs font-bold text-muted-foreground mr-1">🏢 Center</span>
          {centerOptions.map((c) => (
            <button key={c} onClick={() => { setCenterFilter(c); setDeptFilter("All"); setHeadFilter("All"); setTlFilter("All"); }}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition ${centerFilter === c ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted"}`}>
              {c === "All" ? "All Centers" : c}
            </button>
          ))}
        </div>
      )}

      {/* Dept tabs (Cards view only) */}
      {view === "cards" && (
        <div className="flex gap-1.5 mb-4 flex-wrap">
          {DEPTS.map((d) => (
            <button key={d} onClick={() => setDeptFilter(d)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition ${deptFilter === d ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted"}`}>
              {d}
            </button>
          ))}
        </div>
      )}

      {/* Center Head filter (Agent Tracking view only) — pick a head to see its TLs / agents */}
      {view === "tracking" && headOptions.length > 1 && (
        <div className="flex gap-1.5 mb-4 flex-wrap items-center">
          <span className="text-xs font-bold text-muted-foreground mr-1">👤 Center Head</span>
          <button onClick={() => { setHeadFilter("All"); setTlFilter("All"); }}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition ${headFilter === "All" ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted"}`}>
            All Heads
          </button>
          {headOptions.map((h: any) => (
            <button key={h.id} onClick={() => { setHeadFilter(h.id); setTlFilter("All"); }}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition ${headFilter === h.id ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted"}`}>
              {h.name}
            </button>
          ))}
        </div>
      )}

      {/* Team Leader filter (Agent Tracking view) — shown once a TL is selected, as a quick switcher;
          the TL cards are the primary picker, so "All TLs" here returns to the cards. */}
      {view === "tracking" && tlFilter !== "All" && (
        <div className="flex gap-1.5 mb-4 flex-wrap items-center">
          <span className="text-xs font-bold text-muted-foreground mr-1">🧑‍💼 Team Leader</span>
          <button onClick={() => setTlFilter("All")}
            className="px-3 py-1 rounded-full text-xs font-semibold transition bg-muted text-muted-foreground hover:bg-muted">
            ← All TLs
          </button>
          {tlOptions.map((t: any) => (
            <button key={t.id} onClick={() => setTlFilter(t.id)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition ${tlFilter === t.id ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted"}`}>
              {t.name}{t.role === "Center Head" ? " (Center Head)" : ""}
            </button>
          ))}
        </div>
      )}

      {/* Status filter (Agent Tracking view only) */}
      {view === "tracking" && (
        <div className="flex gap-1.5 mb-4 flex-wrap items-center">
          <span className="text-xs font-bold text-muted-foreground mr-1">🟢 Status</span>
          {(["Active", "Inactive", "All"] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition ${statusFilter === s ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted"}`}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Date filter (Agent Tracking view only) — drives the metrics & attendance shown.
          A single day is editable; a range or "All time" shows a read-only roll-up. */}
      {view === "tracking" && (
        <div className="flex gap-1.5 mb-4 flex-wrap items-center">
          <span className="text-xs font-bold text-muted-foreground mr-1">📅 Date</span>
          <DateRangePicker
            disableFuture
            label="Date"
            from={trackFrom}
            to={trackTo}
            onApply={({ from, to }) => { setTrackFrom(from); setTrackTo(to); }}
          />
        </div>
      )}

      {/* Add Agent form (Agent Tracking view) */}
      {view === "tracking" && showAddAgent && (
        <div className="mb-4 bg-card rounded-xl border border-border shadow-sm p-4">
          <div className="font-semibold text-foreground text-sm mb-3">{agentForm.role === "Team Leader" ? "New Team Leader" : "New Agent"}</div>
          {agentError && <div className="mb-2 text-xs text-red-600 dark:text-red-300">{agentError}</div>}
          <form onSubmit={handleAddAgent} className="grid grid-cols-3 gap-2.5">
            <select value={agentForm.role} onChange={(e) => setAgentForm((f) => ({ ...f, role: e.target.value, reportsTo: "" }))} disabled={isTeamLeader} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60">
              <option value="Sales Agent">Sales Agent</option>
              {!isTeamLeader && <option value="Team Leader">Team Leader</option>}
            </select>
            <input placeholder="Full Name *" value={agentForm.name} onChange={(e) => setAgentForm((f) => ({ ...f, name: e.target.value }))} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            <input type="email" placeholder="Email" value={agentForm.email} onChange={(e) => setAgentForm((f) => ({ ...f, email: e.target.value }))} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            <input type="date" placeholder="DOJ" value={agentForm.doj} onChange={(e) => setAgentForm((f) => ({ ...f, doj: e.target.value }))} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            <select value={agentForm.center} onChange={(e) => setAgentForm((f) => ({ ...f, center: e.target.value, reportsTo: "" }))} disabled={isTeamLeader} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60">
              {(isTeamLeader ? [agentForm.center] : CENTERS.filter((c) => c !== "Head Office")).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={agentForm.reportsTo} onChange={(e) => setAgentForm((f) => ({ ...f, reportsTo: e.target.value }))} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">{agentForm.role === "Team Leader" ? "— Reports to (Center Head) —" : "— Reports to (TL / Head) —"}</option>
              {agentFormManagers
                .filter((m) => (agentForm.role === "Team Leader" ? m.role === "Center Head" : true))
                .filter((m) => !isTeamLeader || hierarchyIds.has(m.id))
                .map((m) => <option key={m.id} value={String(m.id)}>{m.name} ({m.role === "Center Head" ? "Head" : "TL"})</option>)}
            </select>
            <select value={agentForm.status} onChange={(e) => setAgentForm((f) => ({ ...f, status: e.target.value }))} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
            {agentForm.role === "Team Leader" && (
              <>
                <input placeholder="Username *" value={agentForm.username} onChange={(e) => setAgentForm((f) => ({ ...f, username: e.target.value }))} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                <input type="password" placeholder="Password *" value={agentForm.password} onChange={(e) => setAgentForm((f) => ({ ...f, password: e.target.value }))} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </>
            )}
            <div className="flex gap-2 col-span-3">
              <button type="submit" disabled={createUser.isPending} className="px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-60">
                {createUser.isPending ? "Adding..." : agentForm.role === "Team Leader" ? "Add Team Leader" : "Add Agent"}
              </button>
              <button type="button" onClick={() => setShowAddAgent(false)} className="px-4 py-2 bg-muted text-foreground text-xs font-semibold rounded-lg hover:bg-muted">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Add form */}
      {showAddForm && view === "cards" && (
        <div className="mb-4 bg-card rounded-xl border border-border shadow-sm p-4">
          <div className="font-semibold text-foreground text-sm mb-3">New Team Member (will report to you)</div>
          {addError && <div className="mb-2 text-xs text-red-600 dark:text-red-300">{addError}</div>}
          <form onSubmit={handleAdd} className="grid grid-cols-3 gap-2.5">
            <input placeholder="Full Name *" value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            <input placeholder="Role *" value={addForm.role} onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value }))} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            <input placeholder="Username *" value={addForm.username} onChange={(e) => setAddForm((f) => ({ ...f, username: e.target.value }))} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            <input type="password" placeholder="Password *" value={addForm.password} onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            <input type="email" placeholder="Email" value={addForm.email} onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            <select value={addForm.department} onChange={(e) => setAddForm((f) => ({ ...f, department: e.target.value }))} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              {["Management","Operations","Accounts","MIS","Director","HR","IT"].map((d) => <option key={d}>{d}</option>)}
            </select>
            <input list="center-options" placeholder="Center (e.g. Head Office)" value={addForm.center} onChange={(e) => setAddForm((f) => ({ ...f, center: e.target.value }))} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            <datalist id="center-options">
              {CENTERS.map((c) => <option key={c} value={c} />)}
            </datalist>
            <div className="flex gap-2 col-span-3">
              <button type="submit" disabled={createUser.isPending} className="px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-60">
                {createUser.isPending ? "Adding..." : "Add Member"}
              </button>
              <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 bg-muted text-foreground text-xs font-semibold rounded-lg hover:bg-muted">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Agent tracking: TL cards first, then drill into one TL's agents */}
      {view === "tracking" ? (
        tlFilter === "All" ? (
          isLoading ? (
            <div className="grid grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-40 bg-muted rounded-xl animate-pulse" />)}
            </div>
          ) : tlOptions.length === 0 ? (
            <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
              No team leaders for this filter
            </div>
          ) : (
            <div className="bg-card rounded-xl border border-border overflow-x-auto">
              <table className="text-sm border-collapse">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-bold text-muted-foreground whitespace-nowrap border-b border-border">TL Name</th>
                    <th className="px-3 py-2 text-left font-bold text-muted-foreground whitespace-nowrap border-b border-border">Role</th>
                    <th className="px-3 py-2 text-left font-bold text-muted-foreground whitespace-nowrap border-b border-border">Center</th>
                    <th className="px-3 py-2 text-right font-bold text-muted-foreground whitespace-nowrap border-b border-border">{statusFilter === "All" ? "Agents" : `${statusFilter} Agents`}</th>
                    <th className="px-3 py-2 text-right font-bold text-muted-foreground whitespace-nowrap border-b border-border">Sales FD</th>
                    <th className="px-3 py-2 text-right font-bold text-muted-foreground whitespace-nowrap border-b border-border">DC</th>
                    <th className="px-3 py-2 text-right font-bold text-muted-foreground whitespace-nowrap border-b border-border">Prospect Count</th>
                    <th className="px-3 py-2 text-right font-bold text-muted-foreground whitespace-nowrap border-b border-border"><span className="sr-only">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {tlOptions.map((t: any) => {
                    const agg = tlAgg.get(t.id) ?? { agents: 0, salesFd: 0, dc: 0, prospectCount: 0 };
                    const isHead = t.role === "Center Head";
                    return (
                      <tr key={t.id} onClick={() => setTlFilter(t.id)}
                        role="button" tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTlFilter(t.id); } }}
                        className="hover:bg-muted/30 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                        <td className="px-3 py-2 whitespace-nowrap border-b border-border">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-extrabold text-sm shrink-0" style={{ background: isHead ? "#0ea5e9" : "#6366f1" }}>
                              {t.name[0]}
                            </div>
                            <span className="font-semibold text-foreground">{t.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap border-b border-border text-muted-foreground">{isHead ? "Center Head" : "Team Leader"}</td>
                        <td className="px-3 py-2 whitespace-nowrap border-b border-border text-muted-foreground">{t.center ?? "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap border-b border-border text-right font-black text-primary">{agg.agents}</td>
                        <td className="px-3 py-2 whitespace-nowrap border-b border-border text-right font-bold text-foreground">{agg.salesFd}</td>
                        <td className="px-3 py-2 whitespace-nowrap border-b border-border text-right font-bold text-foreground">{agg.dc}</td>
                        <td className="px-3 py-2 whitespace-nowrap border-b border-border text-right font-bold text-foreground">{agg.prospectCount}</td>
                        <td className="px-3 py-2 whitespace-nowrap border-b border-border text-right text-xs text-primary font-semibold">View team →</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <>
            <div className="mb-3 text-sm font-bold text-foreground">
              {(() => {
                const t = tlOptions.find((x: any) => x.id === tlFilter) ?? userById.get(tlFilter as number);
                return t ? `${t.name}'s Team` : "Team";
              })()}
            </div>
            <AgentTrackingTable
              agents={filtered}
              allUsers={allUsers}
              tlPool={tlPool}
              headPool={headPool}
              currentUser={currentUser}
              from={trackFrom}
              to={trackTo}
              onRemove={handleDelete}
            />
          </>
        )
      ) : isLoading ? (
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-52 bg-muted rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
          No members for this filter
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {filtered.map((user) => {
            const stats = userStats.get(user.id) ?? { done: 0, inProgress: 0, pending: 0, total: 0 };
            const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
            const avatarColor = DEPT_COLORS[user.department] ?? "#6366f1";

            return (
              <div key={user.id}
                className="bg-card rounded-xl border border-border shadow-sm hover:shadow-md hover:border-primary/30 transition-all cursor-pointer"
                onClick={() => setSelectedMember(user)}>
                {/* Card header */}
                <div className="p-4 pb-3">
                  <div className="flex items-start gap-2.5 mb-3">
                    <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-extrabold text-base shrink-0 shadow-sm" style={{ background: avatarColor }}>
                      {user.name[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm text-foreground leading-tight">{user.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{user.role}</div>
                      <span className={`inline-flex mt-1 px-2 py-0.5 rounded-full text-xs font-semibold ${DEPT_BG[user.department] ?? "bg-muted text-muted-foreground"}`}>
                        {user.department}
                      </span>
                    </div>
                  </div>

                  {/* 3 stat boxes */}
                  <div className="grid grid-cols-3 gap-1.5 mb-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => { setSelectedMember(user); }}
                      className="rounded-lg p-2 text-center bg-green-50 border border-green-200 hover:bg-green-100 hover:border-green-400 dark:bg-green-950/40 dark:border-green-800 dark:hover:bg-green-900/40 dark:hover:border-green-600 transition cursor-pointer">
                      <div className="text-xl font-black text-green-600 dark:text-green-300">{stats.done}</div>
                      <div className="text-xs text-green-600 dark:text-green-300 font-semibold">Done</div>
                    </button>
                    <button
                      onClick={() => { setSelectedMember(user); }}
                      className="rounded-lg p-2 text-center bg-amber-50 border border-amber-200 hover:bg-amber-100 hover:border-amber-400 dark:bg-amber-950/40 dark:border-amber-800 dark:hover:bg-amber-900/40 dark:hover:border-amber-600 transition cursor-pointer">
                      <div className="text-xl font-black text-amber-600 dark:text-amber-300">{stats.inProgress}</div>
                      <div className="text-xs text-amber-600 dark:text-amber-300 font-semibold">In Prog</div>
                    </button>
                    <button
                      onClick={() => { setSelectedMember(user); }}
                      className="rounded-lg p-2 text-center bg-red-50 border border-red-200 hover:bg-red-100 hover:border-red-400 dark:bg-red-950/40 dark:border-red-800 dark:hover:bg-red-900/40 dark:hover:border-red-600 transition cursor-pointer">
                      <div className="text-xl font-black text-red-600 dark:text-red-300">{stats.pending}</div>
                      <div className="text-xs text-red-600 dark:text-red-300 font-semibold">Pending</div>
                    </button>
                  </div>
                </div>

                {/* Card footer */}
                <div className="px-4 pb-4 border-t border-border pt-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Completion</span>
                    <span className={`font-bold ${pct >= 50 ? "text-green-600 dark:text-green-300" : pct > 0 ? "text-amber-500 dark:text-amber-400" : "text-red-500 dark:text-red-400"}`}>{pct}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 50 ? "#10b981" : pct > 0 ? "#f59e0b" : "#ef4444" }} />
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-muted-foreground">{stats.total} tasks</span>
                    <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => setSelectedMember(user)}
                        className="text-xs text-primary hover:text-primary font-semibold">View</button>
                      <span className="text-muted-foreground">|</span>
                      <button onClick={() => handleDelete(user.id, user.name)}
                        className="text-xs text-red-400 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300">Delete</button>
                    </div>
                  </div>
                  {user.email && <div className="text-xs text-muted-foreground mt-1 truncate">✉ {user.email}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
