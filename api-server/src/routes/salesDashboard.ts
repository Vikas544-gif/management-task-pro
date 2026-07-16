import { Router, type IRouter, type Request } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { buildPayload, seedRawTables } from "@workspace/sales-dashboard-data";
import {
  readRawTablesFromSheet,
  isSheetConfigured,
  writeSheetCells,
  type SalesCellEdit,
  type MandaysCellEdit,
} from "../lib/sheetSource";
import { requireAuth, requireBossOrMis, SESSION_COOKIE, type AuthUser } from "../middlewares/auth";
import { isBoss, isAllCentersViewer } from "../lib/scope";
import { getAuthEpoch } from "../lib/authEpoch";

const router: IRouter = Router();

// Public, mostly-one-way data feed for the standalone Sales Performance
// Dashboard. Reads come from the Google Sheet (or the bundled seed); authorized
// staff (Boss / MIS / Director) can also write key figures BACK to the same
// Sheet via POST /update. Derived totals / percentages / rankings are computed
// here in code (buildPayload), never stored in the Sheet.
//
// Micro-cache: the dashboard polls /data every few seconds per open tab, so a
// short shared TTL keeps the Google Sheets API well under its per-minute read
// quota no matter how many viewers are online, while still surfacing Sheet
// edits within seconds. Only SUCCESSFUL reads are cached — failures keep the
// explicit 502 contract (never silently serve stale data beyond the TTL). A
// write-back clears the cache so the editor sees their change on the next poll.
const CACHE_TTL_MS = 4_000;
let cached: { at: number; payload: unknown } | null = null;

router.get("/data", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      res.json(cached.payload);
      return;
    }
    let raw = seedRawTables;
    let skippedRows: string[] = [];
    if (isSheetConfigured()) {
      const result = await readRawTablesFromSheet();
      raw = result.tables;
      skippedRows = result.skippedRows;
      if (skippedRows.length) {
        req.log.warn(
          { skippedRows },
          "Sales dashboard: skipped unparseable Google Sheet rows",
        );
      }
    }
    const payload = { ...buildPayload(raw), skippedRows };
    cached = { at: Date.now(), payload };
    res.json(payload);
  } catch (err) {
    req.log.error({ err }, "Failed to load sales dashboard data from Google Sheet");
    res.status(502).json({ error: "Unable to load dashboard data from the source Google Sheet." });
  }
});

// Optionally resolve the logged-in user from the signed session cookie WITHOUT
// rejecting anonymous viewers — the dashboard is public, so a viewer with no
// (or an expired) session is simply treated as read-only. Mirrors the checks in
// requireAuth but returns null instead of sending a 401.
async function userFromCookie(req: Request): Promise<AuthUser | null> {
  const raw = req.signedCookies?.[SESSION_COOKIE];
  const [uidStr, epochStr] = String(raw ?? "").split(".");
  const uid = parseInt(uidStr, 10);
  if (!raw || Number.isNaN(uid)) return null;
  const cookieEpoch = parseInt(epochStr ?? "", 10);
  const currentEpoch = await getAuthEpoch();
  if (Number.isNaN(cookieEpoch) || cookieEpoch !== currentEpoch) return null;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, uid));
  return user ?? null;
}

function canEdit(u: AuthUser | null): boolean {
  return !!u && (isBoss(u) || isAllCentersViewer(u));
}

// Public: lets the standalone dashboard decide whether to show its editing UI.
// Anonymous viewers get { canEdit: false } (never a 401) so the read-only
// dashboard keeps working without a login.
router.get("/session", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const user = await userFromCookie(req);
  res.json({
    authenticated: !!user,
    canEdit: canEdit(user),
    name: user?.name ?? null,
  });
});

// Write-back: authorized staff (Boss / MIS / Director) edit key figures from
// the dashboard and they land in the same Google Sheet. Gated with the same
// role set the app uses for its oversight pages. Editing requires the Sheet to
// be the source of record — with only the bundled seed there is nowhere to
// persist to, so we refuse rather than silently drop the edit.
router.post("/update", requireAuth, requireBossOrMis, async (req, res) => {
  if (!isSheetConfigured()) {
    res.status(409).json({
      error: "Editing is unavailable because no Google Sheet is connected as the source of record.",
    });
    return;
  }

  const errors: string[] = [];

  const isMonth = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z]{3}-\d{2}$/.test(v);
  const numField = (
    label: string,
    v: unknown,
    { allowNull = false }: { allowNull?: boolean } = {},
  ): number | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null) {
      if (allowNull) return null;
      errors.push(`${label} cannot be blank`);
      return undefined;
    }
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      errors.push(`${label} must be a non-negative number`);
      return undefined;
    }
    return v;
  };

  const body = req.body as { sales?: unknown; mandays?: unknown };

  const salesEdits: SalesCellEdit[] = [];
  if (body.sales !== undefined) {
    if (!Array.isArray(body.sales)) {
      errors.push("sales must be an array");
    } else {
      for (const rawEdit of body.sales as Record<string, unknown>[]) {
        const fy = rawEdit?.fy;
        const series = rawEdit?.series;
        const month = rawEdit?.month;
        if (fy !== "FY1" && fy !== "FY2") { errors.push("sales.fy must be FY1 or FY2"); continue; }
        if (typeof series !== "string" || !series.trim()) { errors.push("sales.series is required"); continue; }
        if (!isMonth(month)) { errors.push(`sales.month "${String(month)}" must look like Apr-25`); continue; }
        const edit: SalesCellEdit = { fy, series: series.trim(), month };
        const target = numField("sales.target", rawEdit.target);
        const actual = numField("sales.actual", rawEdit.actual, { allowNull: true });
        if (target !== undefined && target !== null) edit.target = target;
        if (actual !== undefined) edit.actual = actual;
        if (edit.target === undefined && edit.actual === undefined) continue; // nothing to change
        salesEdits.push(edit);
      }
    }
  }

  const mandaysEdits: MandaysCellEdit[] = [];
  if (body.mandays !== undefined) {
    if (!Array.isArray(body.mandays)) {
      errors.push("mandays must be an array");
    } else {
      for (const rawEdit of body.mandays as Record<string, unknown>[]) {
        const center = rawEdit?.center;
        const month = rawEdit?.month;
        if (typeof center !== "string" || !center.trim()) { errors.push("mandays.center is required"); continue; }
        if (!isMonth(month)) { errors.push(`mandays.month "${String(month)}" must look like Apr-25`); continue; }
        const edit: MandaysCellEdit = { center: center.trim(), month };
        for (const field of ["mandays", "sales", "conv", "leads"] as const) {
          const v = numField(`mandays.${field}`, rawEdit[field]);
          if (v !== undefined && v !== null) edit[field] = v;
        }
        if (
          edit.mandays === undefined &&
          edit.sales === undefined &&
          edit.conv === undefined &&
          edit.leads === undefined
        ) continue;
        mandaysEdits.push(edit);
      }
    }
  }

  if (errors.length) {
    res.status(400).json({ error: "Invalid edit", details: errors });
    return;
  }
  if (!salesEdits.length && !mandaysEdits.length) {
    res.status(400).json({ error: "No changes to save." });
    return;
  }

  try {
    const { updated } = await writeSheetCells({ sales: salesEdits, mandays: mandaysEdits });
    // Drop the read cache so the next /data poll reflects the write immediately
    // (rather than serving up to TTL-old numbers from before the edit).
    cached = null;
    req.log.info(
      { by: req.user?.id, updated, sales: salesEdits.length, mandays: mandaysEdits.length },
      "Sales dashboard: wrote edits back to Google Sheet",
    );
    res.json({ success: true, updated });
  } catch (err) {
    // A "no matching row" error means the edit's key columns don't exist in the
    // Sheet (a client/data mismatch, not a Sheet outage) — surface it as a 400
    // with the specific key so it's actionable, rather than a generic 502.
    const msg = err instanceof Error ? err.message : String(err);
    if (/^No (Sales|Mandays) row for /.test(msg)) {
      req.log.warn({ err }, "Sales dashboard: edit did not match an existing Sheet row");
      res.status(400).json({ error: msg });
      return;
    }
    req.log.error({ err }, "Failed to write sales dashboard edits to Google Sheet");
    res.status(502).json({ error: "Unable to save changes to the source Google Sheet." });
  }
});

export default router;
