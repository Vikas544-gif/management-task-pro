import { Router } from "express";
import { db } from "@workspace/db";
import { holidaysTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { CreateHolidayBody } from "@workspace/api-zod";
import { isBoss, isAllCentersViewer } from "../lib/scope";

const router = Router();

// Holidays are informational and visible to everyone (Head Office is off on
// these days). Only Boss / MIS-level admins can add or remove entries.
router.get("/", async (_req, res) => {
  const rows = await db.select().from(holidaysTable).orderBy(asc(holidaysTable.date));
  res.json(rows);
});

router.post("/", async (req, res) => {
  const me = req.user!;
  if (!isBoss(me) && !isAllCentersViewer(me)) return res.status(403).json({ error: "Forbidden" });
  const parsed = CreateHolidayBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  const [row] = await db
    .insert(holidaysTable)
    .values(parsed.data)
    .onConflictDoUpdate({
      target: holidaysTable.date,
      set: { name: parsed.data.name, day: parsed.data.day, type: parsed.data.type },
    })
    .returning();
  return res.status(201).json(row);
});

router.delete("/:id", async (req, res) => {
  const me = req.user!;
  if (!isBoss(me) && !isAllCentersViewer(me)) return res.status(403).json({ error: "Forbidden" });
  const id = parseInt(req.params.id);
  await db.delete(holidaysTable).where(eq(holidaysTable.id, id));
  return res.json({ success: true });
});

export default router;
