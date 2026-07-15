import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../../lib/db.js";
import { users } from "../../lib/schema.js";
import { signSession, setSessionCookie } from "../../lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required" });
  }

  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (!user || !user.active) {
    return res.status(401).json({ message: "Invalid username or password" });
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    return res.status(401).json({ message: "Invalid username or password" });
  }

  const sessionUser = {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    department: user.department,
    center: user.center,
  };

  setSessionCookie(res, signSession(sessionUser));
  return res.status(200).json(sessionUser);
}
