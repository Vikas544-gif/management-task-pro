import { Router } from "express";
import { db } from "@workspace/db";
import { complianceItemsTable, complianceStatusTable, complianceCompaniesTable, usersTable } from "@workspace/db";
import { eq, asc, sql } from "drizzle-orm";
import {
  ToggleComplianceStatusBody,
  CreateComplianceItemBody,
  UpdateComplianceItemBody,
  CreateComplianceCompanyBody,
} from "@workspace/api-zod";
import type { AuthUser } from "../middlewares/auth";
import { isBoss, isAllCentersViewer, buildHierarchySet } from "../lib/scope";
import { sendComplianceAssignmentEmail } from "../lib/emailService";
import { syncTaskFromComplianceStatus } from "../lib/complianceSync";
import { createNotifications } from "../lib/webPush";

const router = Router();

// Compliance is an Accounts-team workspace. Access is limited to the Accounts
// department plus the people who oversee everything: the Boss and all-centers
// viewers (MIS / Director). Everyone else is forbidden.
function canAccessCompliance(u?: AuthUser): boolean {
  if (!u) return false;
  if (u.role === "Boss" || u.department === "Management") return true;
  if (u.department === "MIS" || u.department === "Director") return true;
  if (u.department === "Accounts") return true;
  return false;
}

// Overseers (Boss + all-centers viewers: MIS / Director) see every compliance
// item. Anyone else sees the items assigned to them PLUS the items of everyone
// who reports up to them in the org chart — so an Accounts executive (Sonali,
// Saloni) sees only their own, while their manager (Rupali) sees her whole
// team's. Scoping follows the same reportsTo hierarchy used elsewhere.
function seesAllCompliance(u: AuthUser): boolean {
  return isBoss(u) || isAllCentersViewer(u);
}

// ---------------------------------------------------------------------------
// Company master list — available to EVERY authenticated user (mirrors the
// category management feature). These are registered BEFORE the compliance
// access gate below so any user can list/add/remove the shared company names
// used by the task "Company" picker. The Accounts compliance grid reads the
// same master list, so both stay in sync.
// ---------------------------------------------------------------------------

// List the active company master list (display order).
router.get("/companies", async (_req, res) => {
  const companies = await db
    .select()
    .from(complianceCompaniesTable)
    .where(eq(complianceCompaniesTable.active, true))
    .orderBy(asc(complianceCompaniesTable.sortOrder), asc(complianceCompaniesTable.id));
  res.json(companies.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })));
});

// Add a company to the editable master list. Names are trimmed and treated
// case-insensitively unique so the same company can't be added twice. New
// companies append to the end of the display order.
router.post("/companies", async (req, res) => {
  const parsed = CreateComplianceCompanyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid company data", details: parsed.error.issues });
    return;
  }
  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Company name is required" });
    return;
  }

  const [existing] = await db
    .select()
    .from(complianceCompaniesTable)
    .where(sql`lower(${complianceCompaniesTable.name}) = lower(${name})`);
  if (existing) {
    // An active duplicate is rejected; a previously-removed (inactive) company
    // is brought back instead of erroring, so re-adding a removed name works.
    if (existing.active) {
      res.status(409).json({ error: "A company with this name already exists" });
      return;
    }
    const [revived] = await db
      .update(complianceCompaniesTable)
      .set({ active: true })
      .where(eq(complianceCompaniesTable.id, existing.id))
      .returning();
    res.json({ ...revived!, createdAt: revived!.createdAt.toISOString() });
    return;
  }

  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${complianceCompaniesTable.sortOrder}), -1)` })
    .from(complianceCompaniesTable);

  const [row] = await db
    .insert(complianceCompaniesTable)
    .values({ name, sortOrder: (max ?? -1) + 1 })
    .returning();

  res.json({ ...row!, createdAt: row!.createdAt.toISOString() });
});

// Remove a company from the master list. This is a SOFT delete (active = false)
// so any historical completion statuses recorded under the company name stay
// attributable; the company simply disappears from the grid/picker and can be
// brought back by re-adding the same name.
router.delete("/companies/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid company id" });
    return;
  }
  const [row] = await db
    .update(complianceCompaniesTable)
    .set({ active: false })
    .where(eq(complianceCompaniesTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  res.json({ ...row, createdAt: row.createdAt.toISOString() });
});

router.use((req, res, next) => {
  if (!canAccessCompliance(req.user)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
});

router.get("/", async (req, res) => {
  const allItems = await db.select().from(complianceItemsTable).orderBy(asc(complianceItemsTable.sortOrder));
  const users = await db.select({ id: usersTable.id, name: usersTable.name, reportsTo: usersTable.reportsTo }).from(usersTable);
  // Scope: overseers see everything; everyone else sees their own items plus
  // their direct & indirect reports' items (org-chart subtree).
  let items = allItems;
  if (!seesAllCompliance(req.user!)) {
    const allowed = buildHierarchySet(req.user!.id, users);
    items = allItems.filter((it) => it.assignedTo != null && allowed.has(it.assignedTo));
  }
  const visibleItemIds = new Set(items.map((it) => it.id));
  const allStatuses = await db.select().from(complianceStatusTable);
  const statuses = allStatuses.filter((s) => visibleItemIds.has(s.itemId));
  const userMap = new Map(users.map((u) => [u.id, u.name]));
  // The editable company master list (active first, in display order) drives the
  // grid columns and the "Applicable companies" picker on the client.
  const companies = await db
    .select()
    .from(complianceCompaniesTable)
    .orderBy(asc(complianceCompaniesTable.sortOrder), asc(complianceCompaniesTable.id));
  res.json({
    items: items.map((it) => ({
      ...it,
      assignedToName: it.assignedTo != null ? userMap.get(it.assignedTo) ?? null : null,
      createdAt: it.createdAt.toISOString(),
    })),
    statuses: statuses.map((s) => ({
      ...s,
      doneAt: s.doneAt ? s.doneAt.toISOString() : null,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
    companies: companies.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
  });
});

// Serialize a master-list row for the API (createdAt → ISO, attach assignee name).
async function serializeItem(item: typeof complianceItemsTable.$inferSelect) {
  let assignedToName: string | null = null;
  if (item.assignedTo != null) {
    const [u] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, item.assignedTo));
    assignedToName = u?.name ?? null;
  }
  return { ...item, assignedToName, createdAt: item.createdAt.toISOString() };
}

// On (re)assignment, alert the new assignee the same way a normal task does:
// an in-app notification (bell) PLUS an email. Skipped when the item is
// unassigned or the actor assigned it to themselves. Best-effort: failures are
// swallowed so the create/update request still succeeds.
async function notifyComplianceAssignment(
  item: typeof complianceItemsTable.$inferSelect,
  actorId: number,
) {
  const assignedTo = item.assignedTo;
  if (assignedTo == null || assignedTo === actorId) return;
  try {
    const [assignee] = await db
      .select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, assignedTo));
    const [actor] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, actorId));
    const byText = actor?.name ? ` (by ${actor.name})` : "";

    await createNotifications([{
      userId: assignedTo,
      type: "compliance_assigned",
      message: `New compliance activity assigned to you: "${item.compliance}"${byText}`,
    }]);

    if (assignee?.email && assignee?.name) {
      await sendComplianceAssignmentEmail({
        toEmail: assignee.email,
        toName: assignee.name,
        compliance: item.compliance,
        activity: item.activity,
        frequency: item.frequency,
        dueDateText: item.dueDateText,
        companies: item.companies,
        assignedByName: actor?.name ?? null,
      });
    }
  } catch (err) {
    // Notification/email is non-critical; never fail the request because of it.
  }
}

// Create a new compliance master-list item. The whole route is already gated to
// Boss / all-centers viewers / Accounts, so any caller here may manage the list.
router.post("/items", async (req, res) => {
  const parsed = CreateComplianceItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid compliance item data", details: parsed.error.issues });
    return;
  }
  const { compliance, activity, dueDateText, frequency, companies, assignedTo, sortOrder } = parsed.data;

  // Default new rows to the end of the list when no explicit order is given.
  let order = sortOrder ?? null;
  if (order == null) {
    const [{ max }] = await db
      .select({ max: sql<number>`coalesce(max(${complianceItemsTable.sortOrder}), -1)` })
      .from(complianceItemsTable);
    order = (max ?? -1) + 1;
  }

  const [row] = await db
    .insert(complianceItemsTable)
    .values({
      compliance,
      activity: activity ?? null,
      dueDateText: dueDateText ?? null,
      frequency,
      companies,
      assignedTo: assignedTo ?? null,
      sortOrder: order,
    })
    .returning();

  await notifyComplianceAssignment(row!, req.user!.id);

  res.json(await serializeItem(row!));
});

// Update or deactivate an existing item. Only fields actually present in the body
// are changed (PATCH semantics), so deactivating won't clobber other columns.
router.patch("/items/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const parsed = UpdateComplianceItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid compliance item data", details: parsed.error.issues });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const data = parsed.data;
  const set: Partial<typeof complianceItemsTable.$inferInsert> = {};
  if ("compliance" in body && data.compliance !== undefined) set.compliance = data.compliance;
  if ("activity" in body) set.activity = data.activity ?? null;
  if ("dueDateText" in body) set.dueDateText = data.dueDateText ?? null;
  if ("frequency" in body && data.frequency !== undefined) set.frequency = data.frequency;
  if ("companies" in body && data.companies !== undefined) set.companies = data.companies;
  if ("assignedTo" in body) set.assignedTo = data.assignedTo ?? null;
  if ("sortOrder" in body && data.sortOrder !== undefined) set.sortOrder = data.sortOrder;
  if ("active" in body && data.active !== undefined) set.active = data.active;

  if (Object.keys(set).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  // Remember the prior assignee so we only notify on a real (re)assignment.
  const [prev] = await db
    .select({ assignedTo: complianceItemsTable.assignedTo })
    .from(complianceItemsTable)
    .where(eq(complianceItemsTable.id, id));

  const [row] = await db
    .update(complianceItemsTable)
    .set(set)
    .where(eq(complianceItemsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Compliance item not found" });
    return;
  }

  // Only alert when the assignee actually changed to a new person.
  if ("assignedTo" in body && row.assignedTo != null && row.assignedTo !== prev?.assignedTo) {
    await notifyComplianceAssignment(row, req.user!.id);
  }

  res.json(await serializeItem(row));
});

router.post("/status", async (req, res) => {
  const parsed = ToggleComplianceStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid compliance status data", details: parsed.error.issues });
    return;
  }
  const { itemId, company, periodKey, done } = parsed.data;

  const [item] = await db
    .select({ id: complianceItemsTable.id, companies: complianceItemsTable.companies, assignedTo: complianceItemsTable.assignedTo })
    .from(complianceItemsTable)
    .where(eq(complianceItemsTable.id, itemId));
  if (!item) {
    res.status(404).json({ error: "Compliance item not found" });
    return;
  }

  // A non-overseer can only tick items within their org-chart subtree (their own
  // plus their reports'); overseers can tick any.
  if (!seesAllCompliance(req.user!)) {
    const users = await db.select({ id: usersTable.id, reportsTo: usersTable.reportsTo }).from(usersTable);
    const allowed = buildHierarchySet(req.user!.id, users);
    if (item.assignedTo == null || !allowed.has(item.assignedTo)) {
      res.status(403).json({ error: "You can only update compliance items for yourself or your team" });
      return;
    }
  }

  // The company must actually apply to this item: a company-agnostic item (empty
  // companies) is only tracked under the "ALL" key; otherwise the company must be
  // one of the item's applicable companies. This rejects fabricated status cells.
  const companyValid = item.companies.length === 0 ? company === "ALL" : item.companies.includes(company);
  if (!companyValid) {
    res.status(400).json({ error: "Company is not applicable to this compliance item" });
    return;
  }

  // periodKey is one of: YYYY (annual), YYYY-MM (monthly), YYYY-MM-DD (daily),
  // YYYY-Www (weekly), YYYY-Qn (quarterly).
  if (!/^\d{4}(-\d{2}-\d{2}|-W\d{2}|-Q[1-4]|-\d{2})?$/.test(periodKey)) {
    res.status(400).json({ error: "Invalid periodKey" });
    return;
  }

  // Attribution comes from the authenticated session, never the request body, so
  // a user cannot record a completion under someone else's name.
  const actorId = req.user!.id;
  const now = new Date();
  const [row] = await db
    .insert(complianceStatusTable)
    .values({
      itemId,
      company,
      periodKey,
      done,
      doneBy: done ? actorId : null,
      doneAt: done ? now : null,
    })
    .onConflictDoUpdate({
      target: [complianceStatusTable.itemId, complianceStatusTable.company, complianceStatusTable.periodKey],
      set: { done, doneBy: done ? actorId : null, doneAt: done ? now : null, updatedAt: now },
    })
    .returning();

  // Keep the mirrored All Tasks compliance task in sync: it completes only when
  // every applicable company is done for this period, otherwise it reopens.
  await syncTaskFromComplianceStatus(itemId, periodKey);

  res.json({
    ...row,
    doneAt: row.doneAt ? row.doneAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
});

export default router;
