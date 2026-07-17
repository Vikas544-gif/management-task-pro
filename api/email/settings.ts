import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db } from "../../lib/db.js";
import { emailSettings } from "../../lib/schema.js";
import { requireUser } from "../../lib/auth.js";

const FROM_EMAIL = "noreply@infinityservicesindia.com";
const FROM = `Management Task Pro <${FROM_EMAIL}>`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const me = requireUser(req, res);
  if (!me) return;

  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  const [row] = await db.select().from(emailSettings).limit(1);
  const configured = Boolean(process.env.RESEND_API_KEY);

  return res.status(200).json({
    id: row?.id,
    smtpEmail: configured ? FROM : (row?.smtpEmail ?? undefined),
    configured,
  });
}
