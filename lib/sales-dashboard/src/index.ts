import type {
  RawTables,
  DashboardPayload,
  Series,
  HcBranchSeries,
  MdCenterSeries,
  HcCenterTotal,
} from "./types.js";

export * from "./types.js";
export { seedRawTables } from "./seed.js";

const FY1_MONTHS = [
  "Apr-25", "May-25", "Jun-25", "Jul-25", "Aug-25", "Sep-25",
  "Oct-25", "Nov-25", "Dec-25", "Jan-26", "Feb-26", "Mar-26",
];
const FY2_MONTHS = [
  "Apr-26", "May-26", "Jun-26", "Jul-26", "Aug-26", "Sep-26",
  "Oct-26", "Nov-26", "Dec-26", "Jan-27", "Feb-27", "Mar-27",
];

const round1 = (x: number): number => Math.round(x * 10) / 10;

function groupSeries(
  rows: { series?: string; month: string; target: number; actual: number | null }[],
): Series {
  return {
    proj: rows.map((r) => r.target),
    actual: rows.map((r) => r.actual),
  };
}

export function buildPayload(raw: RawTables): DashboardPayload {
  // ── Sales → FY1 / FY2 / SP_FY1 / SP_FY2 ──
  const fySeries: Record<string, Record<string, Series>> = { FY1: {}, FY2: {} };
  for (const fy of ["FY1", "FY2"] as const) {
    const rows = raw.sales.filter((r) => r.fy === fy);
    const seriesNames = [...new Set(rows.map((r) => r.series))];
    for (const s of seriesNames) {
      fySeries[fy][s] = groupSeries(rows.filter((r) => r.series === s));
    }
  }

  const FY1 = {
    months: FY1_MONTHS,
    Overall: fySeries.FY1.Overall,
    Pune: fySeries.FY1.Pune,
    Malad: fySeries.FY1.Malad,
    Thane: fySeries.FY1.Thane,
    Airoli: fySeries.FY1.Airoli,
  };
  const FY2 = {
    months: FY2_MONTHS,
    Overall: fySeries.FY2.Overall,
    Pune: fySeries.FY2.Pune,
    Malad: fySeries.FY2.Malad,
    Thane: fySeries.FY2.Thane,
    NaviMumbai: fySeries.FY2.NaviMumbai,
  };
  const SP_FY1 = {
    months: FY1_MONTHS,
    ALL: FY1.Overall,
    Pune: FY1.Pune,
    Malad: FY1.Malad,
    Thane: FY1.Thane,
    Airoli: FY1.Airoli,
    centers: ["Pune", "Malad", "Thane", "Airoli"],
    colors: { Pune: "#a78bfa", Malad: "#ff4d6d", Thane: "#00d4ff", Airoli: "#00e676" },
  };
  const SP_FY2 = {
    months: FY2_MONTHS,
    ALL: FY2.Overall,
    Pune: FY2.Pune,
    Malad: FY2.Malad,
    Thane: FY2.Thane,
    Airoli: FY2.NaviMumbai,
    centers: ["Pune", "Malad", "Thane", "Airoli"],
    colors: { Pune: "#a78bfa", Malad: "#ff4d6d", Thane: "#00d4ff", Airoli: "#ff9f43" },
  };

  // ── Headcount branch ──
  const HC_BRANCH_DATA: Record<string, HcBranchSeries> = {};
  for (const r of raw.hcBranch) {
    const d = (HC_BRANCH_DATA[r.branch] ??= { counsellors: [], joining: [], attrition: [] });
    d.counsellors.push(r.counsellors);
    d.joining.push(r.joining);
    d.attrition.push(r.attrition);
  }

  // ── Headcount center totals (ach computed in code) ──
  const HC_CENTER_TOTALS: Record<string, HcCenterTotal> = {};
  for (const r of raw.hcCenterTotals) {
    HC_CENTER_TOTALS[r.center] = {
      proj: r.target,
      actual: r.actual,
      net: r.net,
      best: r.best,
      ach: round1((r.actual / r.target) * 100).toFixed(1) + "%",
    };
  }

  // ── Mandays ──
  const MD_CENTER_DATA: Record<string, MdCenterSeries> = {};
  for (const r of raw.mandays) {
    const d = (MD_CENTER_DATA[r.center] ??= { mandays: [], sales: [], conv: [], leads: [] });
    d.mandays.push(r.mandays);
    d.sales.push(r.sales);
    d.conv.push(r.conv);
    d.leads.push(r.leads);
  }
  const MD_CONV: Record<string, number[]> = {
    Pune: MD_CENTER_DATA.Pune.conv,
    Malad: MD_CENTER_DATA.Malad.conv,
    Thane: MD_CENTER_DATA.Thane.conv,
    Airoli: MD_CENTER_DATA.Airoli.conv,
  };

  return {
    FY1,
    FY2,
    SP_FY1,
    SP_FY2,
    HC_BRANCH_DATA,
    HC_CENTER_TOTALS,
    MD_CENTER_DATA,
    MD_CONV,
    ATL_RAW: raw.agents,
  };
}
