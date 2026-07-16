import webpush from "web-push";
import { db, appSettingsTable, pushSubscriptionsTable, notificationsTable, expoPushTokensTable } from "@workspace/db";
import type { InsertNotification } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Expo push (native phone banners, even when the app is closed).
 * Sent via Expo's push service — no server SDK/dependency needed, just HTTPS.
 * Fire-and-forget: never blocks or fails the request. Tokens that Expo reports
 * as DeviceNotRegistered are pruned so the table stays clean.
 */
async function sendExpoPushToUser(
  userId: number,
  payload: { title: string; body: string; data?: Record<string, unknown> },
): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(expoPushTokensTable)
      .where(eq(expoPushTokensTable.userId, userId));
    if (!rows.length) return;

    // ONE request PER token, not one batched request. Expo rejects a whole
    // batch with 400 PUSH_TOO_MANY_EXPERIENCE_IDS when tokens from different
    // projects are mixed (e.g. a stale token from an APK built on the old
    // Expo account alongside tokens from the current one) — which silently
    // killed delivery to EVERY device. Per-token requests isolate bad tokens.
    const dead: string[] = [];
    await Promise.all(
      rows.map(async (r) => {
        const message = {
          to: r.token,
          title: payload.title,
          body: payload.body,
          sound: "default" as const,
          priority: "high" as const,
          ...(payload.data ? { data: payload.data } : {}),
        };
        const resp = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify([message]),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          logger.warn(
            { status: resp.status, userId, body: body.slice(0, 500) },
            "Expo push request failed",
          );
          return;
        }
        const json = (await resp.json()) as { data?: Array<{ status: string; details?: { error?: string } }> };
        const ticket = json.data?.[0];
        if (ticket?.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
          dead.push(r.token);
        }
      }),
    );
    if (dead.length) {
      await db.delete(expoPushTokensTable).where(inArray(expoPushTokensTable.token, dead));
    }
  } catch (err) {
    logger.warn({ err, userId }, "Expo push skipped (send failed)");
  }
}

/**
 * Web Push (background browser popups).
 *
 * VAPID keys are generated once per environment and persisted in app_settings,
 * so dev and production each keep a stable key pair — changing keys would
 * silently break every existing browser subscription.
 */
const VAPID_PUBLIC_KEY = "vapidPublicKey";
const VAPID_PRIVATE_KEY = "vapidPrivateKey";
const VAPID_SUBJECT = "mailto:notifications@task-pro.app";

let vapidPublicKey: string | null = null;
let vapidReady: Promise<string> | null = null;

async function ensureVapid(): Promise<string> {
  if (vapidPublicKey) return vapidPublicKey;
  if (!vapidReady) {
    vapidReady = (async () => {
      const rows = await db
        .select()
        .from(appSettingsTable)
        .where(inArray(appSettingsTable.key, [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY]));
      let pub = rows.find((r) => r.key === VAPID_PUBLIC_KEY)?.value;
      let priv = rows.find((r) => r.key === VAPID_PRIVATE_KEY)?.value;
      if (!pub || !priv) {
        const keys = webpush.generateVAPIDKeys();
        pub = keys.publicKey;
        priv = keys.privateKey;
        await db
          .insert(appSettingsTable)
          .values([
            { key: VAPID_PUBLIC_KEY, value: pub },
            { key: VAPID_PRIVATE_KEY, value: priv },
          ])
          .onConflictDoNothing();
        // Another instance may have won the race — re-read the canonical pair.
        const again = await db
          .select()
          .from(appSettingsTable)
          .where(inArray(appSettingsTable.key, [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY]));
        pub = again.find((r) => r.key === VAPID_PUBLIC_KEY)?.value ?? pub;
        priv = again.find((r) => r.key === VAPID_PRIVATE_KEY)?.value ?? priv;
        logger.info("Generated new VAPID key pair for web push");
      }
      webpush.setVapidDetails(VAPID_SUBJECT, pub, priv);
      vapidPublicKey = pub;
      return pub;
    })().catch((err) => {
      vapidReady = null; // allow retry on next call
      throw err;
    });
  }
  return vapidReady;
}

export async function getVapidPublicKey(): Promise<string> {
  return ensureVapid();
}

/**
 * Best-effort web push to every browser a user subscribed from.
 * Expired/revoked subscriptions (404/410) are pruned automatically.
 * Never throws — push failures must not break the calling flow.
 */
export async function sendPushToUser(
  userId: number,
  payload: { title: string; body: string; url?: string }
): Promise<void> {
  try {
    await ensureVapid();
    const subs = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.userId, userId));
    if (!subs.length) return;
    const json = JSON.stringify(payload);
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            json
          );
        } catch (err: unknown) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await db
              .delete(pushSubscriptionsTable)
              .where(eq(pushSubscriptionsTable.id, s.id))
              .catch(() => {});
          } else {
            logger.warn({ err, userId, subId: s.id }, "Web push send failed");
          }
        }
      })
    );
  } catch (err) {
    logger.warn({ err, userId }, "Web push skipped (setup failed)");
  }
}

/**
 * Central notification creator: inserts the in-app notification row(s) AND
 * fires a background web push to each recipient. Use this instead of raw
 * `db.insert(notificationsTable)` so popups reach users even when the tab
 * is closed.
 */
export async function createNotifications(rows: InsertNotification[]): Promise<void> {
  if (!rows.length) return;
  await db.insert(notificationsTable).values(rows);
  // Push is fire-and-forget — never block or fail the request on it.
  for (const row of rows) {
    void sendPushToUser(row.userId, {
      title: "Management Task Pro",
      body: row.message,
      url: "/",
    });
    void sendExpoPushToUser(row.userId, {
      title: "Management Task Pro",
      body: row.message,
      // Tapping the phone notification deep-links straight to the task.
      ...(row.taskId ? { data: { taskId: row.taskId } } : {}),
    });
  }
}
