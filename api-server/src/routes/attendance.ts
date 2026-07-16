import { Router } from "express";
import { db } from "@workspace/db";
import { attendanceTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { UpsertAttendanceBody } from "@workspace/api-zod";

const router = Router();

router.get("/", async (req, res) => {
  const { date, center } = req.query;
  const rows = await db.select().from(attendanceTable).orderBy(desc(attendanceTable.date));
  let filtered = rows;
  if (date) filtered = filtered.filter((r) => r.date === (date as string));
  if (center) filtered = filtered.filter((r) => r.center === (center as string));
  const users = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
  const userMap = new Map(users.map((u) => [u.id, u.name]));
  res.json(
    filtered.map((r) => ({
      ...r,
      userName: userMap.get(r.userId) ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))
  );
});

router.post("/", async (req, res) => {
  const parsed = UpsertAttendanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid attendance data", details: parsed.error.issues });
    return;
  }
  const { userId, date, status, center, markedBy } = parsed.data;
  const [row] = await db
    .insert(attendanceTable)
    .values({ userId, date, status, center: center ?? null, markedBy: markedBy ?? null })
    .onConflictDoUpdate({
      target: [attendanceTable.userId, attendanceTable.date],
      set: { status, center: center ?? null, markedBy: markedBy ?? null, updatedAt: new Date() },
    })
    .returning();
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, row.userId));
  res.json({
    ...row,
    userName: u?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
});

export default router;
