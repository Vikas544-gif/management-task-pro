import {
  pgTable, serial, text, integer, boolean, timestamp, date, time, jsonb,
} from "drizzle-orm/pg-core";

// ── Users ──────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(), // bcrypt hash
  passwordPlain: text("password_plain"), // readable copy, shown to Boss/Center Head in Credentials page
  name: text("name").notNull(),
  email: text("email"),
  role: text("role").notNull().default("Employee"), // Boss, Center Head, Employee...
  department: text("department").notNull().default("General"), // Management, MIS, Accounts, HR, IT, Director...
  center: text("center"), // Head Office, Thane Center, Malad Center, Pune Center, Navi Mumbai Center
  reportsTo: integer("reports_to"), // hierarchy parent user id
  centerPermissions: jsonb("center_permissions").$type<string[] | null>(), // custom center restriction (Boss/MIS)
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ── Categories & Companies (used on Assign Task form) ───────────────────────
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

// ── Tasks ────────────────────────────────────────────────────────────────
export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  assignedTo: integer("assigned_to"),
  assignedBy: integer("assigned_by"),
  status: text("status").notNull().default("pending"), // pending | inProgress | done
  priority: text("priority").notNull().default("medium"), // low | medium | high
  dueDate: date("due_date"),
  reminderTime: time("reminder_time"),
  type: text("type").notNull().default("oneTime"), // daily | weekly | monthly | oneTime
  category: text("category"),
  department: text("department"), // target department shown on the form, or "All Departments"
  company: text("company"),
  remark: text("remark"),
  sendEmailNotification: boolean("send_email_notification").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Log of who a task was transferred from/to (Transfer action in TaskList)
export const taskTransfers = pgTable("task_transfers", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  fromUserId: integer("from_user_id"),
  toUserId: integer("to_user_id"),
  transferredBy: integer("transferred_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ── Attendance ───────────────────────────────────────────────────────────
export const attendance = pgTable("attendance", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  date: date("date").notNull(),
  status: text("status").notNull(), // present | absent | leave | half-day
  note: text("note"),
});

// ── EOD Reports ──────────────────────────────────────────────────────────
export const eodReports = pgTable("eod_reports", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  date: date("date").notNull(),
  summary: text("summary"),
  tasksCompleted: text("tasks_completed"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ── Holidays ─────────────────────────────────────────────────────────────
export const holidays = pgTable("holidays", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  name: text("name").notNull(),
  day: text("day").notNull(),
  type: text("type").notNull().default("full"), // full | half | weekend
});

// ── Compliance companies / dates ────────────────────────────────────────
export const complianceCompanies = pgTable("compliance_companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  gstDueDay: integer("gst_due_day"),
  tdsDueDay: integer("tds_due_day"),
  notes: text("notes"),
});

// ── Email settings (single row config) ──────────────────────────────────
export const emailSettings = pgTable("email_settings", {
  id: serial("id").primaryKey(),
  smtpEmail: text("smtp_email"),
  resendApiKeySet: boolean("resend_api_key_set").notNull().default(false),
  dashboardRecipients: jsonb("dashboard_recipients").$type<string[]>().default([]),
});

// ── Access control: per-role/per-user page permissions ──────────────────
// ── Push notification subscriptions (browser "Laptop popup" background push) ──
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const accessControl = pgTable("access_control", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  page: text("page").notNull(), // e.g. "reports", "access-control"
  allowed: boolean("allowed").notNull().default(true),
});
// ── Notifications ────────────────────────────────────────────────────────
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  message: text("message"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});