import { useState, useMemo } from "react";
import { useListTasks, useListUsers, getListTasksQueryKey, getListUsersQueryKey } from "@workspace/api-client-react";
import { DateRangePicker } from "@/components/DateRangePicker";
import { formatDate, isAllCentersViewer, resolveAllowedCenters } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = { pending: "Pending", inProgress: "In Progress", done: "Done" };
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground border-border",
  inProgress: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
  done: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800",
};

interface MonitorProps {
  currentUser?: { id: number; name: string; role: string; department: string } | null;
}

export default function AssignmentMonitor({ currentUser }: MonitorProps) {
  const isBoss = !!currentUser && (currentUser.department === "Management" || currentUser.role === "Boss");
  const isMis = isAllCentersViewer(currentUser);
  const isCenterHead = !!currentUser && currentUser.role === "Center Head";
  // Boss & MIS see every center; Center Heads are scoped to their own center.
  const seesAll = isBoss || isMis;
  const canView = seesAll || isCenterHead;

  const { data: allTasks = [] } = useListTasks({}, { query: { enabled: canView, queryKey: getListTasksQueryKey({}) } });
  const { data: users = [] } = useListUsers({ query: { enabled: canView, queryKey: getListUsersQueryKey() } });

  // userId → center map; a task's center is taken from its assignee/assigner (same rule as Dashboard).
  const userCenter = useMemo(() => new Map(users.map((u) => [u.id, u.center])), [users]);
  const myCenter = useMemo(() => users.find((u) => u.id === currentUser?.id)?.center ?? null, [users, currentUser]);
  // Per-user center restriction (Boss/MIS only). null = no restriction.
  const me = useMemo(() => users.find((u) => u.id === currentUser?.id) ?? null, [users, currentUser]);
  const allowedCenters = useMemo(() => resolveAllowedCenters(me, users), [me, users]);
  // Boss sees every center; MIS sees the four outer centers (never Head Office);
  // a Center Head only their own center. A custom set narrows this further.
  const scopedUsers = useMemo(() => {
    let base = isBoss
      ? users
      : isMis
        ? users.filter((u) => u.center && u.center !== "Head Office")
        : users.filter((u) => u.center === myCenter);
    if (allowedCenters) base = base.filter((u) => u.center && allowedCenters.has(u.center));
    return base;
  }, [isBoss, isMis, users, myCenter, allowedCenters]);

  const [centerFilter, setCenterFilter] = useState<string>("all");
  const [assignerFilter, setAssignerFilter] = useState<number | "all">("all");
  const [assigneeFilter, setAssigneeFilter] = useState<number | "all">("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");

  // Today's date in IST (matches how task dates are bucketed elsewhere).
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const isToday = fromDate === todayStr && toDate === todayStr;

  // Centers available across this user's scope (Head Office first, then display order)
  const centerOptions = useMemo(() => {
    const set = new Set(scopedUsers.map((u) => u.center).filter((c): c is string => Boolean(c)));
    const order = ["Head Office", "Thane Center", "Malad Center", "Pune Center", "Navi Mumbai Center"];
    const rank = (c: string) => { const i = order.indexOf(c); return i === -1 ? order.length : i; };
    return Array.from(set).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }, [scopedUsers]);

  // Assigner/assignee dropdowns are further narrowed to the selected center.
  const centerScopedUsers = useMemo(
    () => (centerFilter === "all" ? scopedUsers : scopedUsers.filter((u) => u.center === centerFilter)),
    [scopedUsers, centerFilter]
  );

  const assigners = useMemo(() => {
    const ids = new Set<number>();
    for (const t of allTasks) if (t.assignedBy != null) ids.add(t.assignedBy);
    return centerScopedUsers.filter((u) => ids.has(u.id));
  }, [allTasks, centerScopedUsers]);

  const rows = useMemo(() => {
    let t = allTasks.filter((x) => x.assignedBy != null && x.assignedTo != null);
    // Center Heads: only assignments fully within their center (BOTH assigner & assignee
    // in it) so no other center's people/tasks ever appear.
    if (!seesAll) {
      t = t.filter((x) => userCenter.get(x.assignedTo!) === myCenter && userCenter.get(x.assignedBy!) === myCenter);
    } else if (isMis) {
      // MIS: only assignments fully within the four outer centers — BOTH assigner
      // and assignee must be non-Head-Office so no Head Office identity ever shows.
      t = t.filter((x) => {
        const to = userCenter.get(x.assignedTo!);
        const by = userCenter.get(x.assignedBy!);
        return !!to && to !== "Head Office" && !!by && by !== "Head Office";
      });
    }
    // Custom center restriction (Boss/MIS): both ends must be in an allowed center.
    if (allowedCenters) {
      t = t.filter((x) => {
        const to = userCenter.get(x.assignedTo!);
        const by = userCenter.get(x.assignedBy!);
        return !!to && allowedCenters.has(to) && !!by && allowedCenters.has(by);
      });
    }
    if (centerFilter !== "all") t = t.filter((x) => userCenter.get(x.assignedTo!) === centerFilter);
    if (assignerFilter !== "all") t = t.filter((x) => x.assignedBy === assignerFilter);
    if (assigneeFilter !== "all") t = t.filter((x) => x.assignedTo === assigneeFilter);
    if (statusFilter !== "all") t = t.filter((x) => x.status === statusFilter);
    if (fromDate) t = t.filter((x) => (x.createdAt ?? "").slice(0, 10) >= fromDate);
    if (toDate) t = t.filter((x) => (x.createdAt ?? "").slice(0, 10) <= toDate);
    if (search.trim()) {
      const q = search.toLowerCase();
      t = t.filter(
        (x) =>
          x.title.toLowerCase().includes(q) ||
          (x.assignedByName ?? "").toLowerCase().includes(q) ||
          (x.assignedToName ?? "").toLowerCase().includes(q)
      );
    }
    return [...t].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }, [allTasks, centerFilter, assignerFilter, assigneeFilter, statusFilter, fromDate, toDate, search, seesAll, isMis, userCenter, myCenter, allowedCenters]);

  const totalAssignments = rows.length;
  const selfAssigned = rows.filter((r) => r.assignedBy === r.assignedTo).length;
  const crossAssigned = totalAssignments - selfAssigned;

  if (!canView) {
    return <div className="p-8 text-muted-foreground">This page is for the Boss, MIS, and Center Heads only.</div>;
  }

  return (
    <div className="p-6 max-w-6xl">
      <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">MANAGEMENT TASK PRO · PRIVATE</div>
      <h1 className="text-2xl font-bold text-foreground mb-1">Assignment Monitor</h1>
      <p className="text-sm text-muted-foreground mb-5">
        {seesAll
          ? "See who is assigning tasks to whom, across all centers."
          : `See who is assigning tasks to whom in your center${myCenter ? ` — ${myCenter}` : ""}.`}
      </p>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-2xl font-bold text-foreground">{totalAssignments}</div>
          <div className="text-xs text-muted-foreground mt-1">Total assignments</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-2xl font-bold text-foreground">{crossAssigned}</div>
          <div className="text-xs text-muted-foreground mt-1">Assigned to others</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-2xl font-bold text-foreground">{selfAssigned}</div>
          <div className="text-xs text-muted-foreground mt-1">Assigned to self</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        {seesAll && centerOptions.length > 1 && (
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">🏢 Center</label>
            <select
              value={centerFilter}
              onChange={(e) => { setCenterFilter(e.target.value); setAssignerFilter("all"); setAssigneeFilter("all"); }}
              className="px-3 py-2 border border-border rounded-lg text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="all">All Centers</option>
              {centerOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1">Assigned by (Assigner)</label>
          <select
            value={assignerFilter}
            onChange={(e) => setAssignerFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
            className="px-3 py-2 border border-border rounded-lg text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All</option>
            {assigners.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1">Assigned to (Assignee)</label>
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
            className="px-3 py-2 border border-border rounded-lg text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All</option>
            {centerScopedUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="inProgress">In Progress</option>
            <option value="done">Done</option>
          </select>
        </div>
        <div className="flex items-end">
          <DateRangePicker
            from={fromDate}
            to={toDate}
            onApply={({ from, to }) => { setFromDate(from); setToDate(to); }}
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-semibold text-muted-foreground mb-1">Search</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by task or name..."
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Assigned by</th>
                <th className="px-4 py-3 font-semibold"></th>
                <th className="px-4 py-3 font-semibold">Assigned to</th>
                <th className="px-4 py-3 font-semibold">Task</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    No assignments found.
                  </td>
                </tr>
              ) : (
                rows.map((t) => (
                  <tr key={t.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">{formatDate(t.createdAt)}</td>
                    <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{t.assignedByName ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">→</td>
                    <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{t.assignedToName ?? "—"}</td>
                    <td className="px-4 py-3 text-foreground">{t.title}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs border rounded-full px-2.5 py-1 font-semibold ${STATUS_COLORS[t.status] ?? ""}`}>
                        {STATUS_LABELS[t.status] ?? t.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
