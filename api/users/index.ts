import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import { db } from "../../lib/db.js";
import { users } from "../../lib/schema.js";
import { requireUser } from "../../lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const me = requireUser(req, res);
  if (!me) return; // requireUser already sent 401

  if (req.method === "GET") {
    const all = await db.select().from(users);
    // Never send password hashes to the client.
    const safe = all.map(({ password, passwordPlain, ...rest }) => rest);
    return res.status(200).json(safe);
  }

  if (req.method === "POST") {
    const { username, password, name, email, role, department, center, reportsTo } = req.body || {};
    if (!username || !password || !name) {
      return res.status(400).json({ message: "username, password and name are required" });
    }
    const hash = await bcrypt.hash(password, 10);
    try {
      const [created] = await db
        .insert(users)
        .values({
          username,
          password: hash,
          passwordPlain: password,
          name,
          email: email || null,
          role: role || "Employee",
          department: department || "General",
          center: center || null,
          reportsTo: reportsTo ?? null,
        })
        .returning();
      const { password: _pw, passwordPlain: _pwp, ...safe } = created;
      return res.status(201).json(safe);
    } catch (e: any) {
      if (String(e?.message || "").includes("unique")) {
        return res.status(409).json({ message: "This username is already taken" });
      }
      console.error(e);
      return res.status(500).json({ message: "Could not create user" });
    }
  }

  return res.status(405).json({ message: "Method not allowed" });
}
