import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db } from "../../lib/db.js";
import { categories } from "../../lib/schema.js";
import { requireUser } from "../../lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const me = requireUser(req, res);
  if (!me) return;

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

  return res.status(405).json({ message: "Method not allowed" });
}