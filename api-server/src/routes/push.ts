import { Router } from "express";
import { db, pushSubscriptionsTable, expoPushTokensTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  SubscribePushBody,
  UnsubscribePushBody,
  SubscribeExpoPushBody,
  UnsubscribeExpoPushBody,
} from "@workspace/api-zod";
import { getVapidPublicKey } from "../lib/webPush";

const router = Router();

// Public key the browser needs to create a push subscription.
router.get("/vapid-public-key", async (_req, res) => {
  const publicKey = await getVapidPublicKey();
  return res.json({ publicKey });
});

// Register (or re-register) this browser for the logged-in user.
router.post("/subscribe", async (req, res) => {
  const parsed = SubscribePushBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid subscription payload" });
  }
  const { endpoint, keys } = parsed.data;
  const userId = req.user!.id;
  await db
    .insert(pushSubscriptionsTable)
    .values({ userId, endpoint, p256dh: keys.p256dh, auth: keys.auth })
    .onConflictDoUpdate({
      target: pushSubscriptionsTable.endpoint,
      // A shared computer may switch users — always re-own the subscription.
      set: { userId, p256dh: keys.p256dh, auth: keys.auth },
    });
  return res.json({ ok: true });
});

// Register (or re-register) a mobile device for Expo push under the logged-in user.
router.post("/expo-subscribe", async (req, res) => {
  const parsed = SubscribeExpoPushBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid Expo token payload" });
  }
  const { token } = parsed.data;
  // Always own the token for the caller — a shared phone may switch users.
  const userId = req.user!.id;
  await db
    .insert(expoPushTokensTable)
    .values({ userId, token })
    .onConflictDoUpdate({
      target: expoPushTokensTable.token,
      set: { userId },
    });
  return res.json({ success: true });
});

// Remove a mobile device's Expo token (only the caller's own row).
router.post("/expo-unsubscribe", async (req, res) => {
  const parsed = UnsubscribeExpoPushBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }
  await db
    .delete(expoPushTokensTable)
    .where(
      and(
        eq(expoPushTokensTable.token, parsed.data.token),
        eq(expoPushTokensTable.userId, req.user!.id)
      )
    );
  return res.json({ success: true });
});

// Remove this browser's subscription (only the owner's own row).
router.post("/unsubscribe", async (req, res) => {
  const parsed = UnsubscribePushBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }
  await db
    .delete(pushSubscriptionsTable)
    .where(
      and(
        eq(pushSubscriptionsTable.endpoint, parsed.data.endpoint),
        eq(pushSubscriptionsTable.userId, req.user!.id)
      )
    );
  return res.json({ ok: true });
});

export default router;
