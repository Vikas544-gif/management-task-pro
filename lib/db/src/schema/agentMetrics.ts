import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const agentMetricsTable = pgTable(
  "agent_metrics",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD (IST)
    dc: integer("dc"),
    prospectCount: integer("prospect_count"),
    salesFd: integer("sales_fd"),
    salesMtd: integer("sales_mtd"),
    target: integer("target"),
    last3mAvg: integer("last3m_avg"),
    last6mAvg: integer("last6m_avg"),
    remark: text("remark"),
    updatedBy: integer("updated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // One metrics row per agent per day.
    uniqueIndex("agent_metrics_agent_date_uq").on(table.agentId, table.date),
  ]
);

export const insertAgentMetricSchema = createInsertSchema(agentMetricsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAgentMetric = z.infer<typeof insertAgentMetricSchema>;
export type AgentMetric = typeof agentMetricsTable.$inferSelect;
