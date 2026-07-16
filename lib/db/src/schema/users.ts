import { pgTable, serial, text, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  username: text("username").unique(),
  password: text("password"),
  department: text("department").notNull(),
  center: text("center").notNull().default("Head Office"),
  reportsTo: integer("reports_to"),
  email: text("email"),
  doj: text("doj"), // Date of joining, YYYY-MM-DD
  status: text("status").notNull().default("Active"), // Active | Inactive
  // Whether this user appears in the "Assign Task" picker. Soft visibility
  // toggle controlled by Boss/MIS — does NOT affect login or anything else.
  assignable: boolean("assignable").notNull().default(true),
  // Whether recurring tasks are auto-generated for this user. FALSE means the
  // scheduler (daily/weekly/monthly generation + Thane weekly seed + self-serve
  // "Generate Today's Tasks") skips this person entirely, and the boot cleanup
  // keeps them permanently task-free. Controlled by Boss/MIS on Access Control.
  autoTasksEnabled: boolean("auto_tasks_enabled").notNull().default(true),
  // Per-user page/section access override. NULL = use role-based defaults.
  // A non-null array is the explicit list of route hrefs this user may access.
  // Controlled by Boss/MIS/Director on the Access Control page.
  pagePermissions: jsonb("page_permissions").$type<string[]>(),
  // Per-user center access override (Boss/MIS-level viewers only). NULL = use
  // the role's default center scope. A non-null array narrows which company
  // centers this viewer may see. Restriction-only: it can never widen beyond
  // the role ceiling (MIS/Director never gain Head Office).
  // Controlled by Boss/MIS/Director on the Access Control page.
  centerPermissions: jsonb("center_permissions").$type<string[]>(),
  // Per-user override for WHO appears in this user's "Assign Task" picker.
  // NULL = use the default scoping (role/center rules + hardcoded audience).
  // A non-null array is the explicit list of user IDs this person may assign to
  // (everyone else is hidden from their picker). Controlled by Boss/MIS/Director
  // on the Access Control page.
  assignVisibleUserIds: jsonb("assign_visible_user_ids").$type<number[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
