import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db } from "./db.js";
import { pushSubscriptions } from "./schema.js";

let configured = false;
function ensureConfigured() {
  if (configured) return;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      "mailto:noreply@infinityservicesindia.com",
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    configured = true;
  }
}

/** Send a background browser push notification to every device a user has subscribed on. */
export async function sendPushToUser(userId: number, title: string, body: string) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  ensureConfigured();

  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  const payload = JSON.stringify({ title, body });

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    } catch (e: any) {
      // 410/404 means the browser unsubscribed or expired — clean it up.
      if (e?.statusCode === 410 || e?.statusCode === 404) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint));
      } else {
        console.error("Push send failed:", e?.message || e);
      }
    }
  }
}
