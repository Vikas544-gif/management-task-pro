import { pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Public holiday list (Head Office is off on these days). `date` is an IST
// calendar day "YYYY-MM-DD". `type` is one of:
//   - "full"    : full-day holiday (office closed)
//   - "half"    : half-day holiday
//   - "weekend" : holiday that already falls on a Saturday/Sunday
export const holidaysTable = pgTable(
  "holidays",
  {
    id: serial("id").primaryKey(),
    date: text("date").notNull(),
    name: text("name").notNull(),
    day: text("day").notNull(),
    type: text("type").notNull().default("full"),
  },
  (table) => [uniqueIndex("holidays_date_uq").on(table.date)],
);

export const insertHolidaySchema = createInsertSchema(holidaysTable).omit({ id: true });
export type InsertHoliday = z.infer<typeof insertHolidaySchema>;
export type Holiday = typeof holidaysTable.$inferSelect;
