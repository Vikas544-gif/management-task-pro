import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import { db } from "../../lib/db.js";
import { users } from "../../lib/schema.js";
/**
 * One-time setup: creates the first Boss login, ONLY if the users table is
 * currently empty. After the first user exists, this always returns 403 —
 * so it's safe to leave deployed. Call it once after deploying:
 *
 *   curl -X POST https://your-app.vercel.app/api/auth/bootstrap \
 *     -H "Content-Type: application/json" \
 *     -d '{"username":"admin","password":"changeme123","name":"Vikas Gupta","secret":"YOUR_BOOTSTRAP_SECRET"}'
 *
 * BOOTSTRAP_SECRET must match the env var you set in Vercel, so a stranger
 * can't race you to create the first (Boss) account.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // --- CORS handling (must come first) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  // --- end CORS handling ---

  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });
  const { username, password, name, secret } = req.body || {};
  if (secret !== process.env.BOOTSTRAP_SECRET) {
    return res.status(403).json({ message: "Invalid bootstrap secret" });
  }
  if (!username || !password || !name) {
    return res.status(400).json({ message: "username, password and name are required" });
  }
  const existing = await db.select().from(users).limit(1);
  if (existing.length > 0) {
    return res.status(403).json({ message: "Setup already complete — a user already exists." });
  }
  const hash = await bcrypt.hash(password, 10);
  const [created] = await db
    .insert(users)
    .values({
      username,
      password: hash,
      name,
      role: "Boss",
      department: "Management",
      center: "Head Office",
    })
    .returning();
  return res.status(201).json({ id: created.id, username: created.username, name: created.name });
}
