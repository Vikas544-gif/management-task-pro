import { pgTable, serial, text, integer, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Master list of statutory compliance activities the Accounts team runs across
// the group's companies. `companies` holds the company keys a row applies to;
// an EMPTY array means the activity is company-agnostic (filed once, not split
// per company). `frequency` is one of Daily | Weekly | Monthly | Quarterly |
// Annual. `dueDateText` is the human rule ("6th of next month", "31-Jul",
// "Every Wednesday") which the UI parses to a concrete date for highlighting.
export const complianceItemsTable = pgTable("compliance_items", {
  id: serial("id").primaryKey(),
  compliance: text("compliance").notNull(),
  activity: text("activity"),
  dueDateText: text("due_date_text"),
  frequency: text("frequency").notNull(),
  companies: text("companies").array().notNull(),
  assignedTo: integer("assigned_to"),
  sortOrder: integer("sort_order").notNull().default(0),
  // Soft-delete flag. Deactivated items are hidden from the calendar grid but
  // kept so historical completion statuses stay attributable and they can be
  // reactivated. Editing the master list is done in-app, not via code/seed.
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Per-period completion of a compliance activity, tracked separately for each
// applicable company. `company` is the company key, or "ALL" for company-agnostic
// items. `periodKey` identifies the cycle (e.g. "2026-06", "2026-Q2", "2026",
// "2026-W26", "2026-06-29") so the same activity is ticked fresh each period.
export const complianceStatusTable = pgTable(
  "compliance_status",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id").notNull(),
    company: text("company").notNull(),
    periodKey: text("period_key").notNull(),
    done: boolean("done").notNull().default(false),
    doneBy: integer("done_by"),
    doneAt: timestamp("done_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("compliance_status_item_company_period_uq").on(table.itemId, table.company, table.periodKey)]
);

// Master list of company keys the compliance grid is split by. Editable in-app
// so a new group company can be added without a code change. Deactivation is
// soft (kept so historical statuses under that company key stay attributable).
export const complianceCompaniesTable = pgTable("compliance_companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertComplianceCompanySchema = createInsertSchema(complianceCompaniesTable).omit({ id: true, createdAt: true });
export type InsertComplianceCompany = z.infer<typeof insertComplianceCompanySchema>;
export type ComplianceCompany = typeof complianceCompaniesTable.$inferSelect;

export const insertComplianceItemSchema = createInsertSchema(complianceItemsTable).omit({ id: true, createdAt: true });
export type InsertComplianceItem = z.infer<typeof insertComplianceItemSchema>;
export type ComplianceItem = typeof complianceItemsTable.$inferSelect;

export const insertComplianceStatusSchema = createInsertSchema(complianceStatusTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertComplianceStatus = z.infer<typeof insertComplianceStatusSchema>;
export type ComplianceStatus = typeof complianceStatusTable.$inferSelect;
