import type { VercelRequest, VercelResponse } from "@vercel/node";
import { eq } from "drizzle-orm";
import { db } from "../../lib/db.js";
import { pushSubscriptions } from "../../lib/schema.js";
import { requireUser } from "../../lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const me = requireUser(req, res);
  if (!me) return;

  const route = String(req.query.route || "");

  if (route === "vapid-public-key" && req.method === "GET") {
    return res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY || "" });
  }

  if (route === "subscribe" && req.method === "POST") {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ success: false });
    }
    try {
      await db
        .insert(pushSubscriptions)
        .values({ userId: me.id, endpoint, p256dh: keys.p256dh, auth: keys.auth })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: { userId: me.id, p256dh: keys.p256dh, auth: keys.auth },
        });
      return res.status(200).json({ success: true });
    } catch (e) {
      console.error("Push subscribe failed:", e);
      return res.status(200).json({ success: false });
    }
  }

  if (route === "unsubscribe" && req.method === "POST") {
    const { endpoint } = req.body || {};
    if (endpoint) {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    }
    return res.status(200).json({ success: true });
  }

  return res.status(404).json({ message: "Not found" });
}
