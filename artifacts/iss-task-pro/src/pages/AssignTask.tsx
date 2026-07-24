import { useState } from "react";
import * as XLSX from "xlsx";
import { useListUsers, useListCategories, useCreateCategory, useDeleteCategory, useCreateTask, useUpdateUser, useListComplianceCompanies, useCreateComplianceCompany, useDeleteComplianceCompany, getListUsersQueryKey, getListTasksQueryKey, getGetTaskSummaryQueryKey, getListComplianceCompaniesQueryKey, getListCategoriesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { isAllCentersViewer, resolveAssignableUsers } from "@/lib/utils";

interface AssignTaskProps {
  currentUser: { id: number; name: string } | null;
}

const DEPTS = ["Management", "Operations", "Accounts", "MIS", "HR", "IT"];
const DEPT_COLORS: Record<string, string> = {
  Management: "text-purple-700 dark:text-purple-300", Accounts: "text-blue-700 dark:text-blue-300", MIS: "text-teal-700 dark:text-teal-300", HR: "text-pink-700 dark:text-pink-300", IT: "text-orange-700 dark:text-orange-300",
};

// ── Assign-picker visibility (default rule) ──────────────────────────────────
// Boss / MIS / Director see everyone. EVERYONE else is center-scoped and sees,
// by default:
//   • their OWN center's people
//   • the Boss (escalation) and MIS (support) — always
// In the four outer centers (Thane / Malad / Pune / Navi Mumbai) ALSO:
//   • the IT support person below — always, for EVERY role
//   • the Accounts staff below — only for Center Heads + HR (NOT Team Leaders)
// To hide someone entirely, set assignable=false on their user row. A per-viewer
// custom list (Access Control page) overrides ALL of this when set.
//
const HEAD_OFFICE = "Head Office";

export default function AssignTask({ currentUser }: AssignTaskProps) {
  const qc = useQueryClient();
  const { data: users = [] } = useListUsers();
  const { data: categories = [] } = useListCategories();
  const createCategory = useCreateCategory();
  const deleteCategory = useDeleteCategory();
  const [showCatManage, setShowCatManage] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [catError, setCatError] = useState("");
  const createTask = useCreateTask();
  const updateUser = useUpdateUser();
  const [showManage, setShowManage] = useState(false);

  // ── Excel bulk import ──────────────────────────────────────────────────
  // Expected columns (case-insensitive header match): Title, Description,
  // AssignTo (username), Priority, Category, DueDate (YYYY-MM-DD), Type
  // (daily/weekly/monthly/oneTime). Only Title + AssignTo are required.
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<{ ok: number; failed: string[] } | null>(null);

  const handleExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setImportResult(null);
    setImportBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });

      const norm = (s: string) => s.toString().replace(/[^a-z0-9]/gi, "").toLowerCase();
      const findVal = (row: Record<string, any>, ...aliases: string[]) => {
        const keys = Object.keys(row);
        for (const alias of aliases) {
          const k = keys.find((h) => norm(h) === norm(alias));
          if (k && String(row[k]).trim()) return String(row[k]).trim();
        }
        return "";
      };
      const detectedHeaders = rows.length > 0 ? Object.keys(rows[0]) : [];

      let ok = 0;
      const failed: string[] = [];

      for (const row of rows) {
        const title = findVal(row, "title", "task title", "titel", "taskname", "name");
        const assignToRaw = findVal(row, "assignto", "assign to", "username", "assignee", "assigned to");
        if (!title || !assignToRaw) {
          failed.push(`${title || "(no title)"} — missing Title or AssignTo (columns found: ${detectedHeaders.join(", ") || "none"})`);
          continue;
        }

        const assignee = users.find(
          (u) => u.username?.toLowerCase() === assignToRaw.toLowerCase() || u.name?.toLowerCase() === assignToRaw.toLowerCase()
        );
        if (!assignee) { failed.push(`${title} — user "${assignToRaw}" not found`); continue; }

        const priority = findVal(row, "priority").toLowerCase() || "medium";
        const freqRaw = findVal(row, "type", "frequency", "tasktype");
        const freqLower = freqRaw.toLowerCase();
        let type = "daily";
        if (freqLower.includes("month")) type = "monthly";
        else if (freqLower.includes("week")) type = "weekly";
        else if (freqLower.includes("day")) type = "daily";
        else if (["daily", "weekly", "monthly", "onetime"].includes(freqLower)) type = freqLower === "onetime" ? "oneTime" : freqLower;

        const category = findVal(row, "category") || null;
        let dueDate = findVal(row, "duedate", "due date") || null;

        // Pull a day-of-month out of free-text like "Till 20th Of Month" so
        // monthly tasks still get a real due date even without a DueDate column.
        if (!dueDate) {
          const dayMatch = freqRaw.match(/(\d{1,2})(st|nd|rd|th)?/i);
          if (type === "monthly" && dayMatch) {
            const day = Math.min(28, Math.max(1, parseInt(dayMatch[1], 10)));
            const now = new Date();
            dueDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          }
        }
        const description = findVal(row, "description") || null;

        try {
          await createTask.mutateAsync({
            data: {
              title, description,
              assignedTo: assignee.id,
              assignedBy: currentUser?.id ?? null,
              dueDate, dueTime: null,
              priority: ["low", "medium", "high"].includes(priority) ? priority : "medium",
              type,
              category, department: assignee.department ?? null,
              remark: null, sendEmail: true,
            },
          });
          ok++;
        } catch {
          failed.push(`${title} — server error`);
        }
      }

      qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
      qc.invalidateQueries({ queryKey: getGetTaskSummaryQueryKey() });
      setImportResult({ ok, failed });
    } catch {
      setImportResult({ ok: 0, failed: ["Could not read that file — make sure it's a valid .xlsx or .csv"] });
    } finally {
      setImportBusy(false);
    }
  };

  // Company picker — reuses the shared company master list. Selecting a company
  // appends " - {Company}" to the saved task title. Any user can add/remove
  // companies (mirrors category management); the list is public.
  const { data: companies = [] } = useListComplianceCompanies();
  const createCompany = useCreateComplianceCompany();
  const deleteCompany = useDeleteComplianceCompany();
  const [company, setCompany] = useState("");
  const [showCompanyManage, setShowCompanyManage] = useState(false);
  const [newCompany, setNewCompany] = useState("");
  const [companyError, setCompanyError] = useState("");

  // Show or hide a user from the assign picker (global setting, Boss/MIS only).
  const toggleAssignable = (id: number, next: boolean) => {
    updateUser.mutate(
      { id, data: { assignable: next } },
      { onSuccess: () => qc.invalidateQueries({ queryKey: getListUsersQueryKey() }) }
    );
  };

  const [form, setForm] = useState({
    title: "",
    description: "",
    assignedTo: "",
    dueDate: "",
    dueTime: "",
    priority: "medium",
    type: "daily",
    category: "",
    department: "",
    remark: "",
    sendEmail: true,
  });
  const [success, setSuccess] = useState<{ title: string; assignee: string } | null>(null);
  const [error, setError] = useState("");

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  // Selecting a name auto-fills that member's department.
  const handleAssignee = (value: string) => {
    const picked = users.find((u) => u.id === parseInt(value));
    setForm((f) => ({ ...f, assignedTo: value, department: picked?.department ?? f.department }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSuccess(null);
    setError("");
    if (!form.title.trim()) { setError("Task title is required"); return; }
    const assignee = users.find((u) => u.id === parseInt(form.assignedTo));
    const finalTitle = company ? `${form.title.trim()} - ${company}` : form.title.trim();

    createTask.mutate(
      {
        data: {
          title: finalTitle,
          description: form.description || null,
          assignedTo: form.assignedTo ? parseInt(form.assignedTo) : null,
          assignedBy: currentUser?.id ?? null,
          dueDate: form.dueDate || null,
          dueTime: form.dueTime || null,
          priority: form.priority,
          type: form.type,
          category: form.category || null,
          department: form.department || null,
          remark: form.remark || null,
          sendEmail: form.sendEmail,
        },
      },
      {
        onSuccess: (task) => {
          setSuccess({
            title: task.title,
            assignee: assignee?.name ?? "Unassigned",
          });
          setForm({ title: "", description: "", assignedTo: "", dueDate: "", dueTime: "", priority: "medium", type: "daily", category: "", department: "", remark: "", sendEmail: true });
          setCompany("");
          qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
          qc.invalidateQueries({ queryKey: getGetTaskSummaryQueryKey() });
        },
        onError: () => setError("Failed to create task"),
      }
    );
  };

  const handleAddCompany = () => {
    setCompanyError("");
    const name = newCompany.trim();
    if (!name) return;
    if (companies.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      setCompanyError("That company already exists");
      return;
    }
    createCompany.mutate(
      { data: { name } },
      {
        onSuccess: (created) => {
          qc.invalidateQueries({ queryKey: getListComplianceCompaniesQueryKey() });
          setNewCompany("");
          if (created?.name) setCompany(created.name);
        },
        onError: () => setCompanyError("Could not add company"),
      }
    );
  };

  const handleRemoveCompany = (id: number, name: string) => {
    setCompanyError("");
    if (!window.confirm(`Remove company "${name}"? It will no longer appear in the list.`)) return;
    deleteCompany.mutate(
      { id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListComplianceCompaniesQueryKey() });
          setCompany((c) => (c === name ? "" : c));
        },
        onError: () => setCompanyError("Could not remove company"),
      }
    );
  };

  const handleAddCategory = () => {
    setCatError("");
    const name = newCat.trim();
    if (!name) return;
    // Duplicate check is done server-side per center (409) — the fetched list
    // may contain other centers' categories for all-centers viewers.
    createCategory.mutate(
      { data: { name } },
      {
        onSuccess: (created: any) => {
          qc.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
          setNewCat("");
          if (created?.name) set("category", created.name);
        },
        onError: (err: any) =>
          setCatError(err?.status === 409 ? "That category already exists" : "Could not add category"),
      }
    );
  };

  const handleRemoveCategory = (id: number, name: string) => {
    setCatError("");
    if (!window.confirm(`Remove category "${name}"? It will no longer appear in the list.`)) return;
    deleteCategory.mutate(
      { id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
          setForm((f) => (f.category === name ? { ...f, category: "" } : f));
        },
        onError: () => setCatError("Could not remove category"),
      }
    );
  };

  const me = users.find((u) => u.id === currentUser?.id);
  // Only Boss / MIS / Director can MANAGE the picker (Access Control rights).
  const canManage = !!me && (me.role === "Boss" || me.department === "Management" || isAllCentersViewer(me));
  // Company add/remove is available to every user (mirrors category management).
  const canManageCompanies = true;
  // WHO appears in the "Assign To" dropdown. Computed by the shared
  // resolveAssignableUsers helper (lib/utils.ts) so this page and the Edit Task
  // modal stay in lockstep. Sales Agents (no login) are excluded; an admin
  // `assignVisibleUserIds` override, when set, is the single source of truth.
  const assignableUsers = resolveAssignableUsers(me, users);

  // Company-grouped picker is shown ONLY to Head-Office viewers (who can assign
  // across companies); the company name becomes the always-visible group header
  // (ordered Head Office first). Branch viewers keep the simpler department
  // grouping with each person's center shown inline.
  const groupByCenter = (me?.center ?? "") === HEAD_OFFICE;
  // The Company (optional) picker is a Head-Office-only feature; center users
  // never see it.
  const viewerIsHeadOffice = (me?.center ?? "") === HEAD_OFFICE;
  const CENTER_ORDER = ["Head Office", "Thane Center", "Malad Center", "Pune Center", "Navi Mumbai Center"];
  const groupMap = new Map<string, typeof users>();
  for (const u of assignableUsers) {
    const key = groupByCenter ? (u.center || "Other") : (u.department || "Other");
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(u);
  }
  const pickerGroups = groupByCenter
    ? Array.from(groupMap.entries()).sort((a, b) => {
        const ia = CENTER_ORDER.indexOf(a[0]);
        const ib = CENTER_ORDER.indexOf(b[0]);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a[0].localeCompare(b[0]);
      })
    : Array.from(groupMap.entries());

  const selectedUser = users.find((u) => u.id === parseInt(form.assignedTo));

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Assign Task</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Create a task and assign it to a team member — an email will be sent automatically</p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowManage((v) => !v)}
            className="shrink-0 px-3 py-2 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-muted text-foreground"
          >
            {showManage ? "Done" : "Manage who appears"}
          </button>
        )}
      </div>

      {/* Bulk import from Excel/CSV — Title + AssignTo columns required. */}
      <div className="mb-5 bg-card rounded-xl border border-border shadow-sm p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-bold text-foreground">📥 Bulk import from Excel</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Columns: <code>Title</code>, <code>AssignTo</code> (username) required. Optional: <code>Description</code>, <code>Priority</code>, <code>Category</code>, <code>DueDate</code>, <code>Type</code>.
            </p>
          </div>
          <label className="shrink-0 px-3 py-2 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-muted text-foreground cursor-pointer">
            {importBusy ? "Importing…" : "Choose file"}
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={importBusy} onChange={handleExcelImport} />
          </label>
        </div>
        {importResult && (
          <div className="mt-3 text-xs">
            <div className="text-green-700 font-semibold">{importResult.ok} task{importResult.ok === 1 ? "" : "s"} imported ✅</div>
            {importResult.failed.length > 0 && (
              <div className="mt-1 text-red-600">
                {importResult.failed.length} skipped:
                <ul className="list-disc list-inside">
                  {importResult.failed.slice(0, 10).map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Manage assignee visibility — Boss/MIS pick who shows in the picker. */}
      {canManage && showManage && (
        <div className="mb-5 bg-card rounded-xl border border-border shadow-sm p-5">
          <div className="mb-3">
            <div className="text-sm font-bold text-foreground">Who appears in the assign list</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Turn people off to hide them from the "Assign To" dropdown. This only changes the list — it does not affect their login or existing tasks.
            </p>
          </div>
          <div className="space-y-4">
            {(() => {
              const manageable = users
                .filter((u) => !!u.username)
                .sort((a, b) => (a.center ?? "").localeCompare(b.center ?? "") || a.name.localeCompare(b.name));
              const byCenter = new Map<string, typeof users>();
              for (const u of manageable) {
                const c = u.center ?? "—";
                if (!byCenter.has(c)) byCenter.set(c, []);
                byCenter.get(c)!.push(u);
              }
              return Array.from(byCenter.entries()).map(([center, members]) => (
                <div key={center}>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">{center}</div>
                  <div className="flex flex-wrap gap-2">
                    {members.map((u) => {
                      const on = u.assignable !== false;
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => toggleAssignable(u.id, !on)}
                          disabled={updateUser.isPending}
                          title={on ? "Click to hide from assign list" : "Click to show in assign list"}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 ${
                            on
                              ? "bg-primary/10 border-primary/40 text-foreground"
                              : "bg-muted border-border text-muted-foreground line-through"
                          }`}
                        >
                          <span className={`inline-block w-2 h-2 rounded-full ${on ? "bg-green-500" : "bg-muted-foreground/40"}`} />
                          {u.name}
                          <span className="text-[10px] opacity-70">({u.role})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* Success popup */}
      {success && (
        <div className="mb-5 p-4 bg-green-50 border border-green-200 dark:bg-green-950/40 dark:border-green-800 rounded-xl flex items-start gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <div className="font-bold text-green-800 dark:text-green-300 text-sm">Task assigned!</div>
            <div className="text-green-700 dark:text-green-300 text-sm mt-0.5">
              "<span className="font-semibold">{success.title}</span>" — assigned to <span className="font-semibold">{success.assignee}</span>
              {form.sendEmail && " · Email sent ✉"}
            </div>
            <button onClick={() => setSuccess(null)} className="mt-2 text-xs text-green-600 dark:text-green-300 underline">Dismiss</button>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 dark:bg-red-950/40 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">{error}</div>
      )}

      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Title */}
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1.5">Task Title *</label>
            <input
              data-testid="input-task-title"
              type="text" value={form.title} onChange={(e) => set("title", e.target.value)}
              className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Enter task name..." required />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1.5">Description</label>
            <textarea
              data-testid="input-task-description"
              value={form.description} onChange={(e) => set("description", e.target.value)} rows={2}
              className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              placeholder="Task details..." />
          </div>

          {/* Assign To — FULL NAMES with dept grouping */}
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1.5">Assign To (Full Name)</label>
            <select
              data-testid="select-assigned-to"
              value={form.assignedTo} onChange={(e) => handleAssignee(e.target.value)}
              className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">— Unassigned —</option>
              {pickerGroups.map(([label, members]) => (
                <optgroup key={label} label={`── ${label} ──`}>
                  {members.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.role}){groupByCenter ? "" : ` — ${u.center}`}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {/* Selected user preview */}
            {selectedUser && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/30 rounded-lg">
                <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold shrink-0">{selectedUser.name[0]}</div>
                <div>
                  <div className="text-sm font-bold text-primary">{selectedUser.name}</div>
                  <div className="text-xs text-primary">{selectedUser.role} · {selectedUser.department}{selectedUser.email ? ` · ${selectedUser.email}` : " · ⚠ No email set"}</div>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            {/* Priority */}
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1.5">Priority</label>
              <select data-testid="select-priority" value={form.priority} onChange={(e) => set("priority", e.target.value)}
                className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            {/* Due Date */}
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1.5">Due Date</label>
              <input type="date" data-testid="input-due-date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)}
                className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            {/* Due Time — popup reminder is shown at this time on the due date */}
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1.5">⏰ Time (popup)</label>
              <input type="time" data-testid="input-due-time" value={form.dueTime} onChange={(e) => set("dueTime", e.target.value)}
                className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          </div>
          {form.dueTime && !form.dueDate && (
            <p className="-mt-2 text-xs text-amber-600 dark:text-amber-300">Please also set a Due Date for the time — otherwise the popup reminder won't appear.</p>
          )}

          <div className="grid grid-cols-2 gap-4">
            {/* Task Type */}
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1.5">Task Type</label>
              <select data-testid="select-task-type" value={form.type} onChange={(e) => set("type", e.target.value)}
                className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="one_time">One Time</option>
              </select>
            </div>
            {/* Category */}
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1.5">Category</label>
              <select data-testid="select-category" value={form.category} onChange={(e) => set("category", e.target.value)}
                className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="">No Category</option>
                {categories.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              <button type="button" onClick={() => { setShowCatManage((s) => !s); setCatError(""); }}
                className="mt-1.5 text-xs font-semibold text-primary hover:underline" data-testid="btn-toggle-category-manage">
                {showCatManage ? "Done" : "＋ Add / remove categories"}
              </button>
              {showCatManage && (
                <div className="mt-2 rounded-lg border border-border bg-muted/40 p-3 space-y-2">
                  {catError && <div className="text-xs text-red-600 dark:text-red-400">{catError}</div>}
                  <div className="flex gap-2">
                    <input value={newCat} onChange={(e) => setNewCat(e.target.value)}
                      placeholder="New category name" data-testid="input-new-category"
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddCategory(); } }}
                      className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                    <button type="button" onClick={handleAddCategory} disabled={createCategory.isPending || !newCat.trim()}
                      data-testid="btn-add-category"
                      className="px-3 py-2 bg-primary text-white font-bold rounded-lg text-sm disabled:opacity-60">
                      {createCategory.isPending ? "…" : "Add"}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {categories.map((c: any) => (
                      <span key={c.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-card border border-border text-xs">
                        {c.name}
                        <button type="button" onClick={() => handleRemoveCategory(c.id, c.name)}
                          disabled={deleteCategory.isPending}
                          className="text-muted-foreground hover:text-red-600 disabled:opacity-50" title="Remove">✕</button>
                      </span>
                    ))}
                    {categories.length === 0 && <span className="text-xs text-muted-foreground">No categories yet.</span>}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Department */}
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1.5">Department</label>
            <select data-testid="select-department" value={form.department} onChange={(e) => set("department", e.target.value)}
              className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">All Departments</option>
              {DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          {/* Company (optional) — Head Office only — appends " - {Company}" to the saved task title */}
          {viewerIsHeadOffice && (
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1.5">Company (optional)</label>
            <select value={company} onChange={(e) => setCompany(e.target.value)} data-testid="select-company"
              className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">— None —</option>
              {companies.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            {canManageCompanies && (
              <button type="button" onClick={() => { setShowCompanyManage((s) => !s); setCompanyError(""); }}
                className="mt-1.5 text-xs font-semibold text-primary hover:underline" data-testid="btn-toggle-company-manage">
                {showCompanyManage ? "Done" : "＋ Add / remove companies"}
              </button>
            )}
            {company && (
              <p className="text-xs text-muted-foreground mt-1">
                Will be saved as:{" "}
                <span className="font-semibold text-foreground">
                  {form.title.trim() ? `${form.title.trim()} - ${company}` : `… - ${company}`}
                </span>
              </p>
            )}
            {canManageCompanies && showCompanyManage && (
              <div className="mt-2 rounded-lg border border-border bg-muted/40 p-3 space-y-2">
                {companyError && <div className="text-xs text-red-600 dark:text-red-400">{companyError}</div>}
                <div className="flex gap-2">
                  <input value={newCompany} onChange={(e) => setNewCompany(e.target.value)}
                    placeholder="New company name" data-testid="input-new-company"
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddCompany(); } }}
                    className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                  <button type="button" onClick={handleAddCompany} disabled={createCompany.isPending || !newCompany.trim()}
                    data-testid="btn-add-company"
                    className="px-3 py-2 bg-primary text-white font-bold rounded-lg text-sm disabled:opacity-60">
                    {createCompany.isPending ? "…" : "Add"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {companies.map((c) => (
                    <span key={c.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-card border border-border text-xs">
                      {c.name}
                      <button type="button" onClick={() => handleRemoveCompany(c.id, c.name)}
                        disabled={deleteCompany.isPending}
                        className="text-muted-foreground hover:text-red-600 disabled:opacity-50" title="Remove">✕</button>
                    </span>
                  ))}
                  {companies.length === 0 && <span className="text-xs text-muted-foreground">No companies yet.</span>}
                </div>
              </div>
            )}
          </div>
          )}

          {/* Remark */}
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1.5">Remark / Note</label>
            <textarea
              value={form.remark} onChange={(e) => set("remark", e.target.value)} rows={2}
              placeholder="Any extra note or instruction..."
              className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
          </div>

          {/* Email toggle */}
          <div className="flex items-center gap-3 p-3 bg-primary/10 border border-primary/30 rounded-lg">
            <input type="checkbox" id="sendEmail" checked={form.sendEmail} onChange={(e) => set("sendEmail", e.target.checked)}
              className="w-4 h-4 text-primary rounded" />
            <label htmlFor="sendEmail" className="text-sm font-medium text-primary cursor-pointer">
              ✉ Send email notification to assignee
            </label>
          </div>

          <button type="submit" data-testid="btn-create-task" disabled={createTask.isPending}
            className="w-full py-3 bg-primary text-white font-bold rounded-xl text-sm hover:bg-primary/90 disabled:opacity-60 transition">
            {createTask.isPending ? "Creating..." : "✔ Create & Assign Task"}
          </button>
        </form>
      </div>
    </div>
  );
}
