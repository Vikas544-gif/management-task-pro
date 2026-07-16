import { db } from "@workspace/db";
import {
  complianceCompaniesTable,
  complianceItemsTable,
  complianceStatusTable,
  tasksTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

// The compliance task generator mirrors each Compliance Calendar activity into a
// real task per period. These helpers keep the two completion stores in sync:
// the per-(company, period) compliance grid, and the single task's status.
//
// Both directions write to the database directly (never via each other's HTTP
// handlers), so there is no request recursion between the tasks and compliance
// routes.

// The set of company keys that currently have a visible, tickable cell in the
// Compliance Calendar grid. Must mirror Compliance.tsx: only companies still on
// the active master list render a cell, so a soft-deactivated company must not
// block (or contribute to) a row's completion.
async function activeCompanyNames(): Promise<Set<string>> {
  const rows = await db
    .select({ name: complianceCompaniesTable.name })
    .from(complianceCompaniesTable)
    .where(eq(complianceCompaniesTable.active, true));
  return new Set(rows.map((r) => r.name));
}

// A compliance item applies to its listed companies, or — when the list is
// empty — to the single company-agnostic "ALL" bucket. Listed companies are
// narrowed to those still active so the task and the grid agree on completion
// (a removed company has no cell to tick, so it can't be "applicable"). "ALL"
// is a special bucket, not a master company, so it is never filtered.
function applicableCompanies(companies: string[], active: Set<string>): string[] {
  return companies.length ? companies.filter((c) => active.has(c)) : ["ALL"];
}

// Forward sync: when a compliance-linked task is completed (or reopened), record
// that completion against every applicable company for the task's period. A task
// is activity-level, so marking it done marks the whole activity done across all
// its companies for that period (per-company nuance still lives in the calendar).
export async function syncComplianceStatusFromTask(
  task: { complianceItemId: number | null; lastRunDate: string | null; status: string },
  actorId: number,
): Promise<void> {
  if (task.complianceItemId == null || !task.lastRunDate) return;

  const [item] = await db
    .select({ companies: complianceItemsTable.companies })
    .from(complianceItemsTable)
    .where(eq(complianceItemsTable.id, task.complianceItemId));
  if (!item) return;

  const active = await activeCompanyNames();
  const done = task.status === "done";
  const now = new Date();
  for (const company of applicableCompanies(item.companies, active)) {
    await db
      .insert(complianceStatusTable)
      .values({
        itemId: task.complianceItemId,
        company,
        periodKey: task.lastRunDate,
        done,
        doneBy: done ? actorId : null,
        doneAt: done ? now : null,
      })
      .onConflictDoUpdate({
        target: [complianceStatusTable.itemId, complianceStatusTable.company, complianceStatusTable.periodKey],
        set: { done, doneBy: done ? actorId : null, doneAt: done ? now : null, updatedAt: now },
      });
  }
}

// Reverse sync: after a per-company tick changes in the calendar, flip the
// mirrored task to done only when every applicable company is done for that
// period, otherwise back to pending. No-op when no mirrored task exists yet.
export async function syncTaskFromComplianceStatus(itemId: number, periodKey: string): Promise<void> {
  const [item] = await db
    .select({ companies: complianceItemsTable.companies })
    .from(complianceItemsTable)
    .where(eq(complianceItemsTable.id, itemId));
  if (!item) return;

  const statuses = await db
    .select({ company: complianceStatusTable.company, done: complianceStatusTable.done })
    .from(complianceStatusTable)
    .where(and(eq(complianceStatusTable.itemId, itemId), eq(complianceStatusTable.periodKey, periodKey)));
  const active = await activeCompanyNames();
  const doneSet = new Set(statuses.filter((s) => s.done).map((s) => s.company));
  const allDone = applicableCompanies(item.companies, active).every((c) => doneSet.has(c));

  await db
    .update(tasksTable)
    .set({ status: allDone ? "done" : "pending", updatedAt: new Date() })
    .where(and(eq(tasksTable.complianceItemId, itemId), eq(tasksTable.lastRunDate, periodKey)));
}
