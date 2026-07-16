import { db, complianceItemsTable, complianceCompaniesTable, usersTable } from "@workspace/db";
import { logger } from "./logger";

// Company keys, in display order. An empty `companies` array on an item means
// the activity is company-agnostic (filed once for the group, not per company).
// This is only the initial seed for the editable `compliance_companies` table —
// new companies are added in-app, not here.
export const COMPLIANCE_COMPANIES = [
  "Parabolic",
  "Infinity",
  "Iken",
  "Vantage",
  "Wonocre",
  "EuroIcon",
  "Parabolic PTE",
  "Pixelmint Dubai",
] as const;

const MAIN3 = ["Parabolic", "Infinity", "Iken"];
const PF = ["Parabolic", "Infinity"];

type Assignee = "Sonali" | "Rupali" | "Saloni";

interface SeedItem {
  compliance: string;
  activity: string | null;
  dueDateText: string;
  frequency: "Daily" | "Weekly" | "Monthly" | "Quarterly" | "Annual";
  companies: string[];
  assignee: Assignee;
}

// Transcribed from the Accounts compliance calendar. Per-company applicability
// follows the operational rows (TDS/GST/PF/ESI run for the active Indian
// entities); annual/quarterly filings and internal MIS reports are tracked
// company-agnostic (empty companies array).
const ITEMS: SeedItem[] = [
  { compliance: "TDS Working", activity: "Deposit TDS deducted during the previous month", dueDateText: "6th of next month", frequency: "Monthly", companies: MAIN3, assignee: "Sonali" },
  { compliance: "TDS Payment", activity: "Deposit TDS deducted during the previous month", dueDateText: "6th of next month", frequency: "Monthly", companies: MAIN3, assignee: "Sonali" },
  { compliance: "PF Contribution", activity: "Deposit EPF contribution", dueDateText: "15th of next month", frequency: "Monthly", companies: PF, assignee: "Rupali" },
  { compliance: "ESI Contribution", activity: "Deposit ESIC contribution", dueDateText: "15th of next month", frequency: "Monthly", companies: PF, assignee: "Rupali" },
  { compliance: "GST – GSTR-1 (Monthly)", activity: "Outward supplies return working", dueDateText: "9th of next month", frequency: "Monthly", companies: MAIN3, assignee: "Sonali" },
  { compliance: "GST – GSTR-1 (Monthly)", activity: "PMP Sales count reminder to Viral", dueDateText: "9th of next month", frequency: "Monthly", companies: ["Infinity"], assignee: "Sonali" },
  { compliance: "GST – GSTR-1 (Monthly)", activity: "Outward supplies return", dueDateText: "11th of next month", frequency: "Monthly", companies: MAIN3, assignee: "Sonali" },
  { compliance: "GST – GSTR-3B (Monthly)", activity: "Summary return & tax payment working", dueDateText: "19th of next month", frequency: "Monthly", companies: MAIN3, assignee: "Sonali" },
  { compliance: "GST – GSTR-3B (Monthly)", activity: "Summary return & tax payment", dueDateText: "19th of next month", frequency: "Monthly", companies: MAIN3, assignee: "Sonali" },
  { compliance: "Bank Reconciliation", activity: "All bank accounts reconciled", dueDateText: "Daily", frequency: "Daily", companies: MAIN3, assignee: "Sonali" },
  { compliance: "Monthly Book Closure", activity: "Closing of books and provisions", dueDateText: "By 5th working day", frequency: "Monthly", companies: MAIN3, assignee: "Sonali" },
  { compliance: "TDS Return (Q1)", activity: "24Q / 26Q", dueDateText: "31-Jul", frequency: "Quarterly", companies: [], assignee: "Sonali" },
  { compliance: "TDS Return (Q2)", activity: "24Q / 26Q", dueDateText: "31-Oct", frequency: "Quarterly", companies: [], assignee: "Sonali" },
  { compliance: "TDS Return (Q3)", activity: "24Q / 26Q", dueDateText: "31-Jan", frequency: "Quarterly", companies: [], assignee: "Sonali" },
  { compliance: "TDS Return (Q4)", activity: "24Q / 26Q", dueDateText: "31-May", frequency: "Quarterly", companies: [], assignee: "Saloni" },
  { compliance: "Advance Tax – 1st Installment", activity: "Income Tax", dueDateText: "15-Jun", frequency: "Quarterly", companies: [], assignee: "Rupali" },
  { compliance: "Advance Tax – 2nd Installment", activity: "Income Tax", dueDateText: "15-Sep", frequency: "Quarterly", companies: [], assignee: "Rupali" },
  { compliance: "Advance Tax – 3rd Installment", activity: "Income Tax", dueDateText: "15-Dec", frequency: "Quarterly", companies: [], assignee: "Rupali" },
  { compliance: "Advance Tax – Final Installment", activity: "Income Tax", dueDateText: "15-Mar", frequency: "Quarterly", companies: [], assignee: "Rupali" },
  { compliance: "GSTR-9 (Annual Return)", activity: null, dueDateText: "31 December following FY", frequency: "Annual", companies: [], assignee: "Sonali" },
  { compliance: "GSTR-9C (where applicable)", activity: null, dueDateText: "31 December following FY", frequency: "Annual", companies: [], assignee: "Sonali" },
  { compliance: "Income Tax Return – Company", activity: null, dueDateText: "Generally 31 October (audit cases)", frequency: "Annual", companies: [], assignee: "Rupali" },
  { compliance: "Tax Audit Report (Form 3CA/3CB-3CD)", activity: null, dueDateText: "30-Sep", frequency: "Annual", companies: [], assignee: "Rupali" },
  { compliance: "DIR-3 KYC (Directors)", activity: null, dueDateText: "30-Sep", frequency: "Annual", companies: [], assignee: "Rupali" },
  { compliance: "DPT-3 (Applicable Companies)", activity: null, dueDateText: "30-Jun", frequency: "Annual", companies: [], assignee: "Rupali" },
  { compliance: "LLP Form-11", activity: null, dueDateText: "30-May", frequency: "Annual", companies: [], assignee: "Rupali" },
  { compliance: "Annual Financial Statement Finalization", activity: null, dueDateText: "By 30 April (internal target)", frequency: "Annual", companies: [], assignee: "Rupali" },
  { compliance: "Statutory Audit Completion", activity: null, dueDateText: "By 30 September", frequency: "Annual", companies: [], assignee: "Rupali" },
  { compliance: "Statutory Audit Completion", activity: null, dueDateText: "By 15th December", frequency: "Annual", companies: [], assignee: "Rupali" },
  { compliance: "P&L Report", activity: null, dueDateText: "By 10th of every month", frequency: "Monthly", companies: [], assignee: "Rupali" },
  { compliance: "Sales Report Email to all TL", activity: null, dueDateText: "By 15th of every month", frequency: "Monthly", companies: [], assignee: "Rupali" },
  { compliance: "Incentive Files", activity: null, dueDateText: "By 22nd of every month", frequency: "Monthly", companies: [], assignee: "Rupali" },
  { compliance: "Pending Billing Summary", activity: null, dueDateText: "Every Wednesday", frequency: "Weekly", companies: [], assignee: "Saloni" },
  { compliance: "Overdue payment list", activity: null, dueDateText: "Every Wednesday", frequency: "Weekly", companies: [], assignee: "Saloni" },
];

// Idempotently load the master compliance list once. Runs on boot (the table is
// only seeded when empty), so a fresh database/environment comes up populated
// without a manual migration step.
export async function seedComplianceItems(): Promise<void> {
  const existing = await db.select({ id: complianceItemsTable.id }).from(complianceItemsTable).limit(1);
  if (existing.length) return;

  const users = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
  const findId = (prefix: string): number | null =>
    users.find((u) => u.name.toLowerCase().startsWith(prefix.toLowerCase()))?.id ?? null;
  const assigneeIds: Record<Assignee, number | null> = {
    Sonali: findId("Sonali"),
    Rupali: findId("Rupali"),
    Saloni: findId("Saloni"),
  };

  const rows = ITEMS.map((it, i) => ({
    compliance: it.compliance,
    activity: it.activity,
    dueDateText: it.dueDateText,
    frequency: it.frequency,
    companies: it.companies,
    assignedTo: assigneeIds[it.assignee],
    sortOrder: i,
  }));

  await db.insert(complianceItemsTable).values(rows);
  logger.info({ count: rows.length }, "Seeded compliance items");
}

// Idempotently seed the editable company master list (only when empty). Runs on
// boot so existing environments backfill the initial group companies; after that
// the list is managed in-app.
export async function seedComplianceCompanies(): Promise<void> {
  const existing = await db.select({ id: complianceCompaniesTable.id }).from(complianceCompaniesTable).limit(1);
  if (existing.length) return;

  const rows = COMPLIANCE_COMPANIES.map((name, i) => ({ name, sortOrder: i }));
  await db.insert(complianceCompaniesTable).values(rows);
  logger.info({ count: rows.length }, "Seeded compliance companies");
}
