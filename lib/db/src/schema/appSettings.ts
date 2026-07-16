import { pgTable, text } from "drizzle-orm/pg-core";

/**
 * Global key/value application settings (single shared row per key).
 * Currently used to store the `authEpoch` — bumping it invalidates every
 * existing session cookie at once (admin "force everyone to re-login").
 */
export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
