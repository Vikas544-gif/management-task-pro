import { pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Categories are scoped per center: each center manages and sees its own list
// (Head Office included). Uniqueness is therefore per (center, name) — two
// centers can both have a "Work" category without colliding.
export const categoriesTable = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    color: text("color").notNull().default("#6366f1"),
    center: text("center").notNull().default("Head Office"),
  },
  (t) => [uniqueIndex("categories_center_name_unique").on(t.center, t.name)],
);

export const insertCategorySchema = createInsertSchema(categoriesTable).omit({ id: true });
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categoriesTable.$inferSelect;
