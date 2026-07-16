import type {
  RawTables,
  SalesRow,
  HcBranchRow,
  HcCenterTotalRow,
  MandaysRow,
  AgentRow,
  FYKey,
} from "@workspace/sales-dashboard-data";

// One-way source of truth: a private Google Sheet, read via the Replit
// google-sheet connector. When GOOGLE_SHEET_ID is unset the route falls back to
// the bundled seed (current numbers); when it is set, a read failure surfaces as
// a 502 rather than silently serving stale data.

const TABS = {
  sales: "Sales!A2:E",
  hcBranch: "Headcount_Branch!A2:E",
  hcCenterTotals: "Headcount_CenterTotals!A2:E",
  mandays: "Mandays!A2:F",
  agents: "Agents!A2:J",
} as const;

export function isSheetConfigured(): boolean {
  return !!process.env.GOOGLE_SHEET_ID;
}

async function getAccessToken(): Promise<string> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;
  if (!hostname || !xReplitToken) {
    throw new Error("Replit connector runtime environment is not available.");
  }
  const res = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=google-sheet`,
    { headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken } },
  );
  if (!res.ok) {
    throw new Error(`Connector lookup failed (${res.status}).`);
  }
  const data = (await res.json()) as {
    items?: { settings?: { access_token?: string; oauth?: { credentials?: { access_token?: string } } } }[];
  };
  const item = data.items?.[0];
  const token =
    item?.settings?.access_token ?? item?.settings?.oauth?.credentials?.access_token;
  if (!token) {
    throw new Error("No Google Sheets access token found on the connector.");
  }
  return token;
}

// Strip common human formatting (currency symbols, thousands separators,
// percent signs, stray whitespace) before parsing, so "₹1,200" or "85%" still
// count as numbers. Anything that's still not numeric throws, which causes the
// individual ROW to be skipped (see mapRows) rather than failing the whole read.
const cleanNumeric = (v: unknown): string =>
  String(v ?? "")
    .trim()
    .replace(/[₹$€£,%\s]/g, "");

const num = (v: unknown): number => {
  const s = cleanNumeric(v);
  const n = Number(s);
  if (s === "" || Number.isNaN(n)) throw new Error(`Expected a number, got "${String(v)}"`);
  return n;
};
const numOrNull = (v: unknown): number | null => {
  const s = cleanNumeric(v);
  if (s === "") return null;
  const n = Number(s);
  if (Number.isNaN(n)) throw new Error(`Expected a number or blank, got "${String(v)}"`);
  return n;
};
const str = (v: unknown): string => String(v ?? "").trim();

// ── Canonicalization (shared by the read and write paths) ──────────────────
// The Sheet is hand-edited, so series names arrive with inconsistent
// spacing/casing (e.g. "Navi Mumbai" vs "NaviMumbai"). Canonicalize the known
// series so the payload keys — and the row matching done on write-back — stay
// stable.
const SERIES_CANON: Record<string, string> = {
  overall: "Overall",
  pune: "Pune",
  malad: "Malad",
  thane: "Thane",
  airoli: "Airoli",
  navimumbai: "NaviMumbai",
};
const canonSeries = (s: string): string => {
  const t = s.trim();
  return SERIES_CANON[t.replace(/\s+/g, "").toLowerCase()] ?? t;
};

// The API reads with UNFORMATTED_VALUE, so if a hand-edited cell is a real date
// (instead of text like "Apr-25") it arrives as an Excel serial number
// (e.g. 45748). Convert serials back to the canonical string formats the
// dashboard expects: months as "Apr-25", full dates as "01-Apr-25".
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const serialToUTCDate = (n: number): Date =>
  new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
// Only treat values as date serials when they fall in a plausible range
// (36526 = 2000-01-01, 73050 = ~2099-12-31) so legit numeric strings in these
// columns never get mis-converted.
const isSerial = (s: string): boolean => {
  if (!/^\d{5}(\.\d+)?$/.test(s)) return false;
  const n = Number(s);
  return n >= 36526 && n <= 73050;
};
const canonMonth = (v: unknown): string => {
  const s = String(v ?? "").trim();
  if (!isSerial(s)) return s;
  const d = serialToUTCDate(Number(s));
  const yy = String(d.getUTCFullYear() % 100).padStart(2, "0");
  return `${MONTH_NAMES[d.getUTCMonth()]}-${yy}`;
};
const canonDate = (v: unknown): string => {
  const s = String(v ?? "").trim();
  if (!isSerial(s)) return s;
  const d = serialToUTCDate(Number(s));
  const yy = String(d.getUTCFullYear() % 100).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${dd}-${MONTH_NAMES[d.getUTCMonth()]}-${yy}`;
};

// Map sheet rows to typed rows, skipping (and recording) any row whose cells
// can't be coerced instead of failing the entire dashboard payload.
function mapRows<T>(
  tab: string,
  rawRows: unknown[][],
  mapper: (r: unknown[]) => T,
  skipped: string[],
): T[] {
  const out: T[] = [];
  rawRows.forEach((r, i) => {
    if (str(r[0]) === "") return;
    try {
      out.push(mapper(r));
    } catch (err) {
      // +2: sheet data starts at row 2 (row 1 is the header)
      skipped.push(
        `${tab} row ${i + 2}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
  return out;
}

export interface SheetReadResult {
  tables: RawTables;
  skippedRows: string[];
}

export async function readRawTablesFromSheet(): Promise<SheetReadResult> {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error("GOOGLE_SHEET_ID is not set.");
  const token = await getAccessToken();

  const ranges = Object.values(TABS).map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Google Sheets API error (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { valueRanges?: { values?: unknown[][] }[] };
  const vr = body.valueRanges ?? [];
  const rows = (i: number): unknown[][] => vr[i]?.values ?? [];

  const skippedRows: string[] = [];

  const sales: SalesRow[] = mapRows(
    "Sales",
    rows(0),
    (r) => ({
      fy: str(r[0]) as FYKey,
      series: canonSeries(str(r[1])),
      month: canonMonth(r[2]),
      target: num(r[3]),
      actual: numOrNull(r[4]),
    }),
    skippedRows,
  );

  const hcBranch: HcBranchRow[] = mapRows(
    "Headcount_Branch",
    rows(1),
    (r) => ({
      branch: str(r[0]),
      month: canonMonth(r[1]),
      counsellors: num(r[2]),
      joining: num(r[3]),
      attrition: num(r[4]),
    }),
    skippedRows,
  );

  const hcCenterTotals: HcCenterTotalRow[] = mapRows(
    "Headcount_CenterTotals",
    rows(2),
    (r) => ({
      center: str(r[0]),
      target: num(r[1]),
      actual: num(r[2]),
      net: num(r[3]),
      best: str(r[4]),
    }),
    skippedRows,
  );

  const mandays: MandaysRow[] = mapRows(
    "Mandays",
    rows(3),
    (r) => ({
      center: str(r[0]),
      month: canonMonth(r[1]),
      mandays: num(r[2]),
      sales: num(r[3]),
      conv: num(r[4]),
      leads: num(r[5]),
    }),
    skippedRows,
  );

  const agents: AgentRow[] = mapRows(
    "Agents",
    rows(4),
    (r) =>
      [
        str(r[0]),
        str(r[1]),
        str(r[2]),
        canonDate(r[3]),
        str(r[4]),
        canonMonth(r[5]),
        num(r[6]),
        num(r[7]),
        num(r[8]),
        num(r[9]),
      ] as AgentRow,
    skippedRows,
  );

  // Real breakage (missing/renamed tab, or every row unparseable) must still
  // surface as an error rather than rendering an empty dashboard.
  const missing: string[] = [];
  if (!sales.length) missing.push("Sales");
  if (!mandays.length) missing.push("Mandays");
  if (!agents.length) missing.push("Agents");
  if (missing.length) {
    const detail = skippedRows.length
      ? ` All rows failed to parse: ${skippedRows.slice(0, 5).join("; ")}`
      : "";
    throw new Error(
      `Google Sheet returned no usable rows for required tab(s): ${missing.join(", ")}.${detail}`,
    );
  }

  return { tables: { sales, hcBranch, hcCenterTotals, mandays, agents }, skippedRows };
}

// ── Write-back (dashboard → Sheet) ─────────────────────────────────────────
// Authorized staff can edit key figures from inside the dashboard; those edits
// are written straight back to the same Google Sheet that feeds it. The write
// path targets individual CELLS (matched to their row by the key columns) and
// never rewrites whole rows/tabs, so concurrent editors touching different
// cells don't clobber each other — same cell is last-write-wins.

export interface SalesCellEdit {
  fy: string; // "FY1" | "FY2"
  series: string; // Overall / Pune / Malad / Thane / Airoli / NaviMumbai
  month: string; // "Apr-25"
  target?: number;
  actual?: number | null; // null clears the cell (YTD "not yet")
}

export interface MandaysCellEdit {
  center: string; // ALL / Pune / Malad / Thane / Airoli
  month: string; // "Apr-25"
  mandays?: number;
  sales?: number;
  conv?: number;
  leads?: number;
}

export interface SheetWriteRequest {
  sales?: SalesCellEdit[];
  mandays?: MandaysCellEdit[];
}

// Column letters for the numeric fields in each tab (A2-based ranges).
//   Sales:   A fy | B series | C month | D target | E actual
//   Mandays: A center | B month | C mandays | D sales | E conv | F leads
const SALES_COLS = { target: "D", actual: "E" } as const;
const MANDAYS_COLS = { mandays: "C", sales: "D", conv: "E", leads: "F" } as const;

async function readTabValues(
  sheetId: string,
  token: string,
  range: string,
): Promise<unknown[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Google Sheets read error (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { values?: unknown[][] };
  return body.values ?? [];
}

interface ValueRangeUpdate {
  range: string;
  values: (number | string)[][];
}

/**
 * Write the given edits back to the Sheet. Each edit is resolved to a specific
 * cell by matching its key columns (canonicalized the same way the read path
 * canonicalizes them) against the current tab contents; if any edit can't be
 * matched to an existing row the whole request fails BEFORE anything is written
 * (so a bad key never half-applies). Returns the number of cells updated.
 */
export async function writeSheetCells(reqBody: SheetWriteRequest): Promise<{ updated: number }> {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error("GOOGLE_SHEET_ID is not set.");
  const token = await getAccessToken();

  const data: ValueRangeUpdate[] = [];

  if (reqBody.sales?.length) {
    const rows = await readTabValues(sheetId, token, "Sales!A2:E");
    for (const e of reqBody.sales) {
      const fy = str(e.fy);
      const series = canonSeries(str(e.series));
      const month = canonMonth(e.month);
      const idx = rows.findIndex(
        (r) =>
          str(r[0]) === fy &&
          canonSeries(str(r[1])) === series &&
          canonMonth(r[2]) === month,
      );
      if (idx === -1) {
        throw new Error(`No Sales row for ${fy} / ${e.series} / ${e.month}.`);
      }
      const rowNum = idx + 2; // header is row 1, A2:E starts at row 2
      if (e.target !== undefined) {
        data.push({ range: `Sales!${SALES_COLS.target}${rowNum}`, values: [[e.target]] });
      }
      if (e.actual !== undefined) {
        data.push({ range: `Sales!${SALES_COLS.actual}${rowNum}`, values: [[e.actual ?? ""]] });
      }
    }
  }

  if (reqBody.mandays?.length) {
    const rows = await readTabValues(sheetId, token, "Mandays!A2:F");
    for (const e of reqBody.mandays) {
      const center = str(e.center);
      const month = canonMonth(e.month);
      const idx = rows.findIndex(
        (r) => str(r[0]) === center && canonMonth(r[1]) === month,
      );
      if (idx === -1) {
        throw new Error(`No Mandays row for ${center} / ${e.month}.`);
      }
      const rowNum = idx + 2;
      for (const field of ["mandays", "sales", "conv", "leads"] as const) {
        const v = e[field];
        if (v !== undefined) {
          data.push({ range: `Mandays!${MANDAYS_COLS[field]}${rowNum}`, values: [[v]] });
        }
      }
    }
  }

  if (!data.length) return { updated: 0 };

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ valueInputOption: "RAW", data }),
  });
  if (!res.ok) {
    throw new Error(`Google Sheets write error (${res.status}): ${await res.text()}`);
  }
  return { updated: data.length };
}
