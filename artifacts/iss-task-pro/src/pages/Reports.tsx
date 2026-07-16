import { useState, useMemo, useEffect } from "react";
import { useListTasks, useListUsers, useGetEmailSettings, useSendReport, getListTasksQueryKey, getListUsersQueryKey, getGetEmailSettingsQueryKey } from "@workspace/api-client-react";
import { buildHierarchySet, isAllCentersViewer, resolveAllowedCenters } from "@/lib/utils";
import { DateRangePicker } from "@/components/DateRangePicker";

const CATEGORIES = ["All", "Work", "Meeting", "Admin", "Other", "Follow-up", "Accounts", "HR", "IT", "MIS", "Finance"];

function pad(n: number) { return String(n).padStart(2, "0"); }

function monthLabel(y: number, m: number) {
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString("en-IN", { month: "long", year: "numeric" });
}

function toYearMonth(y: number, m: number) { return `${y}-${pad(m)}`; }

interface ReportsProps {
  currentUser?: { id: number; name: string; role: string; department: string } | null;
}

export default function Reports({ currentUser }: ReportsProps) {
  const now = new Date();
  const [filterType, setFilterType] = useState<"month" | "range">("month");
  const [selYear, setSelYear] = useState(now.getFullYear());
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [centerFilter, setCenterFilter] = useState("All");
  const [deptFilter, setDeptFilter] = useState("All");
  const [memberFilter, setMemberFilter] = useState<number | "all">("all");
  const [catFilter, setCatFilter] = useState("All");
  const [sendResult, setSendResult] = useState("");
  const [recipient, setRecipient] = useState("");

  const isBoss = !!currentUser && (currentUser.department === "Management" || currentUser.role === "Boss");
  const isMis = isAllCentersViewer(currentUser);
  // Real MIS department only (excludes Director, who shares MIS's outer-centers
  // view but must NOT see MIS's own Head-Office data).
  const isMisDept = currentUser?.department === "MIS";
  const isCenterHead = !!currentUser && currentUser.role === "Center Head";
  // Boss & MIS see every center; a Center Head sees their whole center;
  // everyone else sees only their own org subtree.
  const seesAll = isBoss || isMis;

  const { data: allTasks = [] } = useListTasks({}, { query: { queryKey: getListTasksQueryKey({}) } });
  const { data: allUsers = [] } = useListUsers({ query: { queryKey: getListUsersQueryKey() } });
  const { data: emailSettings } = useGetEmailSettings({ query: { enabled: isBoss, queryKey: getGetEmailSettingsQueryKey() } });
  const sendReport = useSendReport();

  // ── Center / hierarchy scoping ─────────────────────────────────
  // A task's center is taken from its assignee (tasks have no center column).
  const userCenter = useMemo(() => new Map(allUsers.map((u) => [u.id, u.center])), [allUsers]);
  const myCenter = useMemo(() => allUsers.find((u) => u.id === currentUser?.id)?.center ?? null, [allUsers, currentUser]);
  const allowedIds = useMemo(
    () => (currentUser ? buildHierarchySet(currentUser.id, allUsers) : new Set<number>()),
    [currentUser, allUsers]
  );

  // Boss & MIS see every center (including Head Office). Everyone else (used only
  // when scopeBase happens to be referenced for non-seesAll viewers) falls back to
  // the outer centers. Per-user center restriction (Boss/MIS only). null = none.
  const me = useMemo(() => allUsers.find((u) => u.id === currentUser?.id) ?? null, [allUsers, currentUser]);
  const allowedCenters = useMemo(() => resolveAllowedCenters(me, allUsers), [me, allUsers]);
  const scopeBase = useMemo(() => {
    let base = (isBoss || isMis) ? allUsers : allUsers.filter((u) => (u.center && u.center !== "Head Office") || (isMisDept && u.department === "MIS"));
    if (allowedCenters) base = base.filter((u) => u.center && allowedCenters.has(u.center));
    return base;
  }, [isBoss, isMis, allUsers, isMisDept, allowedCenters]);
  const scopeBaseIds = useMemo(() => new Set(scopeBase.map((u) => u.id)), [scopeBase]);

  // Center filter pills (boss/MIS only) — Head Office first, then display order
  const centerOptions = useMemo(() => {
    const set = new Set(scopeBase.map((u) => u.center).filter((c): c is string => Boolean(c)));
    const order = ["Head Office", "Thane Center", "Malad Center", "Pune Center", "Navi Mumbai Center"];
    const rank = (c: string) => { const i = order.indexOf(c); return i === -1 ? order.length : i; };
    return ["All", ...Array.from(set).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))];
  }, [scopeBase]);

  // Users in scope (drive the Member / Department filters)
  const users = useMemo(() => {
    if (seesAll) return centerFilter === "All" ? scopeBase : scopeBase.filter((u) => u.center === centerFilter);
    if (isCenterHead) return allUsers.filter((u) => u.center === myCenter);
    return allUsers.filter((u) => allowedIds.has(u.id));
  }, [seesAll, centerFilter, isCenterHead, myCenter, allowedIds, allUsers, scopeBase]);

  // Tasks in scope
  const scopedTasks = useMemo(() => {
    let base;
    if (seesAll)
      // A restricted boss (custom center set) is scoped to their allowed centers
      // via scopeBaseIds, exactly like MIS; an unrestricted boss still sees all.
      base = (isBoss && !allowedCenters) ? allTasks : allTasks.filter((t) => t.assignedTo != null && scopeBaseIds.has(t.assignedTo));
    else if (isCenterHead)
      base = allTasks.filter(
        (t) => (t.assignedTo != null && userCenter.get(t.assignedTo) === myCenter) || t.assignedBy === currentUser?.id
      );
    else
      base = allTasks.filter(
        (t) => (t.assignedTo != null && allowedIds.has(t.assignedTo)) || t.assignedBy === currentUser?.id
      );
    if (seesAll && centerFilter !== "All")
      base = base.filter((t) => t.assignedTo != null && userCenter.get(t.assignedTo) === centerFilter);
    return base;
  }, [allTasks, seesAll, isBoss, scopeBaseIds, isCenterHead, myCenter, allowedIds, currentUser?.id, userCenter, centerFilter, allowedCenters]);

  // Department options derived from the scoped users
  const DEPT_OPTIONS = useMemo(() => {
    const ALL = ["Management", "Operations", "Accounts", "MIS", "HR", "IT"];
    const set = new Set(users.map((u) => u.department).filter(Boolean));
    const present = ALL.filter((d) => set.has(d));
    for (const d of set) if (!ALL.includes(d as string)) present.push(d as string);
    return ["All", ...present];
  }, [users]);

  // Prefill recipient with the configured sender email so the boss can send
  // to themselves in one click; still fully editable.
  useEffect(() => {
    if (!recipient && emailSettings?.smtpEmail) setRecipient(emailSettings.smtpEmail);
  }, [emailSettings?.smtpEmail]);

  // Month options: last 24 months
  const monthOptions = useMemo(() => {
    const opts: { label: string; year: number; month: number }[] = [];
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      opts.push({ label: monthLabel(d.getFullYear(), d.getMonth() + 1), year: d.getFullYear(), month: d.getMonth() + 1 });
    }
    return opts;
  }, []);

  // Members for filter — only people with a login (Sales Agents have no username and
  // are tracked in the Team page, so they are excluded from this member filter).
  const loginUsers = users.filter((u) => !!u.username);
  const visibleMembers = deptFilter === "All" ? loginUsers : loginUsers.filter((u) => u.department === deptFilter);

  // Filter tasks
  const tasks = useMemo(() => {
    let t = scopedTasks;
    // Date filter
    if (filterType === "month") {
      const prefix = toYearMonth(selYear, selMonth);
      t = t.filter((x) => (x.createdAt ?? "").startsWith(prefix));
    } else {
      if (rangeFrom) t = t.filter((x) => (x.createdAt ?? "") >= rangeFrom);
      if (rangeTo) t = t.filter((x) => (x.createdAt ?? "") <= rangeTo + "T23:59:59");
    }
    if (deptFilter !== "All") t = t.filter((x) => x.department === deptFilter);
    if (memberFilter !== "all") t = t.filter((x) => x.assignedTo === memberFilter);
    if (catFilter !== "All") t = t.filter((x) => (x.category ?? "Other") === catFilter);
    return t;
  }, [scopedTasks, filterType, selYear, selMonth, rangeFrom, rangeTo, deptFilter, memberFilter, catFilter]);

  // KPIs
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const inProgress = tasks.filter((t) => t.status === "inProgress").length;
  const pending = tasks.filter((t) => t.status === "pending").length;
  const doneRate = total > 0 ? Math.round((done / total) * 100) : 0;

  // Task type breakdown
  const typeBreakdown = useMemo(() => {
    const types = ["daily", "weekly", "monthly", "one_time"];
    return types.map((type) => {
      const tt = tasks.filter((t) => t.type === type);
      const d = tt.filter((t) => t.status === "done").length;
      const ip = tt.filter((t) => t.status === "inProgress").length;
      const p = tt.filter((t) => t.status === "pending").length;
      const rate = tt.length > 0 ? Math.round((d / tt.length) * 100) : 0;
      return { type: type.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()), total: tt.length, done: d, inProgress: ip, pending: p, rate };
    });
  }, [tasks]);

  // Category breakdown
  const categoryBreakdown = useMemo(() => {
    const catMap = new Map<string, { total: number; done: number; inProgress: number; pending: number }>();
    for (const t of tasks) {
      const cat = t.category ?? "Other";
      if (!catMap.has(cat)) catMap.set(cat, { total: 0, done: 0, inProgress: 0, pending: 0 });
      const s = catMap.get(cat)!;
      s.total++;
      if (t.status === "done") s.done++;
      else if (t.status === "inProgress") s.inProgress++;
      else s.pending++;
    }
    return Array.from(catMap.entries())
      .map(([cat, s]) => ({ cat, ...s, rate: Math.round((s.done / s.total) * 100) }))
      .sort((a, b) => b.total - a.total);
  }, [tasks]);

  // Per-member breakdown
  const memberBreakdown = useMemo(() => {
    return visibleMembers
      .map((u) => {
        const ut = tasks.filter((t) => t.assignedTo === u.id);
        const d = ut.filter((t) => t.status === "done").length;
        const ip = ut.filter((t) => t.status === "inProgress").length;
        const p = ut.filter((t) => t.status === "pending").length;
        const rate = ut.length > 0 ? Math.round((d / ut.length) * 100) : 0;
        return { name: u.name.split(" ")[0], dept: u.department, total: ut.length, done: d, inProgress: ip, pending: p, rate };
      })
      .filter((r) => r.total > 0);
  }, [tasks, visibleMembers]);

  // Download CSV
  const handleDownload = () => {
    const headers = ["Title", "Assigned To", "Department", "Category", "Priority", "Type", "Status", "Remark", "Due Date", "Created At"];
    const rows = tasks.map((t) => [
      `"${t.title}"`,
      t.assignedToName ?? "",
      t.department ?? "",
      t.category ?? "",
      t.priority,
      t.type,
      t.status,
      `"${(t.remark ?? "").replace(/"/g, '""')}"`,
      t.dueDate ?? "",
      (t.createdAt ?? "").split("T")[0],
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `iss-tasks-${filterType === "month" ? toYearMonth(selYear, selMonth) : "custom"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSendEmail = () => {
    setSendResult("");
    const to = recipient.trim();
    if (!to) { setSendResult("Please enter a recipient email"); return; }
    sendReport.mutate(
      { data: { type: "monthly", toEmail: to } },
      { onSuccess: (r) => setSendResult(r.message), onError: () => setSendResult("Failed to send report email") }
    );
  };

  return (
    <div className="p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-extrabold text-foreground flex items-center gap-2">📊 Reports &amp; Download</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Filter by date, download CSV</p>
        </div>
        <div className="flex gap-2 items-center">
          {isBoss && (
            <>
              <input
                type="email"
                data-testid="input-report-recipient"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Recipient email"
                className="px-3 py-2 border border-border rounded-lg text-xs w-56 focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                data-testid="btn-send-report"
                onClick={handleSendEmail}
                disabled={sendReport.isPending || !emailSettings?.configured}
                title={!emailSettings?.configured ? "Configure email settings first" : ""}
                className="px-3 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 transition flex items-center gap-1.5"
              >
                {sendReport.isPending ? "Sending..." : "✉ Send Email"}
              </button>
            </>
          )}
          <button
            data-testid="btn-download-csv"
            onClick={handleDownload}
            className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 transition flex items-center gap-1.5"
          >
            ⬇ Download CSV
          </button>
        </div>
      </div>

      {sendResult && (
        <div className="mb-3 px-4 py-2 bg-green-50 border border-green-200 rounded-lg text-green-700 dark:bg-green-950/40 dark:border-green-800 dark:text-green-300 text-xs font-medium">{sendResult}</div>
      )}

      {/* Filter Options */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-4 mb-4">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1">🔍 Filter Options</div>

        {/* Filter type toggle */}
        <div className="mb-3">
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">Filter Type</div>
          <div className="flex gap-2">
            <button onClick={() => setFilterType("month")} className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${filterType === "month" ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted"}`}>
              📅 By Month
            </button>
            <button onClick={() => setFilterType("range")} className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${filterType === "range" ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted"}`}>
              📆 Date Range
            </button>
          </div>
        </div>

        {filterType === "month" ? (
          <div className="mb-3">
            <div className="text-xs font-semibold text-muted-foreground mb-1.5">Select Month</div>
            <select
              data-testid="select-month"
              value={`${selYear}-${selMonth}`}
              onChange={(e) => { const [y, m] = e.target.value.split("-"); setSelYear(parseInt(y)); setSelMonth(parseInt(m)); }}
              className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {monthOptions.map((o) => (
                <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>{o.label}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex gap-3 mb-3">
            <DateRangePicker
              from={rangeFrom}
              to={rangeTo}
              onApply={({ from, to }) => {
                setRangeFrom(from);
                setRangeTo(to);
              }}
            />
          </div>
        )}

        {/* Center filter (boss & MIS) */}
        {seesAll && centerOptions.length > 1 && (
          <div className="mb-3">
            <div className="text-xs font-semibold text-muted-foreground mb-1.5">🏢 Center</div>
            <div className="flex gap-1.5 flex-wrap">
              {centerOptions.map((c) => (
                <button key={c} onClick={() => { setCenterFilter(c); setDeptFilter("All"); setMemberFilter("all"); }}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition ${centerFilter === c ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted"}`}>
                  {c === "All" ? "All Centers" : c}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Dept filter */}
        <div className="mb-3">
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">Department</div>
          <div className="flex gap-1.5 flex-wrap">
            {DEPT_OPTIONS.map((d) => (
              <button key={d} onClick={() => { setDeptFilter(d); setMemberFilter("all"); }}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition ${deptFilter === d ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted"}`}>
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* Member filter */}
        <div className="mb-3">
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">Member</div>
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => setMemberFilter("all")}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition ${memberFilter === "all" ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted"}`}>
              All
            </button>
            {visibleMembers.map((u) => (
              <button key={u.id} onClick={() => setMemberFilter(u.id)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition ${memberFilter === u.id ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted"}`}>
                {u.name.split(" ")[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Category filter */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">Category</div>
          <div className="flex gap-1.5 flex-wrap">
            {CATEGORIES.map((c) => (
              <button key={c} onClick={() => setCatFilter(c)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition ${catFilter === c ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted"}`}>
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-5 gap-3 mb-4">
        <div className="rounded-xl p-4 text-white" style={{ background: "#1e293b" }}>
          <div className="text-3xl font-black">{total}</div>
          <div className="text-xs font-semibold mt-1">✓ Total Tasks</div>
        </div>
        <div className="rounded-xl p-4 text-white bg-green-500">
          <div className="text-3xl font-black">{done}</div>
          <div className="text-xs font-semibold mt-1">✅ Done</div>
        </div>
        <div className="rounded-xl p-4 text-white bg-amber-500">
          <div className="text-3xl font-black">{inProgress}</div>
          <div className="text-xs font-semibold mt-1">⏱ In Progress</div>
        </div>
        <div className="rounded-xl p-4 text-white bg-red-500">
          <div className="text-3xl font-black">{pending}</div>
          <div className="text-xs font-semibold mt-1">⚠ Pending</div>
        </div>
        <div className="rounded-xl p-4 text-white bg-blue-600">
          <div className="text-3xl font-black">{doneRate}%</div>
          <div className="text-xs font-semibold mt-1">📊 Done Rate</div>
        </div>
      </div>

      {/* Task Type Breakdown */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-border">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">📋 Task Type Breakdown</div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-background border-b border-border">
              {["TYPE","TOTAL","✅ DONE","⏱ IN PROGRESS","⚠ PENDING","DONE %"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {typeBreakdown.map((row) => (
              <tr key={row.type} className="hover:bg-muted">
                <td className="px-4 py-3 font-semibold text-foreground capitalize">{row.type}</td>
                <td className="px-4 py-3 font-bold text-foreground">{row.total}</td>
                <td className="px-4 py-3"><span className="inline-flex items-center justify-center w-7 h-6 rounded bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 text-xs font-bold">{row.done}</span></td>
                <td className="px-4 py-3"><span className="inline-flex items-center justify-center w-7 h-6 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 text-xs font-bold">{row.inProgress}</span></td>
                <td className="px-4 py-3"><span className="inline-flex items-center justify-center w-7 h-6 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 text-xs font-bold">{row.pending}</span></td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden w-20">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${row.rate}%` }} />
                    </div>
                    <span className={`text-xs font-bold ${row.rate >= 50 ? "text-green-600 dark:text-green-300" : "text-red-500 dark:text-red-400"}`}>{row.rate}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Category Breakdown */}
      {categoryBreakdown.length > 0 && (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-border">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">🗂 Category Breakdown</div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-background border-b border-border">
                {["CATEGORY","TOTAL","✅ DONE","⏱ IN PROGRESS","⚠ PENDING","DONE %"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {categoryBreakdown.map((row) => (
                <tr key={row.cat} className="hover:bg-muted">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
                      {row.cat}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-bold text-foreground">{row.total}</td>
                  <td className="px-4 py-3"><span className="inline-flex items-center justify-center w-7 h-6 rounded bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 text-xs font-bold">{row.done}</span></td>
                  <td className="px-4 py-3"><span className="inline-flex items-center justify-center w-7 h-6 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 text-xs font-bold">{row.inProgress}</span></td>
                  <td className="px-4 py-3"><span className="inline-flex items-center justify-center w-7 h-6 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 text-xs font-bold">{row.pending}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden w-24">
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${row.rate}%`, background: row.rate >= 70 ? "#10b981" : row.rate >= 40 ? "#f59e0b" : "#ef4444" }} />
                      </div>
                      <span className={`text-xs font-bold ${row.rate >= 70 ? "text-green-600 dark:text-green-300" : row.rate >= 40 ? "text-amber-500 dark:text-amber-400" : "text-red-500 dark:text-red-400"}`}>
                        {row.rate}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Member breakdown */}
      {memberBreakdown.length > 0 && (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-border">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">👥 Team Member Breakdown</div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-background border-b border-border">
                {["MEMBER","DEPT","TOTAL","✅ DONE","⏱ IN PROG","⚠ PENDING","DONE %"].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {memberBreakdown.map((row) => (
                <tr key={row.name} className="hover:bg-muted">
                  <td className="px-4 py-2.5 font-semibold text-foreground">{row.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">{row.dept}</td>
                  <td className="px-4 py-2.5 font-bold">{row.total}</td>
                  <td className="px-4 py-2.5 text-green-600 dark:text-green-300 font-bold">{row.done}</td>
                  <td className="px-4 py-2.5 text-amber-600 dark:text-amber-300 font-bold">{row.inProgress}</td>
                  <td className="px-4 py-2.5 text-red-600 dark:text-red-300 font-bold">{row.pending}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${row.rate}%`, background: row.rate >= 50 ? "#10b981" : "#ef4444" }} />
                      </div>
                      <span className={`text-xs font-bold ${row.rate >= 50 ? "text-green-600 dark:text-green-300" : "text-red-500 dark:text-red-400"}`}>{row.rate}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Task list */}
      {tasks.length > 0 && (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tasks ({tasks.length})</div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-background border-b border-border">
                {["TASK","ASSIGNED TO","CATEGORY","PRIORITY","TYPE","STATUS","DUE"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tasks.slice(0, 50).map((t) => (
                <tr key={t.id} className="hover:bg-muted">
                  <td className="px-3 py-2.5 font-medium text-foreground max-w-[200px] truncate">{t.title}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{t.assignedToName ?? "—"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground text-xs">{t.category ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${t.priority === "high" || t.priority === "urgent" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" : t.priority === "medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"}`}>
                      {t.priority}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 capitalize text-muted-foreground text-xs">{String(t.type).replace("_", " ")}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${t.status === "done" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" : t.status === "inProgress" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" : "bg-muted text-muted-foreground"}`}>
                      {t.status === "inProgress" ? "In Progress" : t.status === "done" ? "Done" : "Pending"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground text-xs">{t.dueDate ? new Date(t.dueDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {tasks.length > 50 && <div className="px-4 py-2 text-xs text-muted-foreground border-t">Showing first 50 of {tasks.length} tasks — download CSV for full list</div>}
        </div>
      )}

      {tasks.length === 0 && (
        <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
          No tasks found for this filter
        </div>
      )}
    </div>
  );
}
