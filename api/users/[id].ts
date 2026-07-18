import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../../lib/db.js";
import { users } from "../../lib/schema.js";
import { requireUser } from "../../lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const me = requireUser(req, res);
  if (!me) return;

  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ message: "Invalid user id" });

  if (req.method === "GET") {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) return res.status(404).json({ message: "User not found" });
    const { password, passwordPlain, ...safe } = user;
    return res.status(200).json(safe);
  }

  if (req.method === "PATCH" || req.method === "PUT") {
    const { name, email, role, department, center, reportsTo, active, password } = req.body || {};
    const update: Record<string, unknown> = {};
    if (name !== undefined) update.name = name;
    if (email !== undefined) update.email = email;
    if (role !== undefined) update.role = role;
    if (department !== undefined) update.department = department;
    if (center !== undefined) update.center = center;
    if (reportsTo !== undefined) update.reportsTo = reportsTo;
    if (active !== undefined) update.active = active;
    if (password) {
      update.password = await bcrypt.hash(password, 10);
      update.passwordPlain = password;
    }

    const [updated] = await db.update(users).set(update).where(eq(users.id, id)).returning();
    if (!updated) return res.status(404).json({ message: "User not found" });
    const { password: _pw, passwordPlain: _pwp, ...safe } = updated;
    return res.status(200).json(safe);
  }

  if (req.method === "DELETE") {
    // Soft-delete: mark inactive instead of removing (keeps task history intact).
    const [updated] = await db.update(users).set({ active: false }).where(eq(users.id, id)).returning();
    if (!updated) return res.status(404).json({ message: "User not found" });
    return res.status(200).json({ message: "User deactivated" });
  }

  return res.status(405).json({ message: "Method not allowed" });
}
