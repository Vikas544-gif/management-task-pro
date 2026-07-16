import { Router } from "express";
import { db } from "@workspace/db";
import { eodReportsTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { UpsertEodReportBody } from "@workspace/api-zod";
import { isBoss, isAllCentersViewer, isCenterHead, HEAD_OFFICE, allowedCentersFor } from "../lib/scope";

const router = Router();

router.get("/", async (req, res) => {
  const { date, center } = req.query;
  const me = req.user!;

  // Center boundary is enforced from the *authenticated session user*, never the
  // caller-supplied `center` query param, so disallowed-center EOD data can't be
  // pulled via a direct API call:
  //   - Boss/Management: all centers.
  //   - Center Head / Team Leader: only their own center (both fill their team's EOD).
  //   - MIS/Director: every center except Head Office.
  //   - Anyone else: forbidden.
  const allUsers = await db.select({ center: usersTable.center }).from(usersTable);
  const allCenters = new Set(
    allUsers.map((u) => u.center).filter((c): c is string => Boolean(c)),
  );
  let roleCenters: Set<string> | null;
  if (isBoss(me)) {
    roleCenters = null; // all
  } else if (isCenterHead(me) || me.role === "Team Leader") {
    roleCenters = new Set(me.center ? [me.center] : []);
  } else if (isAllCentersViewer(me)) {
    roleCenters = new Set([...allCenters]);
    roleCenters.delete(HEAD_OFFICE);
  } else {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  // Per-user center restriction (Boss/MIS only) narrows the role ceiling further.
  const allowed = allowedCentersFor(me, allUsers);
  let effective: Set<string> | null = roleCenters;
  if (allowed) {
    effective = roleCenters ? new Set([...roleCenters].filter((c) => allowed.has(c))) : allowed;
  }

  const rows = await db.select().from(eodReportsTable).orderBy(desc(eodReportsTable.date));
  let filtered = rows;
  if (effective) filtered = filtered.filter((r) => r.center != null && effective!.has(r.center));
  if (date) filtered = filtered.filter((r) => r.date === (date as string));
  if (center) filtered = filtered.filter((r) => r.center === (center as string));
  const users = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
  const userMap = new Map(users.map((u) => [u.id, u.name]));
  res.json(
    filtered.map((r) => ({
      ...r,
      submittedByName: r.submittedBy ? (userMap.get(r.submittedBy) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))
  );
});

router.post("/", async (req, res) => {
  const parsed = UpsertEodReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid EOD data", details: parsed.error.issues });
    return;
  }
  const { center, date, salesFd, salesMtd, dc, hc, present, absent, attrition, notes, submittedBy } = parsed.data;

  // Write authorization mirrors the GET scope, enforced from the session user —
  // never from the caller-supplied `center`/`submittedBy` fields:
  //   - Boss/Management: may submit/correct any team's EOD.
  //   - MIS/Director: any center except Head Office.
  //   - Center Head: only rows for their own center.
  //   - Team Leader: only their OWN row, in their own center.
  //   - Anyone else: forbidden.
  const me = req.user!;
  if (isBoss(me)) {
    // all centers, any submitter
  } else if (isAllCentersViewer(me)) {
    if (center === HEAD_OFFICE) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  } else if (isCenterHead(me)) {
    if (!me.center || center !== me.center) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  } else if (me.role === "Team Leader") {
    if (!me.center || center !== me.center || submittedBy !== me.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  } else {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const [row] = await db
    .insert(eodReportsTable)
    .values({ center, date, salesFd, salesMtd, dc, hc, present, absent, attrition, notes: notes ?? null, submittedBy })
    .onConflictDoUpdate({
      target: [eodReportsTable.submittedBy, eodReportsTable.date],
      set: { center, salesFd, salesMtd, dc, hc, present, absent, attrition, notes: notes ?? null, updatedAt: new Date() },
    })
    .returning();
  const [u] = row.submittedBy
    ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, row.submittedBy))
    : [undefined];
  res.json({
    ...row,
    submittedByName: u?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
});

export default router;
