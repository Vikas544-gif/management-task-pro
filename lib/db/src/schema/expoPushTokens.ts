import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Expo push tokens — one row per mobile device the user enabled push on.
 * `token` (an ExponentPushToken[...]) is unique per device; re-registering
 * upserts and re-owns the row for the current user (shared-device safe).
 */
export const expoPushTokensTable = pgTable("expo_push_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertExpoPushTokenSchema = createInsertSchema(expoPushTokensTable).omit({
  id: true,
  createdAt: true,
});
export type InsertExpoPushToken = z.infer<typeof insertExpoPushTokenSchema>;
export type ExpoPushTokenRow = typeof expoPushTokensTable.$inferSelect;
