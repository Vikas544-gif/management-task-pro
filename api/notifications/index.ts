import type { VercelRequest, VercelResponse } from "@vercel/node";
import { eq, and } from "drizzle-orm";
import { db } from "../../lib/db.js";
import { notifications } from "../../lib/schema.js";
import { requireUser } from "../../lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const me = requireUser(req, res);
  if (!me) return;

  if (req.method === "GET") {
    const { userId } = req.query;
    const targetId = userId ? Number(userId) : me.id;

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, targetId));

    return res.status(200).json(rows);
  }

  if (req.method === "POST") {
    const { userId, title, message } = req.body || {};
    if (!userId || !title) {
      return res.status(400).json({ message: "userId and title are required" });
    }

    const [created] = await db
      .insert(notifications)
      .values({ userId, title, message: message || null })
      .returning();

    return res.status(201).json(created);
  }

  if (req.method === "PATCH") {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ message: "Notification id is required" });

    const [updated] = await db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.id, id)))
      .returning();

    return res.status(200).json(updated);
  }

  return res.status(405).json({ message: "Method not allowed" });
}