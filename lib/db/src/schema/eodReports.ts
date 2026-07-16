import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const eodReportsTable = pgTable(
  "eod_reports",
  {
    id: serial("id").primaryKey(),
    center: text("center").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD (IST)
    salesFd: integer("sales_fd").notNull().default(0), // Sales For the Day (rupees)
    salesMtd: integer("sales_mtd").notNull().default(0), // Sales Month To Date (rupees)
    dc: integer("dc").notNull().default(0), // DC (rupees)
    hc: integer("hc").notNull().default(0), // Team headcount (manual, filled by each Team Leader)
    present: integer("present").notNull().default(0), // Present count (manual)
    absent: integer("absent").notNull().default(0), // Absent count (manual)
    attrition: integer("attrition").notNull().default(0), // Attrition count — team members who left (manual)
    notes: text("notes"),
    submittedBy: integer("submitted_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // One EOD report per Team Leader per day (each TL fills their own team's figures).
    uniqueIndex("eod_user_date_uq").on(table.submittedBy, table.date),
  ]
);

export const insertEodReportSchema = createInsertSchema(eodReportsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEodReport = z.infer<typeof insertEodReportSchema>;
export type EodReport = typeof eodReportsTable.$inferSelect;
