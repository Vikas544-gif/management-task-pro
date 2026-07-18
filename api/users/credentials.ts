import type { VercelRequest, VercelResponse } from "@vercel/node";
import { eq, ne, and } from "drizzle-orm";
import { db } from "../../lib/db.js";
import { users } from "../../lib/schema.js";
import { requireUser } from "../../lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const me = requireUser(req, res);
  if (!me) return;

  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  const isBoss = me.department === "Management" || me.role === "Boss";
  const isAllCentersViewer = me.department === "MIS" || me.department === "Director";
  const isCenterHead = me.role === "Center Head";

  if (!isBoss && !isAllCentersViewer && !isCenterHead) {
    return res.status(403).json({ message: "Not authorized to view credentials" });
  }

  const { center, excludeCenter } = req.query;

  let rows;
  if (isBoss) {
    rows = center
      ? await db.select().from(users).where(eq(users.center, String(center)))
      : excludeCenter
      ? await db.select().from(users).where(ne(users.center, String(excludeCenter)))
      : await db.select().from(users);
  } else if (isAllCentersViewer) {
    // MIS/Director: never Head Office, regardless of query params.
    rows = await db.select().from(users).where(ne(users.center, "Head Office"));
  } else {
    // Center Head: only their own center.
    const myCenter = me.center;
    if (!myCenter) return res.status(200).json([]);
    rows = await db.select().from(users).where(eq(users.center, myCenter));
  }

  // A Center Head never sees HR staff credentials, even in their own center.
  const filtered = isCenterHead && !isBoss && !isAllCentersViewer
    ? rows.filter((u) => u.department !== "HR")
    : rows;

  const result = filtered
    .filter((u) => !!u.username)
    .map((u) => ({ id: u.id, name: u.name, username: u.username, password: u.password }));

  return res.status(200).json(result);
}
