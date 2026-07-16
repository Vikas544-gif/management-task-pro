import { useState, useMemo, useEffect, useRef } from "react";
import {
  useListTasks, useListUsers, useListCategories, useListAttendance,
  useCreateCategory, useDeleteCategory,
  useUpdateTask, useUpdateTaskStatus, useDeleteTask, useListTaskTransfers,
  useListComplianceCompanies, useCreateComplianceCompany, useDeleteComplianceCompany,
  getListTasksQueryKey, getGetTaskSummaryQueryKey, getListTaskTransfersQueryKey, getListComplianceCompaniesQueryKey, getListCategoriesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn, formatDate, isOverdue, buildHierarchySet, buildAbsenceSet, isTaskHiddenByAbsence, isAllCentersViewer, resolveAllowedCenters, resolveAssignableUsers, canEditTask, canOpenEditTask, canDoTask } from "@/lib/utils";
import { DateRangePicker } from "@/components/DateRangePicker";

type TaskType = "all" | "daily" | "weekly" | "monthly";

const STATUSES = ["pending", "inProgress", "done"] as const;
type StatusKey = typeof STATUSES[number];
const STATUS_LABELS: Record<string, string> = { pending: "Pending", inProgress: "In Progress", done: "Done" };
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground border-border",
  inProgress: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
  done: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800",
};

// Ranks for sensible (not alphabetical) sorting of priority & status columns.
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const STATUS_RANK: Record<string, number> = { pending: 0, inProgress: 1, done: 2 };
type SortKey = "title" | "assignedTo" | "priority" | "type" | "due" | "status";
function sortValue(t: any, key: SortKey): string | number {
  switch (key) {
    case "title": return (t.title ?? "").toLowerCase();
    case "assignedTo": return (t.assignedToName ?? "").toLowerCase();
    case "priority": return PRIORITY_RANK[t.priority] ?? 99;
    case "type": return (t.type ?? "").toLowerCase();
    case "due": return t.dueDate ?? "";
    case "status": return STATUS_RANK[t.status] ?? 99;
  }
}

// ── Pill button helper ────────────────────────────────────────────
function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1 rounded-full text-xs font-semibold transition border",
        active
          ? "bg-primary text-white border-primary"
          : "bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-primary"
      )}
    >
      {label}
    </button>
  );
}

// ── Completion Toast ──────────────────────────────────────────────
function CompletionToast({ taskTitle, assigneeName, onClose }: { taskTitle: string; assigneeName: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }} onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center mx-auto mb-4">
          <span className="text-4xl">✅</span>
        </div>
        <h2 className="text-xl font-extrabold text-foreground mb-1">Task Complete!</h2>
        <p className="text-sm text-muted-foreground mb-2">
          <span className="font-semibold text-foreground">"{taskTitle}"</span>
        </p>
        {assigneeName && (
          <p className="text-sm text-primary font-medium mb-5">✨ {assigneeName} completed this!</p>
        )}
        <button onClick={onClose} className="w-full py-2.5 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition">
          Great! 🎉
        </button>
      </div>
    </div>
  );
}

// ── Edit Modal ────────────────────────────────────────────────────
interface EditModalProps {
  task: any;
  users: any[];
  categories: any[];
  onClose: () => void;
  onSaved: () => void;
  onCompleted: (title: string, assignee: string) => void;
  canReassign: boolean;
  groupByCenter: boolean;
  canManageCompanies: boolean;
  showCompany: boolean;
}
function EditModal({ task, users, categories, onClose, onSaved, onCompleted, canReassign, groupByCenter, canManageCompanies, showCompany }: EditModalProps) {
  const qc = useQueryClient();
  const updateTask = useUpdateTask();
  const [form, setForm] = useState({
    title: task.title ?? "", description: task.description ?? "",
    assignedTo: task.assignedTo ? String(task.assignedTo) : "",
    assignedBy: task.assignedBy ? String(task.assignedBy) : "",
    dueDate: task.dueDate ?? "", dueTime: task.dueTime ?? "", priority: task.priority ?? "medium",
    type: task.type ?? "daily", status: task.status ?? "pending",
    category: task.category ?? "", department: task.department ?? "",
    remark: task.remark ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [reasonError, setReasonError] = useState("");
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Company (optional) — mirrors the Assign Task form. The company is stored as a
  // trailing " - {Company}" on the task title; we split it out when the modal opens
  // and re-append it on save, so the Title field shows only the base title.
  const { data: companies = [] } = useListComplianceCompanies();
  const createCompany = useCreateComplianceCompany();
  const deleteCompany = useDeleteComplianceCompany();
  const createCategory = useCreateCategory();
  const deleteCategory = useDeleteCategory();
  const [showCatManage, setShowCatManage] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [catError, setCatError] = useState("");
  const [company, setCompany] = useState("");
  const [showCompanyManage, setShowCompanyManage] = useState(false);
  const [newCompany, setNewCompany] = useState("");
  const [companyError, setCompanyError] = useState("");
  const companyInit = useRef(false);
  const titleEdited = useRef(false);

  // Once the company list loads, detect a trailing " - {Company}" on the title,
  // pre-select that company, and strip the suffix from the editable Title field.
  // Skip if the user already started editing the title (don't clobber their input).
  useEffect(() => {
    if (companyInit.current || titleEdited.current || companies.length === 0) return;
    companyInit.current = true;
    const title = task.title ?? "";
    const match = companies.find((c: any) => title.endsWith(` - ${c.name}`));
    if (match) {
      setCompany(match.name);
      setForm((f) => ({ ...f, title: title.slice(0, title.length - ` - ${match.name}`.length) }));
    }
  }, [companies, task.title]);

  const handleAddCompany = () => {
    setCompanyError("");
    const name = newCompany.trim();
    if (!name) return;
    if (companies.some((c: any) => c.name.toLowerCase() === name.toLowerCase())) {
      setCompanyError("That company already exists");
      return;
    }
    createCompany.mutate(
      { data: { name } },
      {
        onSuccess: (created: any) => {
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

  const handleSave = () => {
    setReasonError("");
    setSaving(true);
    const finalTitle = company ? `${form.title.trim()} - ${company}` : form.title.trim();
    const willComplete = form.status === "done" && task.status !== "done";
    const newAssignee = users.find((u) => u.id === parseInt(form.assignedTo));
    updateTask.mutate(
      { id: task.id, data: { title: finalTitle, description: form.description || null, assignedTo: form.assignedTo ? parseInt(form.assignedTo) : null, assignedBy: form.assignedBy ? parseInt(form.assignedBy) : null, dueDate: form.dueDate || null, dueTime: form.dueTime || null, priority: form.priority, type: form.type, status: form.status, category: form.category || null, department: form.department || null, remark: form.remark || null } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
          qc.invalidateQueries({ queryKey: getGetTaskSummaryQueryKey() });
          setSaving(false);
          if (willComplete) onCompleted(finalTitle, newAssignee?.name ?? task.assignedToName ?? "");
          else onSaved();
          onClose();
        },
        onError: () => setSaving(false),
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-extrabold text-foreground text-lg">Edit Task</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-muted hover:bg-muted text-muted-foreground font-bold">✕</button>
        </div>
        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-3">
          <div><label className="block text-xs font-bold text-muted-foreground mb-1">Task Title *</label>
            <input value={form.title} onChange={(e) => { titleEdited.current = true; set("title", e.target.value); }} className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
          <div><label className="block text-xs font-bold text-muted-foreground mb-1">Description</label>
            <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none" /></div>
          {canReassign && (
          <div><label className="block text-xs font-bold text-muted-foreground mb-1">Assign To</label>
            <select value={form.assignedTo} onChange={(e) => set("assignedTo", e.target.value)} className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">— Unassigned —</option>
              {groupUsersForPicker(users.filter((u) => !!u.username && u.assignable !== false), groupByCenter).map(([label, members]) => (
                <optgroup key={label} label={`── ${label} ──`}>
                  {members.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role}){groupByCenter ? "" : ` — ${u.center}`}</option>)}
                </optgroup>
              ))}
            </select></div>
          )}
          {canReassign && (
          <div><label className="block text-xs font-bold text-muted-foreground mb-1">Assigned By</label>
            <select value={form.assignedBy} onChange={(e) => set("assignedBy", e.target.value)} className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">— Self (no assigner) —</option>
              {groupUsersForPicker(users.filter((u) => !!u.username), groupByCenter).map(([label, members]) => (
                <optgroup key={label} label={`── ${label} ──`}>
                  {members.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role}){groupByCenter ? "" : ` — ${u.center}`}</option>)}
                </optgroup>
              ))}
            </select></div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-bold text-muted-foreground mb-1">Status</label>
              <select value={form.status} onChange={(e) => set("status", e.target.value)} className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring font-semibold ${STATUS_COLORS[form.status] ?? ""}`}>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></div>
            <div><label className="block text-xs font-bold text-muted-foreground mb-1">Priority</label>
              <select value={form.priority} onChange={(e) => set("priority", e.target.value)} className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                {["low","medium","high","urgent"].map((p) => <option key={p} value={p}>{p[0].toUpperCase()+p.slice(1)}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-bold text-muted-foreground mb-1">Type</label>
              <select value={form.type} onChange={(e) => set("type", e.target.value)} className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                {[["daily","Daily"],["weekly","Weekly"],["monthly","Monthly"],["one_time","One Time"]].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><label className="block text-xs font-bold text-muted-foreground mb-1">Due Date</label>
              <input type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-bold text-muted-foreground mb-1">⏰ Time (popup reminder)</label>
              <input type="time" value={form.dueTime} onChange={(e) => set("dueTime", e.target.value)} className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">Category</label>
              <select value={form.category} onChange={(e) => set("category", e.target.value)} className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="">No Category</option>
                {(categories ?? []).map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}</select>
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
                    {(categories ?? []).map((c: any) => (
                      <span key={c.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-card border border-border text-xs">
                        {c.name}
                        <button type="button" onClick={() => handleRemoveCategory(c.id, c.name)}
                          disabled={deleteCategory.isPending}
                          className="text-muted-foreground hover:text-red-600 disabled:opacity-50" title="Remove">✕</button>
                      </span>
                    ))}
                    {(categories ?? []).length === 0 && <span className="text-xs text-muted-foreground">No categories yet.</span>}
                  </div>
                </div>
              )}
            </div>
            <div><label className="block text-xs font-bold text-muted-foreground mb-1">Department</label>
              <select value={form.department} onChange={(e) => set("department", e.target.value)} className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="">All Depts</option>
                {["Management","Accounts","MIS","HR","IT"].map((d) => <option key={d} value={d}>{d}</option>)}</select></div>
          </div>
          {/* Company (optional) — Head Office only — appends " - {Company}" to the saved task title */}
          {showCompany && (
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Company (optional)</label>
            <select value={company} onChange={(e) => setCompany(e.target.value)} data-testid="select-company"
              className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">— None —</option>
              {companies.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
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
                  {companies.map((c: any) => (
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
          <div><label className="block text-xs font-bold text-muted-foreground mb-1">Remark / Note</label>
            <textarea value={form.remark} onChange={(e) => { set("remark", e.target.value); if (reasonError) setReasonError(""); }} rows={2} placeholder="Add a note..." className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none ${reasonError ? "border-red-400" : "border-border"}`} />
            {reasonError && <p className="text-xs text-red-500 mt-1">{reasonError}</p>}</div>
        </div>
        <div className="px-6 py-4 border-t border-border flex gap-2 bg-background rounded-b-2xl">
          <button onClick={handleSave} disabled={saving || !form.title.trim()}
            className="flex-1 py-2.5 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 disabled:opacity-50 transition text-sm">
            {saving ? "Saving..." : "Save Changes"}</button>
          <button onClick={onClose} className="px-5 py-2.5 bg-muted text-foreground font-semibold rounded-xl hover:bg-muted transition text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Transfer Modal ────────────────────────────────────────────────
// A focused "hand this task to someone else" action available to every user
// on any task they can see (a pure reassignment — no other field changes).
// Preferred display order of companies/centers; any others fall after these.
const CENTER_ORDER = ["Head Office", "Thane Center", "Malad Center", "Pune Center", "Navi Mumbai Center"];

// Group users by company/center so the picker shows the company name as the
// "── Company ──" group header (always visible, even when an option's text is
// truncated on mobile). Each person is shown as "Name (Role)". This view is
// used ONLY for Head-Office viewers (who can assign across companies).
function groupUsersByCenter(list: any[]): [string, any[]][] {
  const m = new Map<string, any[]>();
  for (const u of list) {
    const center = u.center || "Other";
    if (!m.has(center)) m.set(center, []);
    m.get(center)!.push(u);
  }
  return Array.from(m.entries()).sort((a, b) => {
    const ia = CENTER_ORDER.indexOf(a[0]);
    const ib = CENTER_ORDER.indexOf(b[0]);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a[0].localeCompare(b[0]);
  });
}

// Group users by department — the default view for branch (non-Head-Office)
// viewers, who only assign within their own center. Each person is shown as
// "Name (Role) — Center".
function groupUsersByDept(list: any[]): [string, any[]][] {
  const m = new Map<string, any[]>();
  for (const u of list) {
    const dept = u.department || "Other";
    if (!m.has(dept)) m.set(dept, []);
    m.get(dept)!.push(u);
  }
  return Array.from(m.entries());
}

// A picker is grouped by company only for Head-Office viewers; everyone else
// keeps the simpler department grouping with the center shown inline.
function groupUsersForPicker(list: any[], byCenter: boolean): [string, any[]][] {
  return byCenter ? groupUsersByCenter(list) : groupUsersByDept(list);
}

function TransferModal({ task, users, onClose, onSaved, groupByCenter }: { task: any; users: any[]; onClose: () => void; onSaved: () => void; groupByCenter: boolean }) {
  const qc = useQueryClient();
  const updateTask = useUpdateTask();
  const [assignedTo, setAssignedTo] = useState(task.assignedTo ? String(task.assignedTo) : "");
  const [saving, setSaving] = useState(false);
  const candidates = users.filter((u) => !!u.username && u.assignable !== false);
  const unchanged = !assignedTo || parseInt(assignedTo) === task.assignedTo;

  const handleTransfer = () => {
    if (unchanged) return;
    setSaving(true);
    updateTask.mutate(
      { id: task.id, data: { assignedTo: parseInt(assignedTo) } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
          qc.invalidateQueries({ queryKey: getGetTaskSummaryQueryKey() });
          qc.invalidateQueries({ queryKey: getListTaskTransfersQueryKey() });
          setSaving(false);
          onSaved();
          onClose();
        },
        onError: () => setSaving(false),
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-extrabold text-foreground text-lg">🔄 Transfer Task</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-muted hover:bg-muted text-muted-foreground font-bold">✕</button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div>
            <div className="text-xs font-bold text-muted-foreground mb-1">Task</div>
            <div className="text-sm font-semibold text-foreground">{task.title}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Currently: {task.assignedToName ?? "Unassigned"}</div>
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">Transfer To</label>
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">Select a person…</option>
              {groupUsersForPicker(candidates, groupByCenter).map(([label, members]) => (
                <optgroup key={label} label={`── ${label} ──`}>
                  {members.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role}){groupByCenter ? "" : ` — ${u.center}`}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-border flex gap-2 bg-background rounded-b-2xl">
          <button onClick={handleTransfer} disabled={saving || unchanged}
            className="flex-1 py-2.5 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 disabled:opacity-50 transition text-sm">
            {saving ? "Transferring..." : "Transfer Task"}</button>
          <button onClick={onClose} className="px-5 py-2.5 bg-muted text-foreground font-semibold rounded-xl hover:bg-muted transition text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Transfer History Modal ────────────────────────────────────────
// A read-only log of every task hand-off the current user is allowed to see.
// Transfers are grouped per task and ordered oldest → newest so each task's
// full journey is clear: who held it first, every hand-off in sequence (who
// passed it to whom, and who performed the transfer), and who has it now.
function fmtTransferWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Unknown date";
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function TransferHistoryModal({ onClose }: { onClose: () => void }) {
  const { data: transfers = [], isLoading } = useListTaskTransfers();

  // Group by task, sort each task's hand-offs oldest → newest, and surface the
  // task with the most recent activity first.
  const groups = useMemo(() => {
    const m = new Map<number, any[]>();
    for (const t of transfers as any[]) {
      const key = t.taskId ?? -1;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(t);
    }
    const arr = Array.from(m.values()).map((list) =>
      [...list].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    );
    arr.sort(
      (a, b) =>
        new Date(b[b.length - 1].createdAt).getTime() -
        new Date(a[a.length - 1].createdAt).getTime()
    );
    return arr;
  }, [transfers]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-extrabold text-foreground flex items-center gap-2">
            🔄 Transfer History <span className="text-xs font-semibold text-muted-foreground">({transfers.length})</span>
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg px-1" aria-label="Close">✕</button>
        </div>
        <div className="overflow-y-auto p-4">
          {isLoading ? (
            <div className="px-2 py-10 text-center text-muted-foreground text-sm">Loading…</div>
          ) : groups.length === 0 ? (
            <div className="px-2 py-10 text-center text-muted-foreground text-sm">No transfers yet</div>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map((steps) => {
                const first = steps[0];
                const last = steps[steps.length - 1];
                return (
                  <div key={first.taskId ?? first.id} className="rounded-xl border border-border bg-background overflow-hidden">
                    {/* Task header: title, status, and a one-line summary */}
                    <div className="px-4 py-3 border-b border-border bg-muted/40">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="text-sm font-extrabold text-foreground">{first.taskTitle ?? "Task"}</div>
                        {last.taskStatus && <span className="text-[10px] uppercase font-bold text-muted-foreground">{last.taskStatus}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
                        <span>Originally with</span>
                        <span className="font-semibold text-foreground">{first.fromUserName ?? "—"}</span>
                        <span>→ now with</span>
                        <span className="font-semibold text-foreground">{last.toUserName ?? "—"}</span>
                        <span className="text-[10px] font-bold text-muted-foreground">· {steps.length} transfer{steps.length > 1 ? "s" : ""}</span>
                      </div>
                    </div>
                    {/* Ordered hand-offs: step number, from → to, by whom, when */}
                    <ol className="divide-y divide-border">
                      {steps.map((t, i) => (
                        <li key={t.id} className="flex items-start gap-3 px-4 py-2.5">
                          <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                          <div className="min-w-0">
                            <div className="text-xs text-foreground flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold">{t.fromUserName ?? "—"}</span>
                              <span className="text-muted-foreground">→</span>
                              <span className="font-semibold">{t.toUserName ?? "—"}</span>
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              {t.transferredByName ? `By ${t.transferredByName}` : "By system"}
                              {" · "}
                              {fmtTransferWhen(t.createdAt)}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Date helpers for default "current period" filter ──────────────
function pad2(n: number) { return String(n).padStart(2, "0"); }
function fmtDate(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function defaultDateFilter(_type: TaskType): { mode: "all" | "range" | "month"; from: string; to: string; month: string } {
  // Every tab (all / daily / weekly / monthly) now defaults to NO date
  // restriction, so past AND future tasks are visible to everyone.
  // Users can still narrow the window manually via the date filter controls.
  return { mode: "all", from: "", to: "", month: "" };
}

// ── Main TaskList ─────────────────────────────────────────────────
interface TaskListProps {
  type?: TaskType;
  currentUser: { id: number; name: string; role: string; department: string };
}

export default function TaskList({ type = "all", currentUser }: TaskListProps) {
  const [search, setSearch] = useState("");
  const [filterCenter, setFilterCenter] = useState("All");
  const [filterDept, setFilterDept] = useState("All");
  const [filterMember, setFilterMember] = useState("All");
  const [filterPriority, setFilterPriority] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterCategory, setFilterCategory] = useState("All");
  const [dateMode, setDateMode] = useState<"all" | "range" | "month">(() => defaultDateFilter(type).mode);
  const [fromDate, setFromDate] = useState(() => defaultDateFilter(type).from);
  const [toDate, setToDate] = useState(() => defaultDateFilter(type).to);
  const [month, setMonth] = useState(() => defaultDateFilter(type).month); // YYYY-MM
  const [editingTask, setEditingTask] = useState<any | null>(null);
  const [transferTask, setTransferTask] = useState<any | null>(null);
  const [showTransferHistory, setShowTransferHistory] = useState(false);
  const [completionToast, setCompletionToast] = useState<{ title: string; assignee: string } | null>(null);
  const [reasonModal, setReasonModal] = useState<{ id: number; status: string; title: string; remark: string } | null>(null);
  // KPI drill-down modal: click a summary card to open a task table popup.
  const [detailStatus, setDetailStatus] = useState<"pending" | "inProgress" | "done" | "all" | null>(null);
  const [detailPerson, setDetailPerson] = useState<number | "none" | "all">("all");
  const [detailSort, setDetailSort] = useState<"az" | "za">("az");
  const openDetail = (s: "pending" | "inProgress" | "done" | "all") => { setDetailStatus(s); setDetailPerson("all"); };
  const closeDetail = () => { setDetailStatus(null); setDetailPerson("all"); };
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [saveFlash, setSaveFlash] = useState("");
  // On-page task-type tabs (mirrors the sidebar route but switchable in place).
  const [typeFilter, setTypeFilter] = useState<TaskType>(type);
  const [onlyMine, setOnlyMine] = useState(false); // "My Tasks" quick filter
  // Bulk selection of task rows + the bulk "Add Remark" modal text (null = closed).
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkRemark, setBulkRemark] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false); // a bulk op is in flight
  const todayStr = fmtDate(new Date());
  const qc = useQueryClient();

  const params = typeFilter !== "all" ? { type: typeFilter } : {};
  const { data: tasks, isLoading } = useListTasks(params);
  const { data: allUsers = [] } = useListUsers();
  const { data: attendance = [] } = useListAttendance({});
  const { data: categories = [] } = useListCategories();
  const updateStatus = useUpdateTaskStatus();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  // Keep the on-page type tabs in sync when navigated via the sidebar route.
  useEffect(() => {
    setTypeFilter(type);
  }, [type]);

  // Reset date filter to the active type's default period, and clear any row
  // selection, whenever the active task type changes.
  useEffect(() => {
    const d = defaultDateFilter(typeFilter);
    setDateMode(d.mode);
    setFromDate(d.from);
    setToDate(d.to);
    setMonth(d.month);
    setSelected(new Set());
  }, [typeFilter]);

  // ── Hierarchy: recursive org-chart subtree ─────────────────────
  // allowedIds = currentUser + ALL direct & indirect reports (BFS).
  // MIS is a special case: it sees EVERY center (including Head Office),
  // mirroring Dashboard/Reports/Team — not a reports-based subtree.
  const isMis = isAllCentersViewer(currentUser);
  // Per-user center restriction (Boss/MIS only). null = no restriction.
  const allowedCenters = useMemo(
    () => resolveAllowedCenters(allUsers.find((u) => u.id === currentUser.id) ?? null, allUsers),
    [allUsers, currentUser.id]
  );
  const allowedIds = useMemo(
    () => {
      let ids = isMis
        ? new Set(allUsers.map((u) => u.id))
        : buildHierarchySet(currentUser.id, allUsers);
      if (allowedCenters) {
        const centerOf = new Map(allUsers.map((u) => [u.id, u.center]));
        ids = new Set([...ids].filter((id) => { const c = centerOf.get(id); return !!c && allowedCenters.has(c); }));
      }
      return ids;
    },
    [currentUser.id, allUsers, isMis, allowedCenters]
  );
  // If the full set == entire org, we show all (no badge shown)
  const seesAll = allowedIds.size >= allUsers.length;

  // Visible users for the Member filter pill (only hierarchy members)
  const visibleUsers = useMemo(
    () => allUsers.filter((u) => allowedIds.has(u.id)),
    [allUsers, allowedIds]
  );

  // Who the viewer may pick in the Edit Task "Assign To" / "Assigned By"
  // dropdowns. This is the ASSIGN scope (shared with the Assign Task page),
  // deliberately SEPARATE from `visibleUsers` (the task-DATA scope) — a viewer
  // can be allowed to assign to people whose tasks they otherwise can't see. The
  // task's current assignee/assigner are always merged in so the existing values
  // still render even if they fall outside the viewer's assign scope.
  const editAssignUsers = useMemo(() => {
    if (!editingTask) return [];
    const me = allUsers.find((u) => u.id === currentUser.id) ?? null;
    const base = resolveAssignableUsers(me, allUsers);
    const ids = new Set(base.map((u) => u.id));
    const extras = [editingTask.assignedTo, editingTask.assignedBy]
      .filter((x): x is number => x != null)
      .map((id) => allUsers.find((u) => u.id === id))
      .filter((u): u is NonNullable<typeof u> => !!u && !ids.has(u.id));
    return [...base, ...extras];
  }, [editingTask, allUsers, currentUser.id]);

  // userId → center map, used to scope tasks by the selected center
  const userCenter = useMemo(
    () => new Map(allUsers.map((u) => [u.id, u.center])),
    [allUsers]
  );
  const myCenter = userCenter.get(currentUser.id);
  // Company-grouped assignee pickers are shown ONLY to Head-Office viewers
  // (who can assign across companies). Branch viewers keep the dept grouping.
  const viewerIsHeadOffice = myCenter === "Head Office";
  // Company add/remove is available to every user (mirrors category management).
  const canManageCompanies = true;

  // Center filter pills — Head Office first, then known centers in display order
  const centerOptions = useMemo(() => {
    const set = new Set(visibleUsers.map((u) => u.center).filter((c): c is string => Boolean(c)));
    const order = ["Head Office", "Thane Center", "Malad Center", "Pune Center", "Navi Mumbai Center"];
    const rank = (c: string) => { const i = order.indexOf(c); return i === -1 ? order.length : i; };
    return ["All", ...Array.from(set).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))];
  }, [visibleUsers]);

  // Tasks that this user is allowed to see (hierarchy-gated)
  // = tasks assigned to anyone in their hierarchy subtree
  //   OR tasks this user assigned to someone else (delegated tasks they should track)
  const absenceSet = useMemo(() => buildAbsenceSet(attendance), [attendance]);
  const hierarchyTasks = useMemo(() => {
    if (!tasks) return [];
    const visible = tasks.filter((t) => !isTaskHiddenByAbsence(t, absenceSet));
    if (seesAll) return visible;
    return visible.filter((t) =>
      (t.assignedTo != null && allowedIds.has(t.assignedTo)) ||
      // A user can ALWAYS see their own tasks (assigned to or by them), even when
      // those tasks fall outside their hierarchy/center scope. This matters for MIS,
      // which is scoped to the outer centers but still needs to see its own
      // Head Office tasks here, mirroring the My Tasks page.
      t.assignedTo === currentUser.id ||
      t.assignedBy === currentUser.id
    );
  }, [tasks, allowedIds, currentUser.id, seesAll, absenceSet]);

  // ── Pill filter logic ─────────────────────────────────────────
  const filtered = useMemo(() => {
    return hierarchyTasks.filter((t) => {
      if (onlyMine && t.assignedTo !== currentUser.id && t.assignedBy !== currentUser.id) return false;
      if (filterCenter !== "All" && (t.assignedTo == null || userCenter.get(t.assignedTo) !== filterCenter)) return false;
      if (filterDept !== "All" && t.department !== filterDept) return false;
      if (filterMember !== "All" && String(t.assignedTo) !== filterMember) return false;
      if (filterPriority !== "All" && t.priority !== filterPriority.toLowerCase()) return false;
      if (filterStatus !== "All") {
        const statusMap: Record<string,string> = { Pending: "pending", "In Progress": "inProgress", Done: "done" };
        if (t.status !== statusMap[filterStatus]) return false;
      }
      if (filterCategory !== "All" && t.category !== filterCategory) return false;
      if (dateMode !== "all") {
        const d = t.dueDate || t.createdAt?.split("T")[0] || "";
        if (!d) return false;
        if (dateMode === "range") {
          if (fromDate && d < fromDate) return false;
          if (toDate && d > toDate) return false;
        } else if (dateMode === "month") {
          if (month && !d.startsWith(month)) return false;
        }
      }
      if (search && !t.title.toLowerCase().includes(search.toLowerCase()) && !(t.assignedToName ?? "").toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [hierarchyTasks, onlyMine, currentUser.id, filterCenter, userCenter, filterDept, filterMember, filterPriority, filterStatus, filterCategory, dateMode, fromDate, toDate, month, search]);

  // Column sorting (applied on top of the filtered set)
  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  // Member pills with counts (from hierarchy-allowed tasks)
  const memberCounts = useMemo(() => {
    const map = new Map<number, number>();
    for (const t of hierarchyTasks) {
      if (t.assignedTo) map.set(t.assignedTo, (map.get(t.assignedTo) ?? 0) + 1);
    }
    return map;
  }, [hierarchyTasks]);

  // Category pills
  const categoryList = useMemo(() => {
    return (categories as any[]).map((c: any) => c.name as string);
  }, [categories]);

  // Department pills: only departments within this user's hierarchy subtree
  const DEPTS = useMemo(() => {
    const ALL_DEPTS = ["Management", "Operations", "Accounts", "MIS", "HR", "IT"];
    const pool = filterCenter === "All" ? visibleUsers : visibleUsers.filter((u) => u.center === filterCenter);
    const set = new Set(pool.map((u) => u.department).filter(Boolean));
    const present = ALL_DEPTS.filter((d) => set.has(d));
    for (const d of set) if (!ALL_DEPTS.includes(d as string)) present.push(d as string);
    return ["All", ...present];
  }, [visibleUsers, filterCenter]);
  const PRIORITIES = ["All", "High", "Medium", "Low"];
  const STATUSES_DISPLAY = ["All", "Pending", "In Progress", "Done"];

  const handleStatusChange = (task: any, status: string) => {
    if (status === task.status) return;
    // A task left Pending (not started / not done) must have a reason.
    // In Progress = work is ongoing, so no reason is required.
    if (status === "pending") {
      setReasonModal({ id: task.id, status, title: task.title, remark: task.remark ?? "" });
      return;
    }
    updateStatus.mutate({ id: task.id, data: { status } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
        qc.invalidateQueries({ queryKey: getGetTaskSummaryQueryKey() });
        if (status === "done") setCompletionToast({ title: task.title, assignee: task.assignedToName ?? "" });
      },
    });
  };

  const submitReason = () => {
    if (!reasonModal) return;
    const remark = reasonModal.remark.trim();
    if (!remark) return;
    updateTask.mutate(
      { id: reasonModal.id, data: { status: reasonModal.status, remark } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
          qc.invalidateQueries({ queryKey: getGetTaskSummaryQueryKey() });
          setReasonModal(null);
        },
        onError: () => alert("Could not save the reason. Please try again."),
      }
    );
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete this task?")) return;
    deleteTask.mutate({ id }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
        qc.invalidateQueries({ queryKey: getGetTaskSummaryQueryKey() });
      },
    });
  };

  // ── Bulk selection + actions ───────────────────────────────────
  // Drop any selected ids that fall out of view under the current filters so the
  // header checkbox and bulk actions only ever act on what's actually visible.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(sorted.map((t) => t.id));
      const next = new Set<number>();
      for (const id of prev) if (visible.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [sorted]);

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectable = sorted;
  const allSelected = selectable.length > 0 && selectable.every((t) => selected.has(t.id));
  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(selectable.map((t) => t.id)));
  };

  const bulkComplete = async () => {
    if (bulkBusy) return;
    const ids = sorted.filter((t) => selected.has(t.id) && t.status !== "done").map((t) => t.id);
    if (ids.length === 0) {
      setSelected(new Set());
      return;
    }
    setBulkBusy(true);
    const results = await Promise.allSettled(
      ids.map((id) => updateStatus.mutateAsync({ id, data: { status: "done" } }))
    );
    setBulkBusy(false);
    qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
    qc.invalidateQueries({ queryKey: getGetTaskSummaryQueryKey() });
    const failedIds = ids.filter((_, i) => results[i].status === "rejected");
    const ok = ids.length - failedIds.length;
    if (ok > 0) {
      setSaveFlash(`${ok} task${ok === 1 ? "" : "s"} completed!`);
      setTimeout(() => setSaveFlash(""), 2500);
    }
    // Keep only the failed rows selected so the user can retry just those.
    setSelected(new Set(failedIds));
    if (failedIds.length > 0) {
      alert(`${failedIds.length} task${failedIds.length === 1 ? "" : "s"} could not be completed. Please try again.`);
    }
  };

  const submitBulkRemark = async () => {
    if (bulkBusy) return;
    const remark = (bulkRemark ?? "").trim();
    if (!remark) return;
    const ids = sorted.filter((t) => selected.has(t.id)).map((t) => t.id);
    if (ids.length === 0) {
      setBulkRemark(null);
      return;
    }
    setBulkBusy(true);
    const results = await Promise.allSettled(
      ids.map((id) => updateTask.mutateAsync({ id, data: { remark } }))
    );
    setBulkBusy(false);
    qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
    qc.invalidateQueries({ queryKey: getGetTaskSummaryQueryKey() });
    const failedIds = ids.filter((_, i) => results[i].status === "rejected");
    const ok = ids.length - failedIds.length;
    if (ok > 0) {
      setSaveFlash(`Remark added to ${ok} task${ok === 1 ? "" : "s"}!`);
      setTimeout(() => setSaveFlash(""), 2500);
    }
    setBulkRemark(null);
    setSelected(new Set(failedIds));
    if (failedIds.length > 0) {
      alert(`Remark could not be added to ${failedIds.length} task${failedIds.length === 1 ? "" : "s"}. Please try again.`);
    }
  };

  const titles: Record<TaskType, string> = { all: "All Tasks", daily: "Daily Tasks", weekly: "Weekly Tasks", monthly: "Monthly Tasks" };

  // ── KPI summary cards (reflect current filtered set) ───────────
  const kpiPending = filtered.filter((t) => t.status === "pending").length;
  const kpiInProgress = filtered.filter((t) => t.status === "inProgress").length;
  const kpiDone = filtered.filter((t) => t.status === "done").length;
  const kpiTotal = filtered.length;
  const kpiRate = kpiTotal > 0 ? Math.round((kpiDone / kpiTotal) * 100) : 0;

  const hasActiveFilter = filterCenter !== "All" || filterDept !== "All" || filterMember !== "All" || filterPriority !== "All" || filterStatus !== "All" || filterCategory !== "All" || dateMode !== "all" || search;

  const csvCell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const handleDownloadReport = () => {
    const headers = ["Title", "Description", "Assigned To", "Assigned By", "Department", "Priority", "Type", "Due Date", "Due Time", "Status", "Category", "Remark"];
    const rows = filtered.map((t) => [
      t.title, t.description ?? "", t.assignedToName ?? "", t.assignedByName ?? "",
      t.department ?? "", t.priority, String(t.type).replace("_", " "),
      t.dueDate ?? "", t.dueTime ?? "", STATUS_LABELS[t.status] ?? t.status,
      t.category ?? "", t.remark ?? "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `task-report-${typeFilter}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setSaveFlash("Report downloaded!");
    setTimeout(() => setSaveFlash(""), 2500);
  };

  return (
    <>
      {editingTask && (
        <EditModal task={editingTask} users={editAssignUsers} categories={categories} onClose={() => setEditingTask(null)}
          canReassign={canEditTask(currentUser, editingTask, allUsers)}
          groupByCenter={viewerIsHeadOffice}
          canManageCompanies={canManageCompanies}
          showCompany={viewerIsHeadOffice}
          onSaved={() => { setSaveFlash("Task saved!"); setTimeout(() => setSaveFlash(""), 2500); }}
          onCompleted={(title, assignee) => setCompletionToast({ title, assignee })} />
      )}
      {transferTask && (
        <TransferModal task={transferTask} users={visibleUsers} onClose={() => setTransferTask(null)}
          groupByCenter={viewerIsHeadOffice}
          onSaved={() => { setSaveFlash("Task transferred!"); setTimeout(() => setSaveFlash(""), 2500); }} />
      )}
      {showTransferHistory && <TransferHistoryModal onClose={() => setShowTransferHistory(false)} />}
      {/* ── KPI drill-down modal: task table popup opened from a summary card ── */}
      {detailStatus && (() => {
        const meta: Record<string, { title: string; icon: string }> = {
          pending: { title: "Pending Tasks", icon: "⚠" },
          inProgress: { title: "In Progress Tasks", icon: "⏱" },
          done: { title: "Completed Tasks", icon: "✓" },
          all: { title: "All Tasks", icon: "📋" },
        };
        const baseList = detailStatus === "all" ? filtered : filtered.filter((t) => t.status === detailStatus);
        const peopleMap = new Map<number | "none", { id: number | "none"; name: string; count: number }>();
        for (const t of baseList) {
          const id = t.assignedTo ?? "none";
          const name = t.assignedToName ?? "Unassigned";
          const cur = peopleMap.get(id);
          if (cur) cur.count++;
          else peopleMap.set(id, { id, name, count: 1 });
        }
        const people = [...peopleMap.values()].sort((a, b) => b.count - a.count);
        const list = detailPerson === "all" ? baseList : baseList.filter((t) => (t.assignedTo ?? "none") === detailPerson);
        const displayList = [...list].sort((a, b) => {
          const an = a.assignedToName ?? "Unassigned";
          const bn = b.assignedToName ?? "Unassigned";
          return detailSort === "za" ? bn.localeCompare(an) : an.localeCompare(bn);
        });
        const statusBadge = (s: string) =>
          s === "done"
            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
            : s === "inProgress"
            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
        const statusLabel = (s: string) => (s === "done" ? "Completed" : s === "inProgress" ? "In Progress" : "Pending");
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={closeDetail}>
            <div className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-base font-extrabold text-foreground flex items-center gap-2">
                  <span>{meta[detailStatus].icon}</span> {meta[detailStatus].title}
                  <span className="text-xs font-semibold text-muted-foreground">({list.length})</span>
                </h2>
                <button onClick={closeDetail} className="text-muted-foreground hover:text-foreground text-lg px-1" aria-label="Close">✕</button>
              </div>
              {people.length > 0 && (
                <div className="px-5 py-3 border-b border-border flex flex-wrap gap-2">
                  <button type="button" onClick={() => setDetailPerson("all")}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition ${detailPerson === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>
                    All <span className="opacity-80">({baseList.length})</span>
                  </button>
                  {people.map((p) => (
                    <button key={String(p.id)} type="button" onClick={() => setDetailPerson(p.id)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold transition ${detailPerson === p.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>
                      {p.name} <span className="opacity-80">({p.count})</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="overflow-y-auto">
                {list.length === 0 ? (
                  <div className="px-5 py-10 text-center text-muted-foreground text-sm">No tasks</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted">
                      <tr className="text-xs text-muted-foreground">
                        <th className="text-left px-4 py-2 font-semibold">Task</th>
                        <th className="text-left px-4 py-2 font-semibold">
                          <div className="flex items-center gap-2">
                            <span>Assigned To</span>
                            <select value={detailSort} onChange={(e) => setDetailSort(e.target.value as "az" | "za")}
                              className="px-1.5 py-0.5 border border-border rounded-md text-xs font-normal normal-case bg-card focus:outline-none focus:ring-2 focus:ring-ring" title="Sort by name">
                              <option value="az">A → Z</option>
                              <option value="za">Z → A</option>
                            </select>
                          </div>
                        </th>
                        <th className="text-left px-4 py-2 font-semibold">Status</th>
                        <th className="text-left px-4 py-2 font-semibold">Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayList.map((t) => {
                        const rowEditable = canOpenEditTask(currentUser, t, allUsers);
                        return (
                          <tr key={t.id}
                            className={cn("border-b border-border last:border-0", rowEditable ? "cursor-pointer hover:bg-muted" : "opacity-60")}
                            onClick={() => { if (rowEditable) { closeDetail(); setEditingTask(t); } }}>
                            <td className="px-4 py-2.5">
                              <div className="font-medium text-foreground flex items-center gap-1.5">
                                {t.title}
                              </div>
                              {t.category && <div className="text-xs text-muted-foreground">{t.category}</div>}
                            </td>
                            <td className="px-4 py-2.5 text-foreground">
                              {t.assignedToName ?? <span className="text-muted-foreground italic text-xs">Unassigned</span>}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusBadge(t.status)}`}>{statusLabel(t.status)}</span>
                            </td>
                            <td className={cn("px-4 py-2.5 text-xs", isOverdue(t.dueDate, t.status) ? "text-red-600 dark:text-red-400 font-bold" : "text-muted-foreground")}>{t.dueDate || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        );
      })()}
      {completionToast && (
        <CompletionToast taskTitle={completionToast.title} assigneeName={completionToast.assignee}
          onClose={() => setCompletionToast(null)} />
      )}
      {reasonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setReasonModal(null)}>
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-extrabold text-foreground text-lg">Why is this task not completed?</h2>
              <p className="text-xs text-muted-foreground mt-1 truncate">{reasonModal.title}</p>
            </div>
            <div className="px-6 py-4">
              <label className="block text-xs font-bold text-muted-foreground mb-1">Reason / Remark *</label>
              <textarea
                autoFocus
                value={reasonModal.remark}
                onChange={(e) => setReasonModal((m) => (m ? { ...m, remark: e.target.value } : m))}
                rows={3}
                placeholder="Enter a reason why this task is still pending..."
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
              <p className="text-xs text-muted-foreground mt-1">A reason is required when a task is not marked as Done.</p>
            </div>
            <div className="px-6 py-4 border-t border-border flex gap-2 bg-background rounded-b-2xl">
              <button onClick={submitReason} disabled={!reasonModal.remark.trim() || updateTask.isPending}
                className="flex-1 py-2.5 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 disabled:opacity-50 transition text-sm">
                {updateTask.isPending ? "Saving..." : "Save Reason"}</button>
              <button onClick={() => setReasonModal(null)} className="px-5 py-2.5 bg-muted text-foreground font-semibold rounded-xl hover:bg-muted transition text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
      {bulkRemark !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => { if (!bulkBusy) setBulkRemark(null); }}>
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-extrabold text-foreground text-lg">Add remark</h2>
              <p className="text-xs text-muted-foreground mt-1">This remark will be added to {selected.size} selected task{selected.size === 1 ? "" : "s"}.</p>
            </div>
            <div className="px-6 py-4">
              <label className="block text-xs font-bold text-muted-foreground mb-1">Remark</label>
              <textarea
                autoFocus
                value={bulkRemark}
                onChange={(e) => setBulkRemark(e.target.value)}
                rows={3}
                placeholder="Type a remark for the selected tasks..."
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
            </div>
            <div className="px-6 py-4 border-t border-border flex gap-2 bg-background rounded-b-2xl">
              <button onClick={submitBulkRemark} disabled={!bulkRemark.trim() || bulkBusy}
                className="flex-1 py-2.5 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 disabled:opacity-50 transition text-sm">
                {bulkBusy ? "Saving..." : "Save Remark"}</button>
              <button onClick={() => setBulkRemark(null)} disabled={bulkBusy} className="px-5 py-2.5 bg-muted text-foreground font-semibold rounded-xl hover:bg-muted disabled:opacity-50 transition text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-foreground">{titles[typeFilter]}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {filtered.length} task{filtered.length !== 1 ? "s" : ""} · {titles[typeFilter]}
              {!seesAll && <span className="ml-2 text-primary font-medium">· Only your team's data</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {saveFlash && <div className="px-3 py-1.5 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 text-xs font-semibold rounded-full">{saveFlash}</div>}
            <button onClick={() => setShowTransferHistory(true)}
              className="px-3 py-1.5 text-xs font-semibold text-foreground border border-border rounded-lg hover:bg-muted transition flex items-center gap-1.5">
              🔄 Transfer History
            </button>
            <button onClick={handleDownloadReport} disabled={filtered.length === 0}
              className="px-3 py-1.5 text-xs font-semibold text-foreground border border-border rounded-lg hover:bg-muted transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5">
              ⬇ Download Report
            </button>
            {hasActiveFilter && (
              <button onClick={() => { setFilterCenter("All"); setFilterDept("All"); setFilterMember("All"); setFilterPriority("All"); setFilterStatus("All"); setFilterCategory("All"); setDateMode("all"); setFromDate(""); setToDate(""); setMonth(""); setSearch(""); }}
                className="px-3 py-1.5 text-xs font-semibold text-red-500 hover:text-red-700 border border-red-200 rounded-lg hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:border-red-800 dark:hover:bg-red-950/40 transition">
                ✕ Filters clear
              </button>
            )}
          </div>
        </div>

        {/* ── Task type tabs (All / Daily / Weekly / Monthly) + My Tasks ── */}
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          {([["all", "All Tasks"], ["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]] as [TaskType, string][]).map(([v, l]) => (
            <Pill key={v} label={l} active={typeFilter === v} onClick={() => setTypeFilter(v)} />
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          <Pill label="👤 My Tasks" active={onlyMine} onClick={() => setOnlyMine((v) => !v)} />
        </div>

        {/* ── KPI summary cards (click a card to open a task detail popup) ── */}
        <div className="grid grid-cols-5 gap-3 mb-4">
          <button type="button" aria-haspopup="dialog" onClick={() => openDetail("pending")}
            className="text-left w-full rounded-xl p-4 text-white bg-red-500 transition hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-ring">
            <div className="text-3xl font-black">{kpiPending}</div>
            <div className="text-xs font-semibold mt-1">⚠ Pending</div>
            <div className="text-xs opacity-75 mt-0.5">Need attention</div>
            <div className="text-[10px] font-semibold opacity-80 mt-1">👆 Click to view</div>
          </button>
          <button type="button" aria-haspopup="dialog" onClick={() => openDetail("inProgress")}
            className="text-left w-full rounded-xl p-4 text-white bg-amber-500 transition hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-ring">
            <div className="text-3xl font-black">{kpiInProgress}</div>
            <div className="text-xs font-semibold mt-1">⏱ In Progress</div>
            <div className="text-xs opacity-75 mt-0.5">Active now</div>
            <div className="text-[10px] font-semibold opacity-80 mt-1">👆 Click to view</div>
          </button>
          <button type="button" aria-haspopup="dialog" onClick={() => openDetail("done")}
            className="text-left w-full rounded-xl p-4 text-white bg-green-500 transition hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-ring">
            <div className="text-3xl font-black">{kpiDone}</div>
            <div className="text-xs font-semibold mt-1">✓ Completed</div>
            <div className="text-xs opacity-75 mt-0.5">{kpiRate}% of total</div>
            <div className="text-[10px] font-semibold opacity-80 mt-1">👆 Click to view</div>
          </button>
          <button type="button" aria-haspopup="dialog" onClick={() => openDetail("all")}
            className="text-left w-full rounded-xl p-4 text-white bg-blue-600 transition hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-ring">
            <div className="text-3xl font-black">{kpiTotal}</div>
            <div className="text-xs font-semibold mt-1">📋 Total Tasks</div>
            <div className="text-xs opacity-75 mt-0.5">{titles[typeFilter]}</div>
            <div className="text-[10px] font-semibold opacity-80 mt-1">👆 Click to show all</div>
          </button>
          <button type="button" aria-haspopup="dialog" onClick={() => openDetail("done")}
            className="text-left w-full rounded-xl p-4 text-white transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-ring"
            style={{ background: "#1e293b" }}>
            <div className="text-3xl font-black text-red-400">{kpiRate}%</div>
            <div className="text-xs font-semibold mt-1">📊 Done Rate</div>
            <div className="text-xs opacity-75 mt-0.5">Completion rate</div>
            <div className="text-[10px] font-semibold opacity-80 mt-1">👆 Click to view</div>
          </button>
        </div>

        {/* ── Pill Filter Panel ─────────────────────────────────── */}
        <div className="bg-card rounded-xl border border-border shadow-sm p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-bold text-foreground">🔍 Filters</span>
            <input type="search" placeholder="Search task or member..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              className="ml-auto px-3 py-1.5 border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring w-52" />
          </div>

          {/* Center */}
          {centerOptions.length > 1 && (
            <div className="mb-3">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">🏢 Center</div>
              <div className="flex flex-wrap gap-1.5">
                {centerOptions.map((c) => (
                  <Pill key={c} label={c === "All" ? "All Centers" : c}
                    active={filterCenter === c}
                    onClick={() => { setFilterCenter(c); setFilterDept("All"); setFilterMember("All"); }} />
                ))}
              </div>
            </div>
          )}

          {/* Department */}
          <div className="mb-3">
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Department</div>
            <div className="flex flex-wrap gap-1.5">
              {DEPTS.map((d) => <Pill key={d} label={d} active={filterDept === d} onClick={() => { setFilterDept(d); setFilterMember("All"); }} />)}
            </div>
          </div>

          {/* Member */}
          <div className="mb-3">
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Member</div>
            <div className="flex flex-wrap gap-1.5">
              <Pill label="All" active={filterMember === "All"} onClick={() => setFilterMember("All")} />
              {visibleUsers
                .filter((u) => memberCounts.has(u.id))
                .filter((u) => filterCenter === "All" || u.center === filterCenter)
                .filter((u) => filterDept === "All" || u.department === filterDept)
                .map((u) => (
                  <Pill key={u.id}
                    label={`${u.name} (${memberCounts.get(u.id) ?? 0})`}
                    active={filterMember === String(u.id)}
                    onClick={() => setFilterMember(String(u.id))} />
                ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Priority */}
            <div>
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Priority</div>
              <div className="flex flex-wrap gap-1.5">
                {PRIORITIES.map((p) => <Pill key={p} label={p} active={filterPriority === p} onClick={() => setFilterPriority(p)} />)}
              </div>
            </div>
            {/* Status */}
            <div>
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Status</div>
              <div className="flex flex-wrap gap-1.5">
                {STATUSES_DISPLAY.map((s) => <Pill key={s} label={s} active={filterStatus === s} onClick={() => setFilterStatus(s)} />)}
              </div>
            </div>
          </div>

          {/* Category */}
          {categoryList.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Category</div>
              <div className="flex flex-wrap gap-1.5">
                <Pill label="All" active={filterCategory === "All"} onClick={() => setFilterCategory("All")} />
                {categoryList.map((c) => <Pill key={c} label={c} active={filterCategory === c} onClick={() => setFilterCategory(c)} />)}
              </div>
            </div>
          )}

          {/* Date */}
          <div className="mt-3">
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">📅 Date</div>
            <DateRangePicker
              from={fromDate}
              to={toDate}
              onApply={({ from, to }) => {
                if (!from) {
                  setDateMode("all");
                  setFromDate("");
                  setToDate("");
                } else {
                  setDateMode("range");
                  setFromDate(from);
                  // A single-day pick narrows to exactly that day (to === from);
                  // a two-day pick keeps the chosen from–to range.
                  setToDate(to || from);
                }
              }}
            />
          </div>
        </div>

        {/* ── Bulk action toolbar (shown when rows are selected) ── */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 mb-3 p-3 bg-primary/5 border border-primary/30 rounded-xl flex-wrap">
            <span className="text-sm font-bold text-foreground">{selected.size} selected</span>
            <button onClick={bulkComplete} disabled={bulkBusy}
              className="px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition">
              {bulkBusy ? "Working…" : "✓ Mark Complete"}
            </button>
            <button onClick={() => setBulkRemark("")} disabled={bulkBusy}
              className="px-3 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50 transition">
              💬 Add Remark
            </button>
            <button onClick={() => setSelected(new Set())} disabled={bulkBusy}
              className="ml-auto px-3 py-1.5 text-xs font-semibold text-muted-foreground border border-border rounded-lg hover:bg-muted disabled:opacity-50 transition">
              Clear
            </button>
          </div>
        )}

        {/* ── Task Table ───────────────────────────────────────── */}
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-background border-b border-border">
                <th className="px-4 py-3 w-10">
                  <input type="checkbox" aria-label="Select all"
                    ref={(el) => { if (el) el.indeterminate = !allSelected && selected.size > 0; }}
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 accent-primary cursor-pointer align-middle" />
                </th>
                {([["title","Task"],["assignedTo","Assigned To"],["priority","Priority"],["type","Type"],["due","Due"],["status","Status"]] as [SortKey,string][]).map(([key,label]) => (
                  <th key={key}
                    onClick={() => toggleSort(key)}
                    className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground cursor-pointer select-none hover:text-foreground transition">
                    <span className="inline-flex items-center gap-1">{label}
                      <span className="text-[10px]">{sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
                    </span>
                  </th>
                ))}
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 8 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse w-24" /></td>)}</tr>
                ))
              ) : sorted.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                  {hasActiveFilter ? "No tasks for this filter — clear the filters" : "No tasks found"}
                </td></tr>
              ) : sorted.map((task) => {
                const mayEdit = canOpenEditTask(currentUser, task, allUsers);
                const mayManage = canEditTask(currentUser, task, allUsers);
                const mayDo = canDoTask(currentUser, task, allUsers);
                return (
                <tr key={task.id}
                  className={cn("hover:bg-muted transition-colors", isOverdue(task.dueDate, task.status) && "bg-red-50 dark:bg-red-950/40")}
                  onClick={() => { if (mayEdit) setEditingTask(task); }}>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${task.title}`}
                      checked={selected.has(task.id)}
                      onChange={() => toggleSelect(task.id)}
                      className="w-4 h-4 accent-primary cursor-pointer align-middle disabled:cursor-not-allowed disabled:opacity-50" />
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <button className="text-left w-full" disabled={!mayEdit} onClick={() => { if (mayEdit) setEditingTask(task); }}>
                      <div className="font-medium text-foreground max-w-xs truncate hover:text-primary transition">{task.title}</div>
                    </button>
                    {task.description && <div className="text-xs text-muted-foreground truncate max-w-xs mt-0.5">{task.description}</div>}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {task.category && <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-xs">{task.category}</span>}
                      {task.remark && <span className="px-1.5 py-0.5 bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300 rounded text-xs" title={task.remark}>💬 {task.remark.length > 18 ? task.remark.slice(0,18)+"…" : task.remark}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{task.assignedToName ?? <span className="text-muted-foreground italic text-xs">Unassigned</span>}</div>
                    {task.department && <span className="text-xs text-muted-foreground">{task.department}</span>}
                    <div className="text-xs text-muted-foreground mt-0.5">👤 Assigned by: <span className="font-semibold">{task.assignedByName ?? task.assignedToName ?? "Self"}</span></div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase ${task.priority === "high" || task.priority === "urgent" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" : task.priority === "medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"}`}>
                      {task.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 capitalize text-muted-foreground text-xs">{String(task.type).replace("_", " ")}</td>
                  <td className={cn("px-4 py-3 text-xs", isOverdue(task.dueDate, task.status) ? "text-red-600 dark:text-red-400 font-bold" : "text-muted-foreground")}>
                    {formatDate(task.dueDate)}{task.dueTime && ` ⏰ ${task.dueTime}`}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <select value={task.status}
                      disabled={!mayDo}
                      onChange={(e) => handleStatusChange(task, e.target.value)}
                      className={`text-xs border rounded-full px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-ring font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${STATUS_COLORS[task.status] ?? ""}`}>
                      {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      {mayEdit && (
                        <>
                          <button onClick={() => setEditingTask(task)} className="text-xs text-primary hover:text-primary font-semibold transition">Edit</button>
                          <span className="text-muted-foreground">|</span>
                        </>
                      )}
                      {mayManage && (
                        <>
                          <button onClick={() => handleDelete(task.id)} className="text-xs text-red-400 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 font-medium transition">Delete</button>
                          <span className="text-muted-foreground">|</span>
                        </>
                      )}
                      {!mayEdit && mayDo && (
                        <span className="text-xs text-muted-foreground italic" title="You can update the status of this task, but only the person who assigned it can edit or delete it.">Status only</span>
                      )}
                      <button onClick={() => setTransferTask(task)} className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-semibold transition" title="Hand this task to someone else">🔄 Transfer</button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
