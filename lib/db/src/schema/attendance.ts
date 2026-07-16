import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const attendanceTable = pgTable(
  "attendance",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD (IST)
    status: text("status").notNull().default("present"), // present | absent | half_day | leave
    center: text("center"),
    markedBy: integer("marked_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // One attendance row per user per day.
    uniqueIndex("attendance_user_date_uq").on(table.userId, table.date),
  ]
);

export const insertAttendanceSchema = createInsertSchema(attendanceTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Attendance = typeof attendanceTable.$inferSelect;
