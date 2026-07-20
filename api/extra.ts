import type { VercelRequest, VercelResponse } from "@vercel/node";
import { eq, and } from "drizzle-orm";
import { db } from "../lib/db.js";
import { attendance, categories, complianceCompanies, notifications, users } from "../lib/schema.js";
import { requireUser } from "../lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const me = requireUser(req, res);
  if (!me) return;

  const resource = String(req.query.resource || "");

  // ── ATTENDANCE ──────────────────────────────────────────────────────
  if (resource === "attendance") {
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
  }

  // ── CATEGORIES ──────────────────────────────────────────────────────
  if (resource === "categories") {
    if (req.method === "GET") {
      const all = await db.select().from(categories);
      return res.status(200).json(all);
    }

    if (req.method === "POST") {
      const { name } = req.body || {};
      if (!name) return res.status(400).json({ message: "Category name is required" });
      const [created] = await db.insert(categories).values({ name }).returning();
      return res.status(201).json(created);
    }
  }

  // ── COMPLIANCE COMPANIES ────────────────────────────────────────────
  if (resource === "complianceCompanies") {
    if (req.method === "GET") {
      const all = await db.select().from(complianceCompanies);
      return res.status(200).json(all);
    }

    if (req.method === "POST") {
      const { name, gstDueDay, tdsDueDay, notes } = req.body || {};
      if (!name) return res.status(400).json({ message: "Company name is required" });
      const [created] = await db
        .insert(complianceCompanies)
        .values({
          name,
          gstDueDay: gstDueDay ?? null,
          tdsDueDay: tdsDueDay ?? null,
          notes: notes || null,
        })
        .returning();
      return res.status(201).json(created);
    }
  }

  // ── NOTIFICATIONS ───────────────────────────────────────────────────
  if (resource === "notifications") {
    if (req.method === "GET") {
      const { userId } = req.query;
      const targetId = userId ? Number(userId) : me.id;
      const rows = await db.select().from(notifications).where(eq(notifications.userId, targetId));
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
  }

  return res.status(404).json({ message: "Unknown resource or method" });
}