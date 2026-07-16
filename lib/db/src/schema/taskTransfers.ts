import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Audit trail of task reassignments. Each row records that a task moved from
// one holder to another. Used so a person who had a task reassigned away from
// them (before completing it) shows a "minus" against their name, while the new
// assignee gets normal completion credit — visible to their manager + Boss.
export const taskTransfersTable = pgTable("task_transfers", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  fromUserId: integer("from_user_id").notNull(),
  toUserId: integer("to_user_id").notNull(),
  transferredBy: integer("transferred_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTaskTransferSchema = createInsertSchema(taskTransfersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertTaskTransfer = z.infer<typeof insertTaskTransferSchema>;
export type TaskTransfer = typeof taskTransfersTable.$inferSelect;
