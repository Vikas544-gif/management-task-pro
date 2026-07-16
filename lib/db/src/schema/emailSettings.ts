import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const emailSettingsTable = pgTable("email_settings", {
  id: serial("id").primaryKey(),
  smtpEmail: text("smtp_email").notNull(),
  smtpPassword: text("smtp_password").notNull(),
  smtpHost: text("smtp_host").notNull().default("smtp-mail.outlook.com"),
  smtpPort: integer("smtp_port").notNull().default(587),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEmailSettingsSchema = createInsertSchema(emailSettingsTable).omit({ id: true, updatedAt: true });
export type InsertEmailSettings = z.infer<typeof insertEmailSettingsSchema>;
export type EmailSettings = typeof emailSettingsTable.$inferSelect;
