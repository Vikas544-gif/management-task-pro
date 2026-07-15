-- Paste this whole file into Neon → SQL Editor → Run

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'Employee',
  department TEXT NOT NULL DEFAULT 'General',
  center TEXT,
  reports_to INTEGER,
  center_permissions JSONB,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to INTEGER,
  assigned_by INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'medium',
  due_date DATE,
  reminder_time TIME,
  type TEXT NOT NULL DEFAULT 'oneTime',
  category TEXT,
  department TEXT,
  company TEXT,
  remark TEXT,
  send_email_notification BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE task_transfers (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL,
  from_user_id INTEGER,
  to_user_id INTEGER,
  transferred_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE attendance (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  date DATE NOT NULL,
  status TEXT NOT NULL,
  note TEXT
);

CREATE TABLE eod_reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  date DATE NOT NULL,
  summary TEXT,
  tasks_completed TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE holidays (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  name TEXT NOT NULL,
  day TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'full'
);

CREATE TABLE compliance_companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  gst_due_day INTEGER,
  tds_due_day INTEGER,
  notes TEXT
);

CREATE TABLE email_settings (
  id SERIAL PRIMARY KEY,
  smtp_email TEXT,
  resend_api_key_set BOOLEAN NOT NULL DEFAULT false,
  dashboard_recipients JSONB DEFAULT '[]'
);

CREATE TABLE access_control (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  page TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT true
);
