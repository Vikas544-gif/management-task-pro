import { useState, useMemo } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, Cell, CartesianGrid,
} from "recharts";
import { useListUsers, useListAgentMetrics, getListAgentMetricsQueryKey } from "@workspace/api-client-react";
import { DateRangePicker } from "@/components/DateRangePicker";
import { buildHierarchySet, isAllCentersViewer, cn } from "@/lib/utils";

interface SalesReportProps {
  currentUser: { id: number; name: string; role: string; department: string };
}

// Local "YYYY-MM-DD" (avoids UTC/locale drift).
const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO = () => toISO(new Date());
const monthStartISO = () => {
  const d = new Date();
  return toISO(new Date(d.getFullYear(), d.getMonth(), 1));
};

// Roll every metric row up per agent: DC / Prospect / Sales FD are daily activity
// counts (SUM across the window), while Sales MTD / Target / averages are
// point-in-time figures (keep the latest non-null; rows arrive newest-first).
function aggregateByAgent(rows: any[]) {
  const sums = new Map<number, { dc: number; prospectCount: number; salesFd: number }>();
  const latest = new Map<number, Record<string, any>>();
  const POINT = ["salesMtd", "target", "last3mAvg", "last6mAvg"] as const;
  for (const m of rows) {
    const s = sums.get(m.agentId) ?? { dc: 0, prospectCount: 0, salesFd: 0 };
    s.dc += Number(m.dc) || 0;
    s.prospectCount += Number(m.prospectCount) || 0;
    s.salesFd += Number(m.salesFd) || 0;
    sums.set(m.agentId, s);
    const p = latest.get(m.agentId) ?? {};
    for (const f of POINT) if (p[f] == null && m[f] != null) p[f] = m[f];
    latest.set(m.agentId, p);
  }
  const out = new Map<number, any>();
  for (const [id, s] of sums) {
    const p = latest.get(id) ?? {};
    out.set(id, {
      agentId: id,
      dc: s.dc, prospectCount: s.prospectCount, salesFd: s.salesFd,
      salesMtd: p.salesMtd ?? null, target: p.target ?? null,
      last3mAvg: p.last3mAvg ?? null, last6mAvg: p.last6mAvg ?? null,
    });
  }
  return out;
}

const CENTER_ORDER = ["Head Office", "Thane Center", "Malad Center", "Pune Center", "Navi Mumbai Center"];
const fmt = (n: number) => n.toLocaleString("en-IN");
const firstName = (name: string) => name.split(" ")[0];
const achColor = (pct: number) => (pct >= 100 ? "#10b981" : pct >= 50 ? "#f59e0b" : "#ef4444");

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-4">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold mt-1" style={{ color: accent }}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-4">
      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">{title}</div>
      {children}
    </div>
  );
}

export default function SalesReport({ currentUser }: SalesReportProps) {
  const [from, setFrom] = useState(() => monthStartISO());
  const [to, setTo] = useState(() => todayISO());
  const [centerFilter, setCenterFilter] = useState<string>("All");
  const [tlFilter, setTlFilter] = useState<string>("All");

  const { data: allUsers = [] } = useListUsers();
  const { data: allMetrics = [] } = useListAgentMetrics(
    {},
    { query: { queryKey: getListAgentMetricsQueryKey({}) } }
  );

  const isBoss = currentUser.department === "Management" || currentUser.role === "Boss";
  const isMis = isAllCentersViewer(currentUser);
  const seesAllCenters = isBoss || isMis;

  // Which Sales Agents this viewer may see: Boss/MIS see everyone, others see only
  // their own org-chart subtree (the same scope as the Team → Agent Tracking view).
  const scopedAgents = useMemo(() => {
    const salesAgents = allUsers.filter((u: any) => u.role === "Sales Agent");
    if (seesAllCenters) return salesAgents;
    const subtree = buildHierarchySet(currentUser.id, allUsers as any);
    return salesAgents.filter((u: any) => subtree.has(u.id));
  }, [allUsers, seesAllCenters, currentUser.id]);

  // Centers available as filter pills (Boss/MIS only, and only when >1 exists).
  const centers = useMemo(() => {
    const set = new Set<string>();
    for (const a of scopedAgents) if (a.center) set.add(a.center);
    return [...set].sort((x, y) => {
      const ix = CENTER_ORDER.indexOf(x), iy = CENTER_ORDER.indexOf(y);
      return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy);
    });
  }, [scopedAgents]);

  // Agents after the center pill filter (before the Team Leader filter).
  const centerAgents = useMemo(
    () => scopedAgents.filter((a: any) => centerFilter === "All" || a.center === centerFilter),
    [scopedAgents, centerFilter]
  );

  // Team Leaders available as filter pills — only those whose org-chart subtree
  // contains at least one of the center-filtered agents.
  const teamLeaders = useMemo(() => {
    return (allUsers as any[])
      .filter((u) => u.role === "Team Leader")
      .filter((tl) => {
        const set = buildHierarchySet(tl.id, allUsers as any);
        return centerAgents.some((a: any) => set.has(a.id));
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allUsers, centerAgents]);

  // Agents after the TL pill filter (an agent belongs to a TL when it sits inside
  // that TL's org-chart subtree).
  const displayAgents = useMemo(() => {
    if (tlFilter === "All") return centerAgents;
    const set = buildHierarchySet(Number(tlFilter), allUsers as any);
    return centerAgents.filter((a: any) => set.has(a.id));
  }, [centerAgents, tlFilter, allUsers]);
  const displayAgentIds = useMemo(() => new Set(displayAgents.map((a: any) => a.id)), [displayAgents]);

  // Metric rows inside the selected [from, to] window AND belonging to a visible agent.
  const windowMetrics = useMemo(
    () => allMetrics.filter((m: any) =>
      displayAgentIds.has(m.agentId) &&
      (!from || m.date >= from) && (!to || m.date <= to)
    ),
    [allMetrics, displayAgentIds, from, to]
  );

  const aggMap = useMemo(() => aggregateByAgent(windowMetrics), [windowMetrics]);

  // Per-agent rows enriched with name / center / achievement %.
  const agentRows = useMemo(() => {
    const rows: any[] = [];
    for (const a of displayAgents) {
      const m = aggMap.get(a.id);
      if (!m) continue;
      const mtd = Number(m.salesMtd) || 0;
      const target = Number(m.target) || 0;
      rows.push({
        id: a.id,
        name: a.name,
        short: firstName(a.name),
        center: a.center ?? "—",
        dc: Number(m.dc) || 0,
        prospectCount: Number(m.prospectCount) || 0,
        salesFd: Number(m.salesFd) || 0,
        salesMtd: mtd,
        target,
        achievement: target > 0 ? Math.round((mtd / target) * 100) : 0,
      });
    }
    return rows;
  }, [displayAgents, aggMap]);

  const totals = useMemo(() => {
    const t = { dc: 0, prospectCount: 0, salesFd: 0, salesMtd: 0, target: 0 };
    for (const r of agentRows) {
      t.dc += r.dc; t.prospectCount += r.prospectCount; t.salesFd += r.salesFd;
      t.salesMtd += r.salesMtd; t.target += r.target;
    }
    return t;
  }, [agentRows]);
  const overallAch = totals.target > 0 ? Math.round((totals.salesMtd / totals.target) * 100) : 0;

  // Top performers (by Sales MTD) for the comparison charts.
  const topByMtd = useMemo(
    () => [...agentRows].sort((a, b) => b.salesMtd - a.salesMtd).slice(0, 12),
    [agentRows]
  );
  const topByActivity = useMemo(
    () => [...agentRows].sort((a, b) => (b.dc + b.prospectCount + b.salesFd) - (a.dc + a.prospectCount + a.salesFd)).slice(0, 12),
    [agentRows]
  );
  const achRanked = useMemo(
    () => agentRows.filter((r) => r.target > 0).sort((a, b) => b.achievement - a.achievement).slice(0, 12),
    [agentRows]
  );

  // Sales MTD vs Target grouped by center.
  const byCenter = useMemo(() => {
    const m = new Map<string, { center: string; salesMtd: number; target: number; salesFd: number }>();
    for (const r of agentRows) {
      const e = m.get(r.center) ?? { center: r.center, salesMtd: 0, target: 0, salesFd: 0 };
      e.salesMtd += r.salesMtd; e.target += r.target; e.salesFd += r.salesFd;
      m.set(r.center, e);
    }
    return [...m.values()].map((e) => ({ ...e, name: e.center.replace(/ Center$/, "") }));
  }, [agentRows]);

  // Daily Sales FD trend across the window (sum of all visible agents per date).
  const trend = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of windowMetrics) {
      m.set(row.date, (m.get(row.date) || 0) + (Number(row.salesFd) || 0));
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, salesFd]) => ({
      date: date.slice(5), // MM-DD
      "Sales FD": salesFd,
    }));
  }, [windowMetrics]);

  const barHeight = (n: number) => Math.max(200, n * 34 + 40);
  const hasData = agentRows.length > 0 && windowMetrics.length > 0;

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">💰 Sales Report</h1>
          <p className="text-sm text-muted-foreground">Agent performance — Sales MTD, Target, DC & activity</p>
        </div>
        <DateRangePicker
          disableFuture
          label="Period"
          from={from}
          to={to}
          onApply={({ from: f, to: t }) => { setFrom(f); setTo(t); }}
        />
      </div>

      {/* Center filter (Boss/MIS only, and only when >1 center exists) */}
      {seesAllCenters && centers.length > 1 && (
        <div className="flex gap-1.5 mb-4 flex-wrap items-center">
          <span className="text-xs font-bold text-muted-foreground mr-1">🏢 Center</span>
          {["All", ...centers].map((c) => (
            <button
              key={c}
              onClick={() => { setCenterFilter(c); setTlFilter("All"); }}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-semibold transition",
                centerFilter === c ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted"
              )}
            >
              {c === "All" ? "All Centers" : c.replace(/ Center$/, "")}
            </button>
          ))}
        </div>
      )}

      {/* Team Leader filter (only when more than one TL is visible) */}
      {teamLeaders.length > 1 && (
        <div className="flex gap-1.5 mb-4 flex-wrap items-center">
          <span className="text-xs font-bold text-muted-foreground mr-1">👤 Team Leader</span>
          <button
            onClick={() => setTlFilter("All")}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-semibold transition",
              tlFilter === "All" ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted"
            )}
          >
            All TLs
          </button>
          {teamLeaders.map((tl) => (
            <button
              key={tl.id}
              onClick={() => setTlFilter(String(tl.id))}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-semibold transition",
                tlFilter === String(tl.id) ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted"
              )}
            >
              {firstName(tl.name)}
            </button>
          ))}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <KpiCard label="Sales MTD" value={fmt(totals.salesMtd)} accent="#10b981" />
        <KpiCard label="Target" value={fmt(totals.target)} accent="#6366f1" />
        <KpiCard label="Achievement" value={`${overallAch}%`} accent={achColor(overallAch)} sub={`${fmt(totals.salesMtd)} / ${fmt(totals.target)}`} />
        <KpiCard label="DC" value={fmt(totals.dc)} accent="#3b82f6" />
        <KpiCard label="Prospect Count" value={fmt(totals.prospectCount)} accent="#f59e0b" />
        <KpiCard label="Sales FD" value={fmt(totals.salesFd)} accent="#14b8a6" />
      </div>

      {!hasData ? (
        <div className="bg-card rounded-xl border border-border shadow-sm p-12 text-center text-muted-foreground">
          No sales data for the selected period.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Sales MTD vs Target by agent */}
          <ChartCard title="🎯 Sales MTD vs Target — Top Agents">
            <ResponsiveContainer width="100%" height={barHeight(topByMtd.length)}>
              <BarChart data={topByMtd} layout="vertical" margin={{ left: 10, right: 16 }} barCategoryGap="25%">
                <CartesianGrid horizontal={false} strokeOpacity={0.15} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="short" width={80} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="salesMtd" name="Sales MTD" fill="#10b981" radius={[0, 3, 3, 0]} />
                <Bar dataKey="target" name="Target" fill="#6366f1" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Achievement % by agent */}
          <ChartCard title="📈 Achievement % — Top Agents (Sales MTD ÷ Target)">
            {achRanked.length === 0 ? (
              <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
                No targets set for this period.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={barHeight(achRanked.length)}>
                <BarChart data={achRanked} layout="vertical" margin={{ left: 10, right: 24 }} barCategoryGap="25%">
                  <CartesianGrid horizontal={false} strokeOpacity={0.15} />
                  <XAxis type="number" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="short" width={80} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => `${v}%`} />
                  <Bar dataKey="achievement" name="Achievement %" radius={[0, 3, 3, 0]}>
                    {achRanked.map((r) => <Cell key={r.id} fill={achColor(r.achievement)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Activity by agent — DC / Prospect / Sales FD */}
          <ChartCard title="📞 Activity — DC / Prospect / Sales FD (Top Agents)">
            <ResponsiveContainer width="100%" height={barHeight(topByActivity.length)}>
              <BarChart data={topByActivity} layout="vertical" margin={{ left: 10, right: 16 }} barCategoryGap="20%">
                <CartesianGrid horizontal={false} strokeOpacity={0.15} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="short" width={80} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="dc" name="DC" fill="#3b82f6" radius={[0, 3, 3, 0]} />
                <Bar dataKey="prospectCount" name="Prospect" fill="#f59e0b" radius={[0, 3, 3, 0]} />
                <Bar dataKey="salesFd" name="Sales FD" fill="#14b8a6" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* By center — Sales MTD vs Target */}
          <ChartCard title="🏢 Sales MTD vs Target — by Center">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={byCenter} barCategoryGap="30%">
                <CartesianGrid vertical={false} strokeOpacity={0.15} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="salesMtd" name="Sales MTD" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="target" name="Target" fill="#6366f1" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Daily Sales FD trend — full width */}
          <div className="lg:col-span-2">
            <ChartCard title="📅 Daily Sales (FD) Trend">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trend} margin={{ left: 4, right: 16 }}>
                  <CartesianGrid strokeOpacity={0.15} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => fmt(Number(v))} />
                  <Line type="monotone" dataKey="Sales FD" stroke="#14b8a6" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </div>
      )}
    </div>
  );
}
