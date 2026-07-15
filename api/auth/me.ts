import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionUser } from "../../lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ message: "Not authenticated" });
  return res.status(200).json(user);
}
