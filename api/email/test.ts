import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import { requireUser } from "../../lib/auth.js";

const FROM = "Management Task Pro <noreply@infinityservicesindia.com>";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const me = requireUser(req, res);
  if (!me) return;

  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  if (!process.env.RESEND_API_KEY) {
    return res.status(200).json({ success: false, message: "RESEND_API_KEY is not set in Vercel yet" });
  }

  const { toEmail } = req.body || {};
  if (!toEmail) return res.status(400).json({ success: false, message: "Recipient email is required" });

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: toEmail,
      subject: "Test email — Management Task Pro",
      html: `<p>This is a test email. If you're reading this, email sending is working! ✅</p>`,
    });
    return res.status(200).json({ success: true, message: "Test email sent successfully" });
  } catch (e: any) {
    return res.status(200).json({ success: false, message: e?.message || "Failed to send test email" });
  }
}
