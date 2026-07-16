import { Router } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

function serialize(n: typeof notificationsTable.$inferSelect) {
  return { ...n, createdAt: n.createdAt.toISOString() };
}

router.get("/", async (req, res) => {
  // Always scope to the authenticated user — never trust a client-supplied id,
  // otherwise anyone could read another user's notifications.
  const userId = req.user!.id;
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, userId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);
  return res.json(rows.map(serialize));
});

router.patch("/:id/read", async (req, res) => {
  const id = parseInt(req.params.id);
  // Ownership enforced: only the owner's own notification can be marked read.
  const [row] = await db
    .update(notificationsTable)
    .set({ read: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, req.user!.id)))
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(serialize(row));
});

router.post("/read-all", async (req, res) => {
  // Always the authenticated user — never trust a client-supplied id.
  const userId = req.user!.id;
  await db
    .update(notificationsTable)
    .set({ read: true })
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.read, false)));
  return res.json({ success: true });
});

router.post("/clear-all", async (req, res) => {
  const userId = req.user!.id;
  await db
    .delete(notificationsTable)
    .where(eq(notificationsTable.userId, userId));
  return res.json({ success: true });
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  // Ownership enforced so a user can only delete their own notification.
  await db
    .delete(notificationsTable)
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, req.user!.id)));
  return res.json({ success: true });
});

export default router;
