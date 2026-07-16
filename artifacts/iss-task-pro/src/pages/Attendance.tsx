import { useState, useMemo, Fragment } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell } from "recharts";
import { useListUsers, useListAttendance, useUpsertAttendance } from "@workspace/api-client-react";
import { DateRangePicker } from "@/components/DateRangePicker";
import { isAllCentersViewer } from "@/lib/utils";

const STATUSES = [
  { value: "present", label: "Present", on: "bg-green-600 text-white border-green-600" },
  { value: "absent", label: "Absent", on: "bg-red-600 text-white border-red-600" },
  { value: "half_day", label: "Half Day", on: "bg-amber-500 text-white border-amber-500" },
  { value: "leave", label: "Leave", on: "bg-blue-600 text-white border-blue-600" },
];
const IDLE = "bg-card text-muted-foreground border-border hover:bg-muted";
const CENTER_ORDER = ["Thane Center", "Malad Center", "Pune Center", "Navi Mumbai Center"];
const CENTER_HEADS_OPT = "Center Heads";

interface CurrentUser { id: number; name: string; role: string; department: string; center?: string; }
interface Props { currentUser?: CurrentUser | null; }

export default function Attendance({ currentUser }: Props) {
  const isBoss = !!currentUser && (currentUser.department === "Management" || currentUser.role === "Boss");
  const isCenterHead = !!currentUser && currentUser.role === "Center Head";
  const isMis = isAllCentersViewer(currentUser);
  // Real MIS department only — a Director shares MIS's outer-centers reach but
  // must NOT see Head Office attendance (where MIS itself sits).
  const isMisDept = !!currentUser && currentUser.department === "MIS";
  const canView = isBoss || isCenterHead || isMis;
  const canMark = isBoss || isCenterHead || isMis;
  const seesAll = isBoss || isMis;

  const { data: users = [] } = useListUsers();
  const myCenter = useMemo(() => users.find((u) => u.id === currentUser?.id)?.center ?? null, [users, currentUser]);

  const centerOptions = useMemo(() => {
    const set = new Set(users.map((u) => u.center).filter((c): c is string => Boolean(c) && (isBoss || isMisDept || c !== "Head Office")));
    const rank = (c: string) => { const i = CENTER_ORDER.indexOf(c); return i === -1 ? CENTER_ORDER.length : i; };
    return Array.from(set).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }, [users, isMisDept, isBoss]);

  // The Boss can VIEW every center (to see the TL attendance their Center Heads marked) but
  // only MARKS Center Heads + Head Office (see canMarkHere). So the picker keeps all centers
  // plus the virtual "Center Heads" roster; sales-center rows render read-only for the Boss.
  const centerSelectOptions = useMemo(
    () => (isBoss || isMis ? [...centerOptions, CENTER_HEADS_OPT] : centerOptions),
    [centerOptions, isBoss, isMis]
  );

  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate, setToDate] = useState(todayStr);
  // A single day enables marking; a multi-day window is a read-only day-wise view.
  const singleDay = fromDate && fromDate === toDate ? fromDate : null;
  const [centerPick, setCenterPick] = useState<string>("");
  // In the "Center Heads" roster, the Boss can expand a head to see that center's TLs.
  const [expandedHead, setExpandedHead] = useState<number | null>(null);
  // Sort direction for the Name column (A→Z / Z→A), matching the Team page.
  const [nameSort, setNameSort] = useState<"az" | "za">("az");

  const defaultCenter = isBoss ? CENTER_HEADS_OPT : (centerOptions[0] || "");
  const selectedCenter = seesAll ? (centerPick || defaultCenter) : (myCenter ?? "");

  // Marking is enabled only where the viewer is the actual marker: a Center Head on their own
  // center; the Boss on the "Center Heads" roster and Head Office; MIS on the "Center Heads"
  // roster too. Sales centers stay read-only for the Boss/MIS (their Center Head is the marker).
  const canMarkHere =
    isCenterHead ||
    (isBoss && (selectedCenter === CENTER_HEADS_OPT || selectedCenter === "Head Office")) ||
    (isMis && selectedCenter === CENTER_HEADS_OPT);

  // Single day stays server-date-scoped; a multi-day window fetches all and is narrowed client-side.
  const { data: attendance = [], refetch } = useListAttendance(singleDay ? { date: singleDay } : {});
  const upsert = useUpsertAttendance();

  // Attendance roster excludes Sales Agents (they're tracked in the Team page's agent table),
  // the center's own Center Head, and the Boss. So sales centers show their Team Leaders, and
  // Head Office shows its office staff. The "Center Heads" view (Boss only) lists all Center Heads.
  const members = useMemo(
    () =>
      users
        .filter((u) =>
          selectedCenter === CENTER_HEADS_OPT
            ? u.role === "Center Head"
            : u.center === selectedCenter && u.role !== "Sales Agent" && u.role !== "Center Head" && u.role !== "Boss"
        )
        .sort((a, b) => (nameSort === "za" ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name))),
    [users, selectedCenter, nameSort]
  );

  const statusByUser = useMemo(() => {
    const ids = new Set(members.map((m) => m.id));
    const map = new Map<number, string>();
    for (const a of attendance) if (ids.has(a.userId)) map.set(a.userId, a.status);
    return map;
  }, [attendance, members]);

  // Status for any user on the selected day (used by the Center-Heads drill-down). On a single
  // day the fetched attendance is already that day's, so this covers TLs outside `members` too.
  const dayStatus = useMemo(() => {
    const map = new Map<number, string>();
    for (const a of attendance) map.set(a.userId, a.status);
    return map;
  }, [attendance]);

  // Each Center Head → the Team Leaders in their center (for the expandable drill-down).
  const tlsByHead = useMemo(() => {
    const map = new Map<number, typeof users>();
    for (const ch of users) {
      if (ch.role !== "Center Head") continue;
      map.set(
        ch.id,
        users
          .filter((u) => u.role === "Team Leader" && u.center === ch.center)
          .sort((a, b) => (nameSort === "za" ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)))
      );
    }
    return map;
  }, [users, nameSort]);

  const headcount = members.length;
  const present = members.filter((m) => statusByUser.get(m.id) === "present").length;
  const halfDay = members.filter((m) => statusByUser.get(m.id) === "half_day").length;
  const leave = members.filter((m) => statusByUser.get(m.id) === "leave").length;
  const absent = members.filter((m) => statusByUser.get(m.id) === "absent").length;
  const marked = present + halfDay + leave + absent;
  const presentEq = present + 0.5 * halfDay;
  const shrinkage = headcount > 0 ? Math.round(((headcount - presentEq) / headcount) * 1000) / 10 : 0;

  const statusChartData = [
    { name: "Present", value: present, fill: "#10b981" },
    { name: "Half Day", value: halfDay, fill: "#f59e0b" },
    { name: "Leave", value: leave, fill: "#3b82f6" },
    { name: "Absent", value: absent, fill: "#ef4444" },
    { name: "Unmarked", value: Math.max(0, headcount - marked), fill: "#94a3b8" },
  ];

  // Per-center comparison (Boss view) — useListAttendance returns all centers for the date.
  const perCenterStats = useMemo(() => {
    return centerOptions.map((c) => {
      const mem = users.filter((u) => u.center === c && u.role !== "Sales Agent" && u.role !== "Center Head" && u.role !== "Boss");
      const ids = new Set(mem.map((m) => m.id));
      let p = 0, h = 0, l = 0, ab = 0;
      for (const a of attendance) {
        if (!ids.has(a.userId)) continue;
        if (a.status === "present") p++;
        else if (a.status === "half_day") h++;
        else if (a.status === "leave") l++;
        else if (a.status === "absent") ab++;
      }
      const hc = mem.length;
      const shr = hc > 0 ? Math.round(((hc - (p + 0.5 * h)) / hc) * 1000) / 10 : 0;
      return { center: c.replace(" Center", ""), Present: p, "Absent/Leave": ab + l, Shrinkage: shr };
    });
  }, [centerOptions, users, attendance]);

  // Day-wise attendance across the selected window for the chosen center.
  const dailyChartData = useMemo(() => {
    const memberIds = new Set(members.map((m) => m.id));
    const byDate = new Map<string, { Present: number; "Half Day": number; Leave: number; Absent: number }>();
    for (const a of attendance) {
      if (!memberIds.has(a.userId)) continue;
      if (fromDate && a.date < fromDate) continue;
      if (toDate && a.date > toDate) continue;
      const d = byDate.get(a.date) ?? { Present: 0, "Half Day": 0, Leave: 0, Absent: 0 };
      if (a.status === "present") d.Present++;
      else if (a.status === "half_day") d["Half Day"]++;
      else if (a.status === "leave") d.Leave++;
      else if (a.status === "absent") d.Absent++;
      byDate.set(a.date, d);
    }
    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({ date: date.slice(5).replace("-", "/"), ...v }));
  }, [attendance, members, fromDate, toDate]);

  // Store each person's real center (so Center Heads keep their own center, not the virtual label).
  const centerFor = (userId: number) =>
    selectedCenter === CENTER_HEADS_OPT ? (users.find((u) => u.id === userId)?.center ?? selectedCenter) : selectedCenter;

  const mark = async (userId: number, status: string) => {
    if (!currentUser || !singleDay) return;
    await upsert.mutateAsync({ data: { userId, date: singleDay, status, center: centerFor(userId), markedBy: currentUser.id } });
    refetch();
  };

  const markAllPresent = async () => {
    if (!currentUser || !singleDay) return;
    for (const m of members) {
      if (statusByUser.get(m.id) !== "present") {
        await upsert.mutateAsync({ data: { userId: m.id, date: singleDay, status: "present", center: centerFor(m.id), markedBy: currentUser.id } });
      }
    }
    refetch();
  };

  if (!canView) {
    return <div className="p-8 text-muted-foreground">This page is for the Boss, Center Heads and MIS only.</div>;
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">MANAGEMENT TASK PRO · ATTENDANCE</div>
      <h1 className="text-2xl font-bold text-foreground mb-1">Attendance</h1>
      <p className="text-sm text-muted-foreground mb-5">
        {canMarkHere ? "Mark daily attendance for your team" : "View daily attendance"}{selectedCenter ? ` — ${selectedCenter}` : ""}.
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div className="flex items-end">
          <DateRangePicker
            disableFuture
            from={fromDate}
            to={toDate}
            onApply={({ from, to }) => { setFromDate(from); setToDate(to); }}
          />
        </div>
        {seesAll && centerOptions.length > 0 && (
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">🏢 Center</label>
            <select
              value={selectedCenter}
              onChange={(e) => setCenterPick(e.target.value)}
              className="px-3 py-2 border border-border rounded-lg text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {centerSelectOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        )}
        {canMarkHere && singleDay && (
          <div className="flex items-end">
            <button
              onClick={markAllPresent}
              disabled={upsert.isPending || members.length === 0}
              className="px-3 py-2 border border-green-600 rounded-lg text-sm bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              Mark all present
            </button>
          </div>
        )}
      </div>

      {!singleDay && (
        <>
          <div className="bg-card border border-border rounded-xl p-4 text-sm text-muted-foreground mb-5">
            Showing day-wise attendance for the selected window — pick a single day to mark attendance.
          </div>
          {dailyChartData.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5 mb-5">
              <h2 className="text-sm font-semibold text-foreground mb-3">
                Day-wise attendance{selectedCenter ? ` — ${selectedCenter}` : ""}
              </h2>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={dailyChartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Present" fill="#10b981" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Half Day" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Leave" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Absent" fill="#ef4444" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      {singleDay && (
        <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-2xl font-bold text-foreground">{headcount}</div>
          <div className="text-xs text-muted-foreground mt-1">Headcount</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-2xl font-bold text-green-600">{present}{halfDay > 0 ? ` + ${halfDay}½` : ""}</div>
          <div className="text-xs text-muted-foreground mt-1">Present{marked < headcount ? ` · ${headcount - marked} unmarked` : ""}</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-2xl font-bold text-red-600">{absent + leave}</div>
          <div className="text-xs text-muted-foreground mt-1">Absent / Leave</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-2xl font-bold text-foreground">{shrinkage}%</div>
          <div className="text-xs text-muted-foreground mt-1">Shrinkage</div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-semibold">
                  <div className="flex items-center gap-2">
                    <span>Name</span>
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
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                    No members found for this center.
                  </td>
                </tr>
              ) : (
                members.map((m) => {
                  const current = statusByUser.get(m.id);
                  const isHeadRoster = selectedCenter === CENTER_HEADS_OPT;
                  const tls = isHeadRoster ? (tlsByHead.get(m.id) ?? []) : [];
                  const isOpen = expandedHead === m.id;
                  return (
                    <Fragment key={m.id}>
                    <tr className="border-t border-border hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                        {isHeadRoster && tls.length > 0 ? (
                          <button
                            onClick={() => setExpandedHead(isOpen ? null : m.id)}
                            className="flex items-center gap-1.5 hover:text-primary"
                          >
                            <span className={`text-[10px] text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
                            {m.name}
                          </button>
                        ) : (
                          m.name
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{m.role}</td>
                      <td className="px-4 py-3">
                        {canMarkHere ? (
                          <div className="flex flex-wrap gap-1.5">
                            {STATUSES.map((s) => (
                              <button
                                key={s.value}
                                onClick={() => mark(m.id, s.value)}
                                disabled={upsert.isPending}
                                className={`text-xs border rounded-full px-3 py-1 font-semibold transition-colors disabled:opacity-60 ${
                                  current === s.value ? s.on : IDLE
                                }`}
                              >
                                {s.label}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span
                            className={`inline-block text-xs border rounded-full px-3 py-1 font-semibold ${
                              current ? STATUSES.find((s) => s.value === current)?.on ?? IDLE : "bg-muted text-muted-foreground border-border"
                            }`}
                          >
                            {current ? STATUSES.find((s) => s.value === current)?.label ?? current : "Not marked"}
                          </span>
                        )}
                      </td>
                    </tr>
                    {isHeadRoster && isOpen && (tls.length > 0
                      ? tls.map((tl) => {
                          const ts = dayStatus.get(tl.id);
                          const meta = ts ? STATUSES.find((s) => s.value === ts) : null;
                          return (
                            <tr key={`tl-${tl.id}`} className="border-t border-border bg-muted/20">
                              <td className="px-4 py-2 pl-10 text-foreground whitespace-nowrap">{tl.name}</td>
                              <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">Team Leader</td>
                              <td className="px-4 py-2">
                                <span
                                  className={`inline-block text-xs border rounded-full px-3 py-1 font-semibold ${
                                    ts ? meta?.on ?? IDLE : "bg-muted text-muted-foreground border-border"
                                  }`}
                                >
                                  {ts ? meta?.label ?? ts : "Not marked"}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      : (
                        <tr key={`tl-empty-${m.id}`} className="border-t border-border bg-muted/20">
                          <td colSpan={3} className="px-4 py-2 pl-10 text-xs text-muted-foreground">
                            No Team Leaders in this center.
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-3">
            Today's status breakdown{selectedCenter ? ` — ${selectedCenter}` : ""}
          </h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={statusChartData} barSize={36} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" name="Members" radius={[3, 3, 0, 0]}>
                {statusChartData.map((s, i) => (
                  <Cell key={i} fill={s.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {seesAll && perCenterStats.length > 1 && (
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-3">Present vs Absent by center</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={perCenterStats} barSize={14} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="center" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Present" fill="#10b981" radius={[2, 2, 0, 0]} />
                <Bar dataKey="Absent/Leave" fill="#ef4444" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
