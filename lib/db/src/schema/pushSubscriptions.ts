import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Web Push subscriptions — one row per browser the user enabled popups on.
 * `endpoint` is unique per browser subscription; re-subscribing upserts.
 */
export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type PushSubscriptionRow = typeof pushSubscriptionsTable.$inferSelect;
