import { useState, useEffect, useMemo } from "react";
import { useListUsers, useListEodReports, useUpsertEodReport } from "@workspace/api-client-react";
import { DateRangePicker } from "@/components/DateRangePicker";
import { isAllCentersViewer, resolveAllowedCenters } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

const CENTER_ORDER = ["Thane Center", "Malad Center", "Pune Center", "Navi Mumbai Center"];
const fmt = (n: number) => new Intl.NumberFormat("en-IN").format(n || 0);
// Shrinkage % = portion of headcount not present, auto-calculated. 1 decimal.
const shrinkPct = (hc: number, present: number) =>
  hc > 0 ? Math.max(0, Math.round(((hc - present) / hc) * 1000) / 10) : 0;
// Attrition % = team members who left as a portion of headcount, auto-calculated. 1 decimal.
const attrPct = (hc: number, attrition: number) =>
  hc > 0 ? Math.max(0, Math.round((attrition / hc) * 1000) / 10) : 0;
// Average of a list of numbers (0 when empty), and a 1-decimal rounder.
const avgOf = (vals: number[]) => (vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

interface CurrentUser { id: number; name: string; role: string; department: string; center?: string; }
interface Props { currentUser?: CurrentUser | null; }

interface ExistingEod { salesFd: number; salesMtd: number; dc: number; hc: number; present: number; absent: number; attrition: number; notes?: string | null; submittedByName?: string | null; }

function TlEodCard({
  teamName,
  center,
  existing,
  saving,
  onSave,
}: {
  teamName: string;
  center: string;
  existing?: ExistingEod;
  saving: boolean;
  onSave: (v: { salesFd: number; salesMtd: number; dc: number; hc: number; present: number; absent: number; attrition: number; notes: string }) => void;
}) {
  const [salesFd, setSalesFd] = useState("");
  const [salesMtd, setSalesMtd] = useState("");
  const [dc, setDc] = useState("");
  const [hc, setHc] = useState("");
  const [present, setPresent] = useState("");
  const [absent, setAbsent] = useState("");
  const [attrition, setAttrition] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    setSalesFd(existing ? String(existing.salesFd) : "");
    setSalesMtd(existing ? String(existing.salesMtd) : "");
    setDc(existing ? String(existing.dc) : "");
    setHc(existing ? String(existing.hc) : "");
    setPresent(existing ? String(existing.present) : "");
    setAbsent(existing ? String(existing.absent) : "");
    setAttrition(existing ? String(existing.attrition) : "");
    setNotes(existing?.notes ?? "");
  }, [existing]);

  const num = (s: string) => Math.max(0, Math.round(Number(s) || 0));

  // Headcount must reconcile: Present + Absent + Attrition has to equal HC before submit.
  // HC must be filled in first — a fresh/blank form must not be submittable.
  const hcNum = num(hc);
  const headSum = num(present) + num(absent) + num(attrition);
  const hcFilled = hc.trim() !== "";
  const balanced = hcFilled && headSum === hcNum;

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-foreground">{teamName}</h2>
          <div className="text-xs text-muted-foreground">{center}</div>
        </div>
        {existing ? (
          <span className="text-xs font-semibold text-green-600">Submitted</span>
        ) : (
          <span className="text-xs font-semibold text-amber-600">Not submitted</span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1">Sales FD</label>
          <input
            type="number" min={0} value={salesFd}
            onChange={(e) => setSalesFd(e.target.value)} placeholder="0"
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1">Sales MTD</label>
          <input
            type="number" min={0} value={salesMtd}
            onChange={(e) => setSalesMtd(e.target.value)} placeholder="0"
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1" title="Daily Collection">DC</label>
          <input
            type="number" min={0} value={dc}
            onChange={(e) => setDc(e.target.value)} placeholder="0"
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1" title="Team headcount">HC</label>
          <input
            type="number" min={0} value={hc}
            onChange={(e) => setHc(e.target.value)} placeholder="0"
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1">Present</label>
          <input
            type="number" min={0} value={present}
            onChange={(e) => setPresent(e.target.value)} placeholder="0"
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1">Absent</label>
          <input
            type="number" min={0} value={absent}
            onChange={(e) => setAbsent(e.target.value)} placeholder="0"
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1" title="Team members who left">Attrition</label>
          <input
            type="number" min={0} value={attrition}
            onChange={(e) => setAttrition(e.target.value)} placeholder="0"
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 px-3 py-2 bg-muted/40 rounded-lg">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">Shrinkage</span>
          <span className="text-sm font-bold text-amber-600">{shrinkPct(num(hc), num(present))}%</span>
          <span className="text-[11px] text-muted-foreground">from HC &amp; Present</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">Attrition</span>
          <span className="text-sm font-bold text-rose-600">{attrPct(num(hc), num(attrition))}%</span>
          <span className="text-[11px] text-muted-foreground">from HC &amp; Attrition</span>
        </div>
      </div>

      {!balanced && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300">
          {!hcFilled ? (
            "Enter the headcount (HC) and attendance before you can submit."
          ) : (
            <>Present + Absent + Attrition (<span className="font-bold">{headSum}</span>) must equal HC (<span className="font-bold">{hcNum}</span>) before you can submit.</>
          )}
        </div>
      )}

      <div className="mb-4">
        <label className="block text-xs font-semibold text-muted-foreground mb-1">Notes (optional)</label>
        <textarea
          value={notes} rows={2}
          onChange={(e) => setNotes(e.target.value)} placeholder="Any remarks for the day..."
          className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring resize-y"
        />
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => { if (!balanced) return; onSave({ salesFd: num(salesFd), salesMtd: num(salesMtd), dc: num(dc), hc: num(hc), present: num(present), absent: num(absent), attrition: num(attrition), notes }); }}
          disabled={saving || !balanced}
          title={!balanced ? "Present + Absent + Attrition must equal HC" : undefined}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {saving ? "Saving..." : existing ? "Update EOD" : "Save EOD"}
        </button>
      </div>
    </div>
  );
}

interface TlRow { id: number; name: string; isHead?: boolean; eod?: ExistingEod }

function CenterConsolidated({
  center,
  rows,
  canEditRows,
  onSaveRow,
  saving,
}: {
  center: string;
  rows: TlRow[];
  canEditRows?: boolean;
  onSaveRow?: (r: TlRow, v: { salesFd: number; salesMtd: number; dc: number; hc: number; present: number; absent: number; attrition: number; notes: string }) => void | Promise<void>;
  saving?: boolean;
}) {
  const sumFd = rows.reduce((s, r) => s + (r.eod?.salesFd ?? 0), 0);
  const sumMtd = rows.reduce((s, r) => s + (r.eod?.salesMtd ?? 0), 0);
  const sumDc = rows.reduce((s, r) => s + (r.eod?.dc ?? 0), 0);
  const sumHc = rows.reduce((s, r) => s + (r.eod?.hc ?? 0), 0);
  const sumPresent = rows.reduce((s, r) => s + (r.eod?.present ?? 0), 0);
  const sumAbsent = rows.reduce((s, r) => s + (r.eod?.absent ?? 0), 0);
  const submittedRows = rows.filter((r) => r.eod);
  const submitted = submittedRows.length;
  // Sales MTD is a cumulative month-to-date figure (each team fills their own running
  // total daily). It is summed across teams to show the center's combined month-to-date
  // sales (in range mode each team's MTD peak is used, then summed). Shrinkage and Attrition are averaged.
  const avgShrink = round1(avgOf(submittedRows.map((r) => shrinkPct(r.eod!.hc, r.eod!.present))));
  const avgAttrCount = round1(avgOf(submittedRows.map((r) => r.eod!.attrition)));
  const avgAttrPct = round1(avgOf(submittedRows.map((r) => attrPct(r.eod!.hc, r.eod!.attrition))));

  // Inline edit — rows are editable when canEditRows is on (own row for a TL/Center Head,
  // or any row in the center for Boss/MIS data-entry).
  const [editId, setEditId] = useState<number | null>(null);
  // Sort direction for the Team (name) column (A→Z / Z→A), matching the Team page.
  const [nameSort, setNameSort] = useState<"az" | "za">("az");
  const [draft, setDraft] = useState({ salesFd: "", salesMtd: "", dc: "", hc: "", present: "", absent: "", attrition: "" });
  const num = (s: string) => Math.max(0, Math.round(Number(s) || 0));
  const hcNum = num(draft.hc);
  const headSum = num(draft.present) + num(draft.absent) + num(draft.attrition);
  const balanced = draft.hc.trim() !== "" && headSum === hcNum;
  const displayRows = [...rows].sort((a, b) => (nameSort === "za" ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)));

  const startEdit = (r: TlRow) => {
    setEditId(r.id);
    setDraft({
      salesFd: r.eod ? String(r.eod.salesFd) : "",
      salesMtd: r.eod ? String(r.eod.salesMtd) : "",
      dc: r.eod ? String(r.eod.dc) : "",
      hc: r.eod ? String(r.eod.hc) : "",
      present: r.eod ? String(r.eod.present) : "",
      absent: r.eod ? String(r.eod.absent) : "",
      attrition: r.eod ? String(r.eod.attrition) : "",
    });
  };
  const saveEdit = async (r: TlRow) => {
    if (!balanced || !onSaveRow) return;
    await onSaveRow(r, { salesFd: num(draft.salesFd), salesMtd: num(draft.salesMtd), dc: num(draft.dc), hc: num(draft.hc), present: num(draft.present), absent: num(draft.absent), attrition: num(draft.attrition), notes: r.eod?.notes ?? "" });
    setEditId(null);
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-bold text-foreground">{center}</h2>
        <span className="text-xs text-muted-foreground">{submitted}/{rows.length} TLs submitted</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-8 gap-3 mb-4">
        <div className="bg-muted/40 rounded-lg p-3">
          <div className="text-lg font-bold text-foreground">{fmt(sumFd)}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Total Sales FD</div>
        </div>
        <div className="bg-muted/40 rounded-lg p-3">
          <div className="text-lg font-bold text-foreground">{fmt(sumMtd)}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Total Sales MTD</div>
        </div>
        <div className="bg-muted/40 rounded-lg p-3">
          <div className="text-lg font-bold text-foreground">{fmt(sumDc)}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Total DC</div>
        </div>
        <div className="bg-muted/40 rounded-lg p-3">
          <div className="text-lg font-bold text-foreground">{sumHc}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Total HC</div>
        </div>
        <div className="bg-muted/40 rounded-lg p-3">
          <div className="text-lg font-bold text-green-600">{sumPresent}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Total Present</div>
        </div>
        <div className="bg-muted/40 rounded-lg p-3">
          <div className="text-lg font-bold text-red-600">{sumAbsent}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Total Absent</div>
        </div>
        <div className="bg-muted/40 rounded-lg p-3">
          <div className="text-lg font-bold text-amber-600">{avgShrink}%</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Avg Shrinkage</div>
        </div>
        <div className="bg-muted/40 rounded-lg p-3">
          <div className="text-lg font-bold text-rose-600">{avgAttrCount} · {avgAttrPct}%</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Avg Attrition</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="py-2 pr-3 font-semibold">
                <div className="flex items-center gap-2">
                  <span>Team</span>
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
              <th className="py-2 px-3 font-semibold text-right">Sales FD</th>
              <th className="py-2 px-3 font-semibold text-right">Sales MTD</th>
              <th className="py-2 px-3 font-semibold text-right">DC</th>
              <th className="py-2 px-3 font-semibold text-right">HC</th>
              <th className="py-2 px-3 font-semibold text-right">Present</th>
              <th className="py-2 px-3 font-semibold text-right">Absent</th>
              <th className="py-2 px-3 font-semibold text-right">Shrink%</th>
              <th className="py-2 px-3 font-semibold text-right">Attr</th>
              <th className="py-2 pl-3 font-semibold text-right">Attr%</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-6 text-center text-muted-foreground">No team members in this center.</td>
              </tr>
            ) : (
              displayRows.map((r) => {
                const canEditRow = onSaveRow != null && !!canEditRows;
                if (editId === r.id && canEditRow) {
                  const inputCls = "w-20 px-2 py-1 border border-border rounded text-right text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring";
                  return (
                    <tr key={r.id} className="border-b border-border/60 last:border-0 bg-muted/30 align-top">
                      <td className="py-2 pr-3 font-medium text-foreground whitespace-nowrap">
                        {r.name}
                        {r.isHead && <span className="ml-2 text-[11px] font-semibold text-primary">Center Head</span>}
                        <div className="mt-1.5 flex gap-2">
                          <button
                            onClick={() => saveEdit(r)}
                            disabled={!balanced || !!saving}
                            title={!balanced ? "Present + Absent + Attrition must equal HC" : undefined}
                            className="px-2.5 py-1 rounded text-[11px] font-semibold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                          >
                            {saving ? "Saving..." : "Save"}
                          </button>
                          <button
                            onClick={() => setEditId(null)}
                            disabled={!!saving}
                            className="px-2.5 py-1 rounded text-[11px] font-semibold border border-border text-foreground hover:bg-muted disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                        {!balanced && <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">P + A + Attr must equal HC</div>}
                      </td>
                      <td className="py-2 px-3 text-right"><input type="number" min={0} value={draft.salesFd} onChange={(e) => setDraft({ ...draft, salesFd: e.target.value })} className={inputCls} /></td>
                      <td className="py-2 px-3 text-right"><input type="number" min={0} value={draft.salesMtd} onChange={(e) => setDraft({ ...draft, salesMtd: e.target.value })} className={inputCls} /></td>
                      <td className="py-2 px-3 text-right"><input type="number" min={0} value={draft.dc} onChange={(e) => setDraft({ ...draft, dc: e.target.value })} className={inputCls} /></td>
                      <td className="py-2 px-3 text-right"><input type="number" min={0} value={draft.hc} onChange={(e) => setDraft({ ...draft, hc: e.target.value })} className={inputCls} /></td>
                      <td className="py-2 px-3 text-right"><input type="number" min={0} value={draft.present} onChange={(e) => setDraft({ ...draft, present: e.target.value })} className={inputCls} /></td>
                      <td className="py-2 px-3 text-right"><input type="number" min={0} value={draft.absent} onChange={(e) => setDraft({ ...draft, absent: e.target.value })} className={inputCls} /></td>
                      <td className="py-2 px-3 text-right text-amber-600">{shrinkPct(hcNum, num(draft.present))}%</td>
                      <td className="py-2 px-3 text-right"><input type="number" min={0} value={draft.attrition} onChange={(e) => setDraft({ ...draft, attrition: e.target.value })} className={inputCls} /></td>
                      <td className="py-2 pl-3 text-right text-rose-600">{attrPct(hcNum, num(draft.attrition))}%</td>
                    </tr>
                  );
                }
                return (
                  <tr key={r.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 font-medium text-foreground whitespace-nowrap">
                      {r.name}
                      {r.isHead && <span className="ml-2 text-[11px] font-semibold text-primary">Center Head</span>}
                      {!r.eod && <span className="ml-2 text-[11px] font-semibold text-amber-600">pending</span>}
                      {canEditRow && (
                        <button onClick={() => startEdit(r)} className="ml-2 text-[11px] font-semibold text-primary hover:underline">
                          {r.eod ? "Edit" : "Fill"}
                        </button>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right text-foreground">{r.eod ? fmt(r.eod.salesFd) : "—"}</td>
                    <td className="py-2 px-3 text-right text-foreground">{r.eod ? fmt(r.eod.salesMtd) : "—"}</td>
                    <td className="py-2 px-3 text-right text-foreground">{r.eod ? fmt(r.eod.dc) : "—"}</td>
                    <td className="py-2 px-3 text-right text-foreground">{r.eod ? r.eod.hc : "—"}</td>
                    <td className="py-2 px-3 text-right text-green-600">{r.eod ? r.eod.present : "—"}</td>
                    <td className="py-2 px-3 text-right text-red-600">{r.eod ? r.eod.absent : "—"}</td>
                    <td className="py-2 px-3 text-right text-amber-600">{r.eod ? `${shrinkPct(r.eod.hc, r.eod.present)}%` : "—"}</td>
                    <td className="py-2 px-3 text-right text-rose-600">{r.eod ? r.eod.attrition : "—"}</td>
                    <td className="py-2 pl-3 text-right text-rose-600">{r.eod ? `${attrPct(r.eod.hc, r.eod.attrition)}%` : "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border font-bold text-foreground">
                <td className="py-2 pr-3 whitespace-nowrap">Grand Total</td>
                <td className="py-2 px-3 text-right">{fmt(sumFd)}</td>
                <td className="py-2 px-3 text-right">{fmt(sumMtd)}</td>
                <td className="py-2 px-3 text-right">{fmt(sumDc)}</td>
                <td className="py-2 px-3 text-right">{sumHc}</td>
                <td className="py-2 px-3 text-right text-green-600">{sumPresent}</td>
                <td className="py-2 px-3 text-right text-red-600">{sumAbsent}</td>
                <td className="py-2 px-3 text-right text-amber-600">{avgShrink}%</td>
                <td className="py-2 px-3 text-right text-rose-600">{avgAttrCount}</td>
                <td className="py-2 pl-3 text-right text-rose-600">{avgAttrPct}%</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

export default function Eod({ currentUser }: Props) {
  const isBoss = !!currentUser && (currentUser.department === "Management" || currentUser.role === "Boss");
  const isCenterHead = !!currentUser && currentUser.role === "Center Head";
  const isMis = isAllCentersViewer(currentUser);
  const isTl = !!currentUser && currentUser.role === "Team Leader";
  const seesAll = isBoss || isMis;
  // Both Team Leaders and Center Heads manage a team, so both fill their own EOD.
  const canFill = isTl || isCenterHead;
  const canView = isBoss || isCenterHead || isMis || isTl;

  const { data: users = [] } = useListUsers();
  const myCenter = useMemo(() => users.find((u) => u.id === currentUser?.id)?.center ?? null, [users, currentUser]);

  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate, setToDate] = useState(todayStr);
  // EOD is a single-day report. A single day enables filling/editing; a multi-day
  // (or empty) window is a read-only view showing each team's latest report in it.
  const singleDay = fromDate && fromDate === toDate ? fromDate : null;
  const [selectedCenter, setSelectedCenter] = useState<string>("All");

  // Single day (the default) stays date-scoped on the server for a light payload;
  // a multi-day window fetches all and is narrowed client-side.
  const { data: eods = [], refetch } = useListEodReports(singleDay ? { date: singleDay } : {});
  const upsert = useUpsertEodReport();

  // Each EOD row belongs to one submitter. A single day has one report per submitter
  // (DB enforces a unique (submittedBy, date) index). For a multi-day window we build
  // one summary row per submitter:
  //  • Sales MTD = the PEAK (highest) month-to-date value. MTD is cumulative (each team
  //    grows it daily), so the month's real figure is its peak — NOT the latest report,
  //    whose value can drop to 0 on a reset/closing entry and wrongly wipe the month.
  //  • Everything else (Sales FD, DC, HC, Present, Absent, Attrition) = SUMMED across all
  //    days in the window, so the month view shows the period's real totals instead of a
  //    single day. Shrink%/Attr% are then derived from the summed HC/Present/Attrition,
  //    so they stay coherent (Present can't exceed HC because both are summed together),
  //    and a zero/empty closing report just adds 0 and no longer hides the month's data.
  // A single day naturally reduces every figure to that one day's report.
  const eodByUser = useMemo(() => {
    const latest = new Map<number, ExistingEod & { date: string }>();
    const sum = new Map<number, { salesFd: number; dc: number; hc: number; present: number; absent: number; attrition: number }>();
    const mtdPeak = new Map<number, number>();
    for (const e of eods) {
      if (e.submittedBy == null) continue;
      if (fromDate && e.date < fromDate) continue;
      if (toDate && e.date > toDate) continue;
      const prev = latest.get(e.submittedBy);
      if (!prev || e.date > prev.date) latest.set(e.submittedBy, e);
      const s = sum.get(e.submittedBy) ?? { salesFd: 0, dc: 0, hc: 0, present: 0, absent: 0, attrition: 0 };
      s.salesFd += e.salesFd ?? 0;
      s.dc += e.dc ?? 0;
      s.hc += e.hc ?? 0;
      s.present += e.present ?? 0;
      s.absent += e.absent ?? 0;
      s.attrition += e.attrition ?? 0;
      sum.set(e.submittedBy, s);
      mtdPeak.set(e.submittedBy, Math.max(mtdPeak.get(e.submittedBy) ?? 0, e.salesMtd ?? 0));
    }
    const map = new Map<number, ExistingEod & { date: string }>();
    for (const [id, e] of latest) {
      const s = sum.get(id);
      map.set(id, s ? {
        ...e,
        salesFd: s.salesFd,
        dc: s.dc,
        hc: s.hc,
        present: s.present,
        absent: s.absent,
        attrition: s.attrition,
        salesMtd: mtdPeak.get(id) ?? e.salesMtd,
      } : e);
    }
    return map;
  }, [eods, fromDate, toDate]);

  // Per-user center restriction (Boss/MIS only). null = no restriction.
  const allowedCenters = useMemo(
    () => resolveAllowedCenters(users.find((u) => u.id === currentUser?.id) ?? null, users),
    [users, currentUser]
  );
  // Centers visible in the consolidated view.
  const centers = useMemo(() => {
    if (seesAll) {
      const set = new Set(users.map((u) => u.center).filter((c): c is string => Boolean(c) && c !== "Head Office"));
      const rank = (c: string) => { const i = CENTER_ORDER.indexOf(c); return i === -1 ? CENTER_ORDER.length : i; };
      return Array.from(set)
        .filter((c) => !allowedCenters || allowedCenters.has(c))
        .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    }
    if (isCenterHead) return myCenter ? [myCenter] : [];
    return [];
  }, [seesAll, isCenterHead, users, myCenter, allowedCenters]);

  // Boss/MIS can filter the consolidated view down to one center.
  // If the selected center disappears from scope, fall back to "All".
  useEffect(() => {
    if (selectedCenter !== "All" && !centers.includes(selectedCenter)) setSelectedCenter("All");
  }, [centers, selectedCenter]);
  const visibleCenters = useMemo(
    () => (selectedCenter === "All" ? centers : centers.filter((c) => c === selectedCenter)),
    [selectedCenter, centers],
  );

  // Day-wise present vs absent across the selected window for the visible centers.
  const dailyEodData = useMemo(() => {
    const visible = new Set(visibleCenters);
    const byDate = new Map<string, { Present: number; Absent: number }>();
    for (const e of eods) {
      if (e.center && !visible.has(e.center)) continue;
      if (fromDate && e.date < fromDate) continue;
      if (toDate && e.date > toDate) continue;
      const d = byDate.get(e.date) ?? { Present: 0, Absent: 0 };
      d.Present += e.present ?? 0;
      d.Absent += e.absent ?? 0;
      byDate.set(e.date, d);
    }
    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({ date: date.slice(5).replace("-", "/"), ...v }));
  }, [eods, visibleCenters, fromDate, toDate]);

  // Submitter rows per center — Team Leaders and the Center Head (both fill their own team).
  const rowsByCenter = useMemo(() => {
    const map = new Map<string, TlRow[]>();
    for (const center of centers) {
      const members = users
        .filter((u) => u.center === center && (u.role === "Team Leader" || u.role === "Center Head"))
        .sort((a, b) => {
          const ah = a.role === "Center Head" ? 0 : 1;
          const bh = b.role === "Center Head" ? 0 : 1;
          return ah - bh || a.name.localeCompare(b.name);
        })
        .map((u) => ({ id: u.id, name: u.name, isHead: u.role === "Center Head", eod: eodByUser.get(u.id) }));
      map.set(center, members);
    }
    return map;
  }, [centers, users, eodByUser]);

  const save = async (v: { salesFd: number; salesMtd: number; dc: number; hc: number; present: number; absent: number; attrition: number; notes: string }) => {
    if (!currentUser || !myCenter || !singleDay) return;
    await upsert.mutateAsync({
      data: { center: myCenter, date: singleDay, salesFd: v.salesFd, salesMtd: v.salesMtd, dc: v.dc, hc: v.hc, present: v.present, absent: v.absent, attrition: v.attrition, notes: v.notes || null, submittedBy: currentUser.id },
    });
    refetch();
  };

  // Data-entry on behalf of a specific team (its submitter id + center). Boss/MIS and
  // Center Heads use this to fill or correct any team's EOD for the selected day —
  // the row is keyed by submittedBy+date on the server, so it updates that team's row.
  const saveForRow = async (
    r: TlRow,
    center: string,
    v: { salesFd: number; salesMtd: number; dc: number; hc: number; present: number; absent: number; attrition: number; notes: string },
  ) => {
    if (!singleDay) return;
    await upsert.mutateAsync({
      data: { center, date: singleDay, salesFd: v.salesFd, salesMtd: v.salesMtd, dc: v.dc, hc: v.hc, present: v.present, absent: v.absent, attrition: v.attrition, notes: v.notes || null, submittedBy: r.id },
    });
    refetch();
  };

  if (!canView) {
    return <div className="p-8 text-muted-foreground">This page is for the Boss, Center Heads, Team Leaders and MIS only.</div>;
  }

  // Grand totals across every visible center (consolidated viewers).
  const allRows = visibleCenters.flatMap((c) => rowsByCenter.get(c) ?? []);
  const allSubmitted = allRows.filter((r) => r.eod);
  const totalFd = allRows.reduce((s, r) => s + (r.eod?.salesFd ?? 0), 0);
  const totalMtd = allRows.reduce((s, r) => s + (r.eod?.salesMtd ?? 0), 0);
  const totalDc = allRows.reduce((s, r) => s + (r.eod?.dc ?? 0), 0);
  const totalHc = allRows.reduce((s, r) => s + (r.eod?.hc ?? 0), 0);
  const totalPresent = allRows.reduce((s, r) => s + (r.eod?.present ?? 0), 0);
  const totalAbsent = allRows.reduce((s, r) => s + (r.eod?.absent ?? 0), 0);
  // Shrinkage and Attrition are averaged across teams; Sales MTD is summed across teams (each team's MTD peak) — see CenterConsolidated.
  const avgAllShrink = round1(avgOf(allSubmitted.map((r) => shrinkPct(r.eod!.hc, r.eod!.present))));
  const avgAllAttrCount = round1(avgOf(allSubmitted.map((r) => r.eod!.attrition)));
  const avgAllAttrPct = round1(avgOf(allSubmitted.map((r) => attrPct(r.eod!.hc, r.eod!.attrition))));

  return (
    <div className="p-6 max-w-5xl">
      <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">MANAGEMENT TASK PRO · EOD</div>
      <h1 className="text-2xl font-bold text-foreground mb-1">EOD Report</h1>
      <p className="text-sm text-muted-foreground mb-5">
        {seesAll
          ? "Daily end-of-day across all centers — team-wise. Shrinkage and Attrition are averaged across teams; Sales FD, Sales MTD, DC and headcount are summed across teams."
          : isCenterHead
            ? "Submit your team's EOD and review your center — team-wise. Shrinkage and Attrition are averaged; Sales FD, Sales MTD, DC and headcount are summed across teams."
            : "Submit your team's end-of-day report."}
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <DateRangePicker
          disableFuture
          from={fromDate}
          to={toDate}
          onApply={({ from, to }) => {
            setFromDate(from);
            setToDate(to);
          }}
        />
        {!singleDay && (
          <span className="text-xs text-amber-600">
            For a date range every figure is totaled across the period (Sales FD, DC, HC, Present, Absent, Attrition; Shrink% and Attr% are derived from those totals). Sales MTD uses each team's month-to-date peak, then totals those peaks across teams. Pick a single day to fill or edit.
          </span>
        )}
      </div>

      {canFill && (
        !myCenter ? (
          <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">No center assigned to your account.</div>
        ) : !singleDay ? (
          <div className="bg-card border border-border rounded-xl p-6 text-center text-sm text-muted-foreground">Select a single day to submit or edit your team's EOD.</div>
        ) : (
          <TlEodCard
            teamName={currentUser ? `${currentUser.name}'s Team` : "Your Team"}
            center={myCenter}
            existing={currentUser ? eodByUser.get(currentUser.id) : undefined}
            saving={upsert.isPending}
            onSave={save}
          />
        )
      )}

      {isCenterHead && myCenter && (
        <div className="mt-6">
          <h2 className="text-sm font-bold text-foreground mb-3">Your center — team-wise summary</h2>
          <CenterConsolidated
            center={myCenter}
            rows={rowsByCenter.get(myCenter) ?? []}
            canEditRows={!!singleDay}
            onSaveRow={singleDay ? (r, v) => saveForRow(r, myCenter, v) : undefined}
            saving={upsert.isPending}
          />
        </div>
      )}

      {seesAll && (
        <>
          {centers.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 mb-5">
              <span className="text-xs font-semibold text-muted-foreground mr-1">Center</span>
              {["All", ...centers].map((c) => {
                const active = selectedCenter === c;
                return (
                  <button
                    key={c}
                    onClick={() => setSelectedCenter(c)}
                    aria-pressed={active}
                    className={`px-3.5 py-1.5 rounded-full text-sm font-semibold transition border ${active ? "bg-primary text-primary-foreground border-primary shadow" : "bg-card text-foreground border-border hover:bg-muted"}`}
                  >
                    {c === "All" ? "All Centers" : c}
                  </button>
                );
              })}
            </div>
          )}

          {visibleCenters.length > 1 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-8 gap-3 mb-5">
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-xl font-bold text-foreground">{fmt(totalFd)}</div>
                <div className="text-xs text-muted-foreground mt-1">Total Sales FD</div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-xl font-bold text-foreground">{fmt(totalMtd)}</div>
                <div className="text-xs text-muted-foreground mt-1">Total Sales MTD</div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-xl font-bold text-foreground">{fmt(totalDc)}</div>
                <div className="text-xs text-muted-foreground mt-1">Total DC</div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-xl font-bold text-foreground">{totalHc}</div>
                <div className="text-xs text-muted-foreground mt-1">Total HC</div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-xl font-bold text-green-600">{totalPresent}</div>
                <div className="text-xs text-muted-foreground mt-1">Total Present</div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-xl font-bold text-red-600">{totalAbsent}</div>
                <div className="text-xs text-muted-foreground mt-1">Total Absent</div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-xl font-bold text-amber-600">{avgAllShrink}%</div>
                <div className="text-xs text-muted-foreground mt-1">Avg Shrinkage</div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-xl font-bold text-rose-600">{avgAllAttrCount} · {avgAllAttrPct}%</div>
                <div className="text-xs text-muted-foreground mt-1">Avg Attrition</div>
              </div>
            </div>
          )}

          {dailyEodData.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5 mb-5">
              <h2 className="text-sm font-semibold text-foreground mb-3">Day-wise present vs absent</h2>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={dailyEodData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Present" fill="#10b981" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Absent" fill="#ef4444" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {visibleCenters.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">No center found.</div>
          ) : (
            <div className="space-y-4">
              {visibleCenters.map((center) => (
                <CenterConsolidated
                  key={center}
                  center={center}
                  rows={rowsByCenter.get(center) ?? []}
                  canEditRows={!!singleDay}
                  onSaveRow={singleDay ? (r, v) => saveForRow(r, center, v) : undefined}
                  saving={upsert.isPending}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
