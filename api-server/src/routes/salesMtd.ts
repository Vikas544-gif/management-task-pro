import { Router } from "express";
import { db } from "@workspace/db";
import { salesMtdTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { UpsertSalesMtdBody } from "@workspace/api-zod";

const router = Router();

router.get("/", async (req, res) => {
  const { month } = req.query;
  const rows = month
    ? await db.select().from(salesMtdTable).where(eq(salesMtdTable.month, month as string)).orderBy(desc(salesMtdTable.month))
    : await db.select().from(salesMtdTable).orderBy(desc(salesMtdTable.month));
  const users = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
  const userMap = new Map(users.map((u) => [u.id, u.name]));
  res.json(
    rows.map((r) => ({
      ...r,
      userName: userMap.get(r.userId) ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))
  );
});

router.post("/", async (req, res) => {
  const parsed = UpsertSalesMtdBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid sales MTD data", details: parsed.error.issues });
    return;
  }
  const { userId, month, amount, target, lastDate, updatedBy } = parsed.data;

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    res.status(400).json({ error: "Invalid month — expected YYYY-MM" });
    return;
  }
  if (lastDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(lastDate)) {
    res.status(400).json({ error: "Invalid lastDate — expected YYYY-MM-DD" });
    return;
  }
  if (amount != null && (!Number.isInteger(amount) || amount < 0)) {
    res.status(400).json({ error: "Invalid amount — expected a non-negative whole number" });
    return;
  }
  if (target != null && (!Number.isInteger(target) || target < 0)) {
    res.status(400).json({ error: "Invalid target — expected a non-negative whole number" });
    return;
  }

  // Only overwrite fields that were actually sent: a manager setting a target must
  // not wipe the person's amount, and a person updating their amount must not wipe
  // a target. `amount` is the current month-to-date figure (overwritten, never summed).
  const insertValues = {
    userId,
    month,
    amount: amount ?? null,
    target: target ?? null,
    lastDate: lastDate ?? null,
    updatedBy: updatedBy ?? null,
  };
  const updateSet: Record<string, unknown> = { updatedBy: updatedBy ?? null, updatedAt: new Date() };
  if (amount !== undefined) updateSet.amount = amount ?? null;
  if (target !== undefined) updateSet.target = target ?? null;
  if (lastDate !== undefined) updateSet.lastDate = lastDate ?? null;

  const [row] = await db
    .insert(salesMtdTable)
    .values(insertValues)
    .onConflictDoUpdate({ target: [salesMtdTable.userId, salesMtdTable.month], set: updateSet })
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
