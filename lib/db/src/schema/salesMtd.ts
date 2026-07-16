import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// One Sales MTD row per user per month. `amount` is the month-to-date figure the
// person enters and overwrites daily — it is NOT a sum of daily entries (summing
// would double-count and inflate the number). `lastDate` records the last day it
// was updated. `target` is the optional monthly goal set by a manager.
export const salesMtdTable = pgTable(
  "sales_mtd",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    month: text("month").notNull(), // YYYY-MM (IST)
    amount: integer("amount"), // current month-to-date figure
    target: integer("target"), // optional monthly goal
    lastDate: text("last_date"), // YYYY-MM-DD of last amount update
    updatedBy: integer("updated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("sales_mtd_user_month_uq").on(table.userId, table.month)]
);

export const insertSalesMtdSchema = createInsertSchema(salesMtdTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSalesMtd = z.infer<typeof insertSalesMtdSchema>;
export type SalesMtd = typeof salesMtdTable.$inferSelect;
