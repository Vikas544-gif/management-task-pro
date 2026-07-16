export type FYKey = "FY1" | "FY2";

export interface SalesRow {
  fy: FYKey;
  series: string;
  month: string;
  target: number;
  actual: number | null;
}

export interface HcBranchRow {
  branch: string;
  month: string;
  counsellors: number;
  joining: number;
  attrition: number;
}

export interface HcCenterTotalRow {
  center: string;
  target: number;
  actual: number;
  net: number;
  best: string;
}

export interface MandaysRow {
  center: string;
  month: string;
  mandays: number;
  sales: number;
  conv: number;
  leads: number;
}

export type AgentRow = [
  agent: string,
  tl: string,
  center: string,
  doj: string,
  tenure: string,
  month: string,
  leads: number,
  calls: number,
  dc: number,
  sales: number,
];

export interface RawTables {
  sales: SalesRow[];
  hcBranch: HcBranchRow[];
  hcCenterTotals: HcCenterTotalRow[];
  mandays: MandaysRow[];
  agents: AgentRow[];
}

export interface Series {
  proj: number[];
  actual: (number | null)[];
}

export interface FY1Payload {
  months: string[];
  Overall: Series;
  Pune: Series;
  Malad: Series;
  Thane: Series;
  Airoli: Series;
}

export interface FY2Payload {
  months: string[];
  Overall: Series;
  Pune: Series;
  Malad: Series;
  Thane: Series;
  NaviMumbai: Series;
}

export interface SPPayload {
  months: string[];
  ALL: Series;
  Pune: Series;
  Malad: Series;
  Thane: Series;
  Airoli: Series;
  centers: string[];
  colors: Record<string, string>;
}

export interface HcBranchSeries {
  counsellors: number[];
  joining: number[];
  attrition: number[];
}

export interface HcCenterTotal {
  proj: number;
  actual: number;
  net: number;
  best: string;
  ach: string;
}

export interface MdCenterSeries {
  mandays: number[];
  sales: number[];
  conv: number[];
  leads: number[];
}

export interface DashboardPayload {
  FY1: FY1Payload;
  FY2: FY2Payload;
  SP_FY1: SPPayload;
  SP_FY2: SPPayload;
  HC_BRANCH_DATA: Record<string, HcBranchSeries>;
  HC_CENTER_TOTALS: Record<string, HcCenterTotal>;
  MD_CENTER_DATA: Record<string, MdCenterSeries>;
  MD_CONV: Record<string, number[]>;
  ATL_RAW: AgentRow[];
}
