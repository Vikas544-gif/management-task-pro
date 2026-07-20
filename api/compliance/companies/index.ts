import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db } from "../../../lib/db.js";
import { complianceCompanies } from "../../../lib/schema.js";
import { requireUser } from "../../../lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const me = requireUser(req, res);
  if (!me) return;

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

  return res.status(405).json({ message: "Method not allowed" });
}