import type { VercelRequest, VercelResponse } from "@vercel/node";
import { eq } from "drizzle-orm";
import { db } from "../../lib/db.js";
import { attendance, users } from "../../lib/schema.js";
import { requireUser } from "../../lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const me = requireUser(req, res);
  if (!me) return;

  if (req.method === "GET") {
    const { userId } = req.query;
    const rows = userId
      ? await db.select().from(attendance).where(eq(attendance.userId, Number(userId)))
      : await db.select().from(attendance);

    const allUsers = await db.select().from(users);
    const nameOf = new Map(allUsers.map((u) => [u.id, u.name]));
    const enriched = rows.map((r) => ({ ...r, userName: nameOf.get(r.userId) ?? null }));

    return res.status(200).json(enriched);
  }

  if (req.method === "POST") {
    const { userId, date, status, note } = req.body || {};
    if (!userId || !date || !status) {
      return res.status(400).json({ message: "userId, date and status are required" });
    }

    const [created] = await db
      .insert(attendance)
      .values({ userId, date, status, note: note || null })
      .returning();

    return res.status(201).json(created);
  }

  return res.status(405).json({ message: "Method not allowed" });
}