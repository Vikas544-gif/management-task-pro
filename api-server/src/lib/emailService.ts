import { Resend } from "resend";
import { logger } from "./logger";

// ── Resend transactional email ─────────────────────────────────
// Uses RESEND_API_KEY (secret). Sender is controlled by FROM_EMAIL env:
//   - Default "onboarding@resend.dev" works only for the Resend account
//     owner's own email (Resend test mode).
//   - To send to ALL team members, verify your domain in Resend and set
//     FROM_EMAIL to e.g. "Management Task Pro <noreply@yourcompany.com>".
const DEFAULT_FROM = "Management Task Pro <onboarding@resend.dev>";

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

export function getSenderEmail(): string {
  const from = process.env.FROM_EMAIL?.trim();
  return from && from.length > 0 ? from : DEFAULT_FROM;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isRateLimit = (e: any): boolean =>
  e?.statusCode === 429 || e?.name === "rate_limit_exceeded";

// Central send helper — returns true on success, false (logged) on failure.
// Resend's free tier allows only 2 requests/second, so a burst of digest
// emails would otherwise fail with HTTP 429. We retry rate-limited sends a
// few times with backoff so the whole batch eventually goes out.
export async function sendEmail(
  opts: { to: string; subject: string; html: string },
  attempt = 0
): Promise<{ ok: boolean; error?: string }> {
  const resend = getResend();
  if (!resend) {
    logger.warn("RESEND_API_KEY not set — email skipped");
    return { ok: false, error: "Email not configured. RESEND_API_KEY is missing." };
  }
  const MAX_RETRIES = 5;
  try {
    const { error } = await resend.emails.send({
      from: getSenderEmail(),
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    if (error) {
      if (isRateLimit(error) && attempt < MAX_RETRIES) {
        await sleep(700 * (attempt + 1));
        return sendEmail(opts, attempt + 1);
      }
      logger.error({ err: error, to: opts.to }, "Resend send failed");
      return { ok: false, error: error.message ?? "Failed to send email" };
    }
    return { ok: true };
  } catch (err: any) {
    if (isRateLimit(err) && attempt < MAX_RETRIES) {
      await sleep(700 * (attempt + 1));
      return sendEmail(opts, attempt + 1);
    }
    logger.error({ err, to: opts.to }, "Resend send threw");
    return { ok: false, error: err?.message ?? "Failed to send email" };
  }
}

export async function sendTaskAssignmentEmail(opts: {
  toEmail: string;
  toName: string;
  taskTitle: string;
  taskDescription: string | null;
  priority: string;
  dueDate: string | null;
  type: string;
  assignedByName: string | null;
}) {
  const due = opts.dueDate ? `<b>Due Date:</b> ${opts.dueDate}<br>` : "";
  const { ok } = await sendEmail({
    to: opts.toEmail,
    subject: `New Task Assigned: ${opts.taskTitle}`,
    html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:20px">
          <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e2e8f0">
            <div style="background:#6366f1;color:#fff;border-radius:8px;padding:14px 20px;margin-bottom:20px">
              <h2 style="margin:0;font-size:18px">Management Task Pro — Task Assigned</h2>
            </div>
            <p style="color:#0f172a;font-size:15px">Hello <b>${opts.toName}</b>,</p>
            <p style="color:#64748b;font-size:14px">A new task has been assigned to you${opts.assignedByName ? ` by <b>${opts.assignedByName}</b>` : ""}.</p>
            <div style="background:#f1f5f9;border-left:4px solid #6366f1;border-radius:8px;padding:16px;margin:20px 0">
              <h3 style="margin:0 0 10px;color:#0f172a;font-size:16px">${opts.taskTitle}</h3>
              ${opts.taskDescription ? `<p style="color:#64748b;margin:0 0 10px;font-size:14px">${opts.taskDescription}</p>` : ""}
              <p style="margin:4px 0;font-size:13px;color:#64748b"><b>Priority:</b> ${opts.priority.toUpperCase()}</p>
              <p style="margin:4px 0;font-size:13px;color:#64748b"><b>Type:</b> ${opts.type}</p>
              ${due}
            </div>
            <p style="color:#94a3b8;font-size:12px;margin-top:20px">Please login to Management Task Pro to view and update this task.</p>
          </div>
        </div>`,
  });
  if (ok) logger.info({ toEmail: opts.toEmail, task: opts.taskTitle }, "Task assignment email sent");
  return ok;
}

export async function sendComplianceAssignmentEmail(opts: {
  toEmail: string;
  toName: string;
  compliance: string;
  activity: string | null;
  frequency: string;
  dueDateText: string | null;
  companies: string[];
  assignedByName: string | null;
}) {
  const due = opts.dueDateText ? `<p style="margin:4px 0;font-size:13px;color:#64748b"><b>Due:</b> ${opts.dueDateText}</p>` : "";
  const comp = opts.companies.length > 0
    ? `<p style="margin:4px 0;font-size:13px;color:#64748b"><b>Companies:</b> ${opts.companies.join(", ")}</p>`
    : "";
  const { ok } = await sendEmail({
    to: opts.toEmail,
    subject: `New Compliance Activity Assigned: ${opts.compliance}`,
    html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:20px">
          <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e2e8f0">
            <div style="background:#6366f1;color:#fff;border-radius:8px;padding:14px 20px;margin-bottom:20px">
              <h2 style="margin:0;font-size:18px">Management Task Pro — Compliance Assigned</h2>
            </div>
            <p style="color:#0f172a;font-size:15px">Hello <b>${opts.toName}</b>,</p>
            <p style="color:#64748b;font-size:14px">A compliance activity has been assigned to you${opts.assignedByName ? ` by <b>${opts.assignedByName}</b>` : ""}.</p>
            <div style="background:#f1f5f9;border-left:4px solid #6366f1;border-radius:8px;padding:16px;margin:20px 0">
              <h3 style="margin:0 0 10px;color:#0f172a;font-size:16px">${opts.compliance}</h3>
              ${opts.activity ? `<p style="color:#64748b;margin:0 0 10px;font-size:14px">${opts.activity}</p>` : ""}
              <p style="margin:4px 0;font-size:13px;color:#64748b"><b>Frequency:</b> ${opts.frequency}</p>
              ${due}
              ${comp}
            </div>
            <p style="color:#94a3b8;font-size:12px;margin-top:20px">Please login to Management Task Pro to view and track this compliance activity.</p>
          </div>
        </div>`,
  });
  if (ok) logger.info({ toEmail: opts.toEmail, compliance: opts.compliance }, "Compliance assignment email sent");
  return ok;
}

export async function sendTaskCompletedEmail(opts: {
  toEmail: string;
  toName: string;
  taskTitle: string;
  completedByName: string | null;
}) {
  const { ok } = await sendEmail({
    to: opts.toEmail,
    subject: `Task Completed: ${opts.taskTitle}`,
    html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:20px">
          <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e2e8f0">
            <div style="background:#16a34a;color:#fff;border-radius:8px;padding:14px 20px;margin-bottom:20px">
              <h2 style="margin:0;font-size:18px">Management Task Pro — Task Completed</h2>
            </div>
            <p style="color:#0f172a;font-size:15px">Hello <b>${opts.toName}</b>,</p>
            <p style="color:#64748b;font-size:14px">A task you assigned has been marked complete${opts.completedByName ? ` by <b>${opts.completedByName}</b>` : ""}.</p>
            <div style="background:#f0fdf4;border-left:4px solid #16a34a;border-radius:8px;padding:16px;margin:20px 0">
              <h3 style="margin:0 0 6px;color:#0f172a;font-size:16px">${opts.taskTitle}</h3>
              <p style="margin:4px 0;font-size:13px;color:#16a34a"><b>Status:</b> Completed ✅</p>
            </div>
            <p style="color:#94a3b8;font-size:12px;margin-top:20px">Please login to Management Task Pro to review this task.</p>
          </div>
        </div>`,
  });
  if (ok) logger.info({ toEmail: opts.toEmail, task: opts.taskTitle }, "Task completion email sent");
  return ok;
}

export async function sendReminderEmail(opts: {
  toEmail: string;
  toName: string;
  period: string;
  tasks: Array<{ title: string; status: string; priority: string; dueDate: string | null }>;
}) {
  const rows = opts.tasks
    .map(
      (t) =>
        `<tr><td style="padding:8px;border-bottom:1px solid #e2e8f0">${t.title}</td>
           <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-transform:capitalize">${t.status}</td>
           <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-transform:uppercase">${t.priority}</td>
           <td style="padding:8px;border-bottom:1px solid #e2e8f0">${t.dueDate || "—"}</td></tr>`
    )
    .join("");
  const { ok } = await sendEmail({
    to: opts.toEmail,
    subject: `Management Task Pro — ${opts.period} Task Reminder`,
    html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:650px;margin:0 auto;background:#f8fafc;padding:20px">
          <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e2e8f0">
            <div style="background:#6366f1;color:#fff;border-radius:8px;padding:14px 20px;margin-bottom:20px">
              <h2 style="margin:0;font-size:18px">Management Task Pro — ${opts.period} Reminder</h2>
            </div>
            <p style="color:#0f172a;font-size:15px">Hello <b>${opts.toName}</b>,</p>
            <p style="color:#64748b;font-size:14px">Here is your ${opts.period.toLowerCase()} task summary (${opts.tasks.length} tasks):</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
              <thead>
                <tr style="background:#f1f5f9">
                  <th style="padding:10px 8px;text-align:left;color:#64748b">Task</th>
                  <th style="padding:10px 8px;text-align:left;color:#64748b">Status</th>
                  <th style="padding:10px 8px;text-align:left;color:#64748b">Priority</th>
                  <th style="padding:10px 8px;text-align:left;color:#64748b">Due</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
            <p style="color:#94a3b8;font-size:12px;margin-top:20px">Login to Management Task Pro to update your tasks.</p>
          </div>
        </div>`,
  });
  if (ok) logger.info({ toEmail: opts.toEmail, period: opts.period }, "Reminder email sent");
  return ok;
}

export async function sendDailyDigestEmail(opts: {
  toEmail: string;
  toName: string;
  dateStr: string;
  tasks: Array<{ title: string; status: string; priority: string; type: string; dueDate: string | null; overdue: boolean }>;
}) {
  const rows = opts.tasks
    .map(
      (t) =>
        `<tr>
           <td style="padding:8px;border-bottom:1px solid #e2e8f0">${t.title}${t.overdue ? ` <span style="background:#fee2e2;color:#b91c1c;font-size:11px;font-weight:700;padding:1px 6px;border-radius:6px">OVERDUE</span>` : ""}</td>
           <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-transform:capitalize">${t.status}</td>
           <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-transform:uppercase">${t.priority}</td>
           <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-transform:capitalize">${t.type}</td>
           <td style="padding:8px;border-bottom:1px solid #e2e8f0">${t.dueDate || "—"}</td>
         </tr>`
    )
    .join("");
  const { ok } = await sendEmail({
    to: opts.toEmail,
    subject: `Management Task Pro — Today's Tasks (${opts.dateStr})`,
    html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:650px;margin:0 auto;background:#f8fafc;padding:20px">
          <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e2e8f0">
            <div style="background:#6366f1;color:#fff;border-radius:8px;padding:14px 20px;margin-bottom:20px">
              <h2 style="margin:0;font-size:18px">Management Task Pro — Today's Tasks</h2>
              <p style="margin:4px 0 0;font-size:12px;opacity:.8">${opts.dateStr}</p>
            </div>
            <p style="color:#0f172a;font-size:15px">Hello <b>${opts.toName}</b>,</p>
            <p style="color:#64748b;font-size:14px">You have ${opts.tasks.length} task${opts.tasks.length === 1 ? "" : "s"} today:</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
              <thead>
                <tr style="background:#f1f5f9">
                  <th style="padding:10px 8px;text-align:left;color:#64748b">Task</th>
                  <th style="padding:10px 8px;text-align:left;color:#64748b">Status</th>
                  <th style="padding:10px 8px;text-align:left;color:#64748b">Priority</th>
                  <th style="padding:10px 8px;text-align:left;color:#64748b">Type</th>
                  <th style="padding:10px 8px;text-align:left;color:#64748b">Due</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
            <p style="color:#94a3b8;font-size:12px;margin-top:20px">Login to Management Task Pro to update your tasks.</p>
          </div>
        </div>`,
  });
  if (ok) logger.info({ toEmail: opts.toEmail }, "Daily digest email sent");
  return ok;
}

export async function sendReportEmail(opts: {
  toEmail: string;
  period: string;
  from: string;
  to: string;
  total: number;
  completed: number;
  pending: number;
  overdue: number;
  byCategory: Array<{ category: string; count: number; done: number }>;
  byUser: Array<{ name: string; department: string; total: number; done: number; pending: number }>;
}) {
  {
    const catRows = opts.byCategory
      .map(
        (c) =>
          `<tr><td style="padding:7px 8px;border-bottom:1px solid #e2e8f0">${c.category}</td>
           <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0">${c.count}</td>
           <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0">${c.done}</td></tr>`
      )
      .join("");
    const userRows = opts.byUser
      .map(
        (u) =>
          `<tr><td style="padding:7px 8px;border-bottom:1px solid #e2e8f0">${u.name}</td>
           <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0">${u.department}</td>
           <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0">${u.total}</td>
           <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0">${u.done}</td>
           <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0">${u.pending}</td></tr>`
      )
      .join("");
    const { ok } = await sendEmail({
      to: opts.toEmail,
      subject: `Management Task Pro — ${opts.period} Report (${opts.from} to ${opts.to})`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:700px;margin:0 auto;background:#f8fafc;padding:20px">
          <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e2e8f0">
            <div style="background:#6366f1;color:#fff;border-radius:8px;padding:14px 20px;margin-bottom:20px">
              <h2 style="margin:0;font-size:18px">Management Task Pro — ${opts.period} Report</h2>
              <p style="margin:4px 0 0;font-size:12px;opacity:.8">${opts.from} to ${opts.to}</p>
            </div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0">
              <div style="background:#f1f5f9;border-radius:8px;padding:12px;text-align:center">
                <div style="font-size:24px;font-weight:800;color:#0f172a">${opts.total}</div>
                <div style="font-size:11px;color:#64748b;margin-top:2px">Total</div>
              </div>
              <div style="background:#d1fae5;border-radius:8px;padding:12px;text-align:center">
                <div style="font-size:24px;font-weight:800;color:#065f46">${opts.completed}</div>
                <div style="font-size:11px;color:#065f46;margin-top:2px">Completed</div>
              </div>
              <div style="background:#dbeafe;border-radius:8px;padding:12px;text-align:center">
                <div style="font-size:24px;font-weight:800;color:#1e40af">${opts.pending}</div>
                <div style="font-size:11px;color:#1e40af;margin-top:2px">Pending</div>
              </div>
              <div style="background:#fee2e2;border-radius:8px;padding:12px;text-align:center">
                <div style="font-size:24px;font-weight:800;color:#b91c1c">${opts.overdue}</div>
                <div style="font-size:11px;color:#b91c1c;margin-top:2px">Overdue</div>
              </div>
            </div>
            ${catRows ? `
            <h3 style="font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin:20px 0 8px">By Category</h3>
            <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
              <thead><tr style="background:#f1f5f9">
                <th style="padding:8px;text-align:left;color:#64748b">Category</th>
                <th style="padding:8px;text-align:left;color:#64748b">Total</th>
                <th style="padding:8px;text-align:left;color:#64748b">Done</th>
              </tr></thead>
              <tbody>${catRows}</tbody>
            </table>` : ""}
            ${userRows ? `
            <h3 style="font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin:20px 0 8px">By Team Member</h3>
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead><tr style="background:#f1f5f9">
                <th style="padding:8px;text-align:left;color:#64748b">Name</th>
                <th style="padding:8px;text-align:left;color:#64748b">Dept</th>
                <th style="padding:8px;text-align:left;color:#64748b">Total</th>
                <th style="padding:8px;text-align:left;color:#64748b">Done</th>
                <th style="padding:8px;text-align:left;color:#64748b">Pending</th>
              </tr></thead>
              <tbody>${userRows}</tbody>
            </table>` : ""}
          </div>
        </div>`,
    });
    if (ok) logger.info({ toEmail: opts.toEmail, period: opts.period }, "Report email sent");
    return ok;
  }
}

// A daily snapshot of the live Dashboard (KPI cards + breakdowns), scoped to
// what the recipient is entitled to see — sent each morning to selected people.
export async function sendDashboardEmail(opts: {
  toEmail: string;
  toName: string;
  dateStr: string;
  total: number;
  pending: number;
  inProgress: number;
  done: number;
  completionRate: number;
  byCategory: Array<{ category: string; count: number; done: number }>;
  byUser: Array<{ name: string; department: string; total: number; done: number; pending: number }>;
}) {
  const catRows = opts.byCategory
    .map(
      (c) =>
        `<tr><td style="padding:7px 8px;border-bottom:1px solid #e2e8f0">${c.category}</td>
         <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0">${c.count}</td>
         <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0">${c.done}</td></tr>`
    )
    .join("");
  const userRows = opts.byUser
    .map(
      (u) =>
        `<tr><td style="padding:7px 8px;border-bottom:1px solid #e2e8f0">${u.name}</td>
         <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0">${u.department}</td>
         <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0">${u.total}</td>
         <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0">${u.done}</td>
         <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0">${u.pending}</td></tr>`
    )
    .join("");
  const { ok } = await sendEmail({
    to: opts.toEmail,
    subject: `Management Task Pro — Dashboard Summary (${opts.dateStr})`,
    html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:700px;margin:0 auto;background:#f8fafc;padding:20px">
          <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e2e8f0">
            <div style="background:#6366f1;color:#fff;border-radius:8px;padding:14px 20px;margin-bottom:20px">
              <h2 style="margin:0;font-size:18px">Management Task Pro — Dashboard Summary</h2>
              <p style="margin:4px 0 0;font-size:12px;opacity:.8">As of ${opts.dateStr}</p>
            </div>
            <p style="color:#0f172a;font-size:15px">Hello <b>${opts.toName}</b>,</p>
            <p style="color:#64748b;font-size:14px">Here is today's dashboard snapshot:</p>
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:16px 0">
              <div style="background:#f1f5f9;border-radius:8px;padding:12px;text-align:center">
                <div style="font-size:22px;font-weight:800;color:#0f172a">${opts.total}</div>
                <div style="font-size:11px;color:#64748b;margin-top:2px">Total</div>
              </div>
              <div style="background:#fee2e2;border-radius:8px;padding:12px;text-align:center">
                <div style="font-size:22px;font-weight:800;color:#b91c1c">${opts.pending}</div>
                <div style="font-size:11px;color:#b91c1c;margin-top:2px">Pending</div>
              </div>
              <div style="background:#fef3c7;border-radius:8px;padding:12px;text-align:center">
                <div style="font-size:22px;font-weight:800;color:#92400e">${opts.inProgress}</div>
                <div style="font-size:11px;color:#92400e;margin-top:2px">In Progress</div>
              </div>
              <div style="background:#d1fae5;border-radius:8px;padding:12px;text-align:center">
                <div style="font-size:22px;font-weight:800;color:#065f46">${opts.done}</div>
                <div style="font-size:11px;color:#065f46;margin-top:2px">Completed</div>
              </div>
              <div style="background:#e0e7ff;border-radius:8px;padding:12px;text-align:center">
                <div style="font-size:22px;font-weight:800;color:#3730a3">${opts.completionRate}%</div>
                <div style="font-size:11px;color:#3730a3;margin-top:2px">Completion</div>
              </div>
            </div>
            ${catRows ? `
            <h3 style="font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin:20px 0 8px">By Category</h3>
            <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
              <thead><tr style="background:#f1f5f9">
                <th style="padding:8px;text-align:left;color:#64748b">Category</th>
                <th style="padding:8px;text-align:left;color:#64748b">Total</th>
                <th style="padding:8px;text-align:left;color:#64748b">Done</th>
              </tr></thead>
              <tbody>${catRows}</tbody>
            </table>` : ""}
            ${userRows ? `
            <h3 style="font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin:20px 0 8px">By Team Member</h3>
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead><tr style="background:#f1f5f9">
                <th style="padding:8px;text-align:left;color:#64748b">Name</th>
                <th style="padding:8px;text-align:left;color:#64748b">Dept</th>
                <th style="padding:8px;text-align:left;color:#64748b">Total</th>
                <th style="padding:8px;text-align:left;color:#64748b">Done</th>
                <th style="padding:8px;text-align:left;color:#64748b">Pending</th>
              </tr></thead>
              <tbody>${userRows}</tbody>
            </table>` : ""}
            <p style="color:#94a3b8;font-size:12px;margin-top:20px">Login to Management Task Pro for the live dashboard.</p>
          </div>
        </div>`,
  });
  if (ok) logger.info({ toEmail: opts.toEmail }, "Dashboard summary email sent");
  return ok;
}
