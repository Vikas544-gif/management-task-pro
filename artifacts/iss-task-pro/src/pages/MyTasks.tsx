import { useState } from "react";
import { useListTasks, useUpdateTaskStatus, useCreateTask, useUpdateTask, useDeleteTask, useListCategories, useCreateCategory, useDeleteCategory, useListAttendance, useListComplianceCompanies, useCreateComplianceCompany, useDeleteComplianceCompany, getListTasksQueryKey, getGetTaskSummaryQueryKey, getListComplianceCompaniesQueryKey, getListCategoriesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn, formatDate, isOverdue, buildAbsenceSet, isTaskHiddenByAbsence } from "@/lib/utils";
import { DateRangePicker } from "@/components/DateRangePicker";
import { getPersonalReminder, getPersonalReminderConfig, setPersonalReminderConfig } from "@/hooks/use-task-reminders";
import { useDesktopNotif } from "@/hooks/use-desktop-notif";

function pad2(n: number) { return String(n).padStart(2, "0"); }
function fmtDate(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

function DatePill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={cn("px-3 py-1.5 rounded-full text-xs font-semibold border transition",
        active ? "bg-primary text-white border-primary" : "bg-card text-muted-foreground border-border hover:border-primary")}>
      {label}
    </button>
  );
}

interface MyTasksProps {
  currentUser: { id: number; name: string; role: string; department: string; center?: string | null };
}

const STATUSES = ["pending", "inProgress", "done"] as const;
type StatusKey = typeof STATUSES[number];
const STATUS_LABELS: Record<string, string> = { pending: "Pending", inProgress: "In Progress", done: "Done" };
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground border-border",
  inProgress: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
  done: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800",
};

export default function MyTasks({ currentUser }: MyTasksProps) {
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterAssignedBy, setFilterAssignedBy] = useState("");
  const [search, setSearch] = useState("");
  const todayStr = fmtDate(new Date());
  // Default to "all" dates so tasks with a future due date (added today, due
  // next week/month) are visible immediately, not hidden until their due day.
  const [dateMode, setDateMode] = useState<"all" | "range" | "month">("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [month, setMonth] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const emptyForm = { title: "", description: "", dueDate: "", priority: "medium", type: "daily", category: "", remark: "" };
  const [addForm, setAddForm] = useState(emptyForm);
  const [addError, setAddError] = useState("");
  const [reminderTask, setReminderTask] = useState<{ id: number; title: string } | null>(null);
  const [reminderStart, setReminderStart] = useState("");
  const [reminderEnd, setReminderEnd] = useState("");
  const [reminderAfterCount, setReminderAfterCount] = useState(0);
  const [reminderAfterInterval, setReminderAfterInterval] = useState(10);
  const [reminderTick, setReminderTick] = useState(0);
  const { enabled: desktopOn } = useDesktopNotif(currentUser.id);

  const { data: allTasks = [], isLoading } = useListTasks({});
  const { data: attendance = [] } = useListAttendance({});
  const { data: categories = [] } = useListCategories();
  const updateStatus = useUpdateTaskStatus();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  // Company picker for New Task — reuses the shared company master list.
  // Selecting a company appends " - {Company}" to the saved task title.
  // Any user can add/remove companies (mirrors category management).
  const { data: companies = [] } = useListComplianceCompanies();
  const createCompany = useCreateComplianceCompany();
  const deleteCompany = useDeleteComplianceCompany();
  // Company add/remove is available to every user (mirrors category management).
  const canManageCompanies = true;
  const [company, setCompany] = useState("");
  const [showCompanyManage, setShowCompanyManage] = useState(false);
  const [newCompany, setNewCompany] = useState("");
  const [companyError, setCompanyError] = useState("");
  const createCategory = useCreateCategory();
  const deleteCategory = useDeleteCategory();
  const [showCatManage, setShowCatManage] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [catError, setCatError] = useState("");

  // Hide tasks whose assignee was marked absent/leave on the task's due date.
  const absenceSet = buildAbsenceSet(attendance);

  // Tasks the current user is involved in — both the ones assigned TO them
  // and the ones they assigned to someone else (so a task shows for both the
  // giver and the receiver).
  const myTasks = allTasks.filter(
    (t) =>
      (t.assignedTo === currentUser.id || t.assignedBy === currentUser.id) &&
      !isTaskHiddenByAbsence(t, absenceSet)
  );

  // Unique people who assigned tasks to the current user (for the "Assigned By" filter)
  const assigners = Array.from(
    new Set(myTasks.map((t) => t.assignedByName).filter((n): n is string => !!n))
  ).sort((a, b) => a.localeCompare(b));

  const filtered = myTasks.filter((t) => {
    if (filterStatus && t.status !== filterStatus) return false;
    if (filterType && t.type !== filterType) return false;
    if (filterAssignedBy && t.assignedByName !== filterAssignedBy) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (dateMode !== "all") {
      const d = (t.dueDate ? String(t.dueDate).slice(0, 10) : (t.createdAt ? String(t.createdAt).split("T")[0] : ""));
      if (!d) return false;
      if (dateMode === "range") {
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;
      } else if (dateMode === "month") {
        if (month && !d.startsWith(month)) return false;
      }
    }
    return true;
  }).sort((a, b) => {
    // Order by due date ascending: overdue first, then today / undated, then
    // future tasks sink to the bottom (undated treated as "today").
    const da = a.dueDate ? String(a.dueDate).slice(0, 10) : todayStr;
    const db = b.dueDate ? String(b.dueDate).slice(0, 10) : todayStr;
    return da < db ? -1 : da > db ? 1 : 0;
  });

  const stats = {
    total: myTasks.length,
    done: myTasks.filter((t) => t.status === "done").length,
    inProgress: myTasks.filter((t) => t.status === "inProgress").length,
    pending: myTasks.filter((t) => t.status === "pending").length,
  };
  const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  const handleStatusChange = (id: number, status: string, title: string) => {
    updateStatus.mutate({ id, data: { status } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
        qc.invalidateQueries({ queryKey: getGetTaskSummaryQueryKey() });
      },
    });
  };

  const setAdd = (k: string, v: string) => setAddForm((f) => ({ ...f, [k]: v }));

  const openEdit = (task: typeof myTasks[number]) => {
    setEditingId(task.id);
    setAddError("");
    setAddForm({
      title: task.title ?? "",
      description: task.description ?? "",
      dueDate: task.dueDate ? String(task.dueDate).slice(0, 10) : "",
      priority: task.priority ?? "medium",
      type: String(task.type ?? "daily"),
      category: task.category ?? "",
      remark: task.remark ?? "",
    });
    setCompany("");
    setShowAdd(true);
  };

  const closeModal = () => {
    setShowAdd(false);
    setEditingId(null);
    setCompany("");
    setShowCompanyManage(false);
    setNewCompany("");
    setCompanyError("");
  };

  const openReminder = (task: typeof myTasks[number]) => {
    const existing = getPersonalReminderConfig(currentUser.id, task.id);
    let start = existing?.start ?? "";
    if (!start) {
      if (task.dueDate) {
        start = `${String(task.dueDate).slice(0, 10)}T${task.dueTime || "09:00"}`;
      } else {
        const d = new Date(Date.now() + 60 * 60 * 1000);
        start = `${fmtDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
      }
    }
    setReminderStart(start);
    setReminderEnd(existing?.end ?? "");
    setReminderAfterCount(existing?.afterEndCount ?? 0);
    setReminderAfterInterval(existing?.afterEndInterval && existing.afterEndInterval > 0 ? existing.afterEndInterval : 10);
    setReminderTask({ id: task.id, title: task.title });
  };

  const saveReminder = () => {
    if (!reminderTask || !reminderStart) return;
    // Only keep an end time when it is strictly after the start time. This also
    // makes start === end deterministic (no end popup, no after-end nags).
    const end = reminderEnd && reminderEnd > reminderStart ? reminderEnd : "";
    const afterEndCount = end ? Math.max(0, Math.min(50, Math.floor(reminderAfterCount) || 0)) : 0;
    const afterEndInterval = Math.max(1, Math.floor(reminderAfterInterval) || 10);
    setPersonalReminderConfig(currentUser.id, reminderTask.id, {
      start: reminderStart,
      end,
      afterEndCount,
      afterEndInterval,
    });
    setReminderTask(null);
    setReminderTick((x) => x + 1);
  };

  const clearReminder = () => {
    if (!reminderTask) return;
    setPersonalReminderConfig(currentUser.id, reminderTask.id, null);
    setReminderTask(null);
    setReminderTick((x) => x + 1);
  };

  const handleDelete = (id: number, title: string) => {
    if (!window.confirm(`Delete the "${title}" task?`)) return;
    deleteTask.mutate({ id }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
        qc.invalidateQueries({ queryKey: getGetTaskSummaryQueryKey() });
      },
      onError: () => window.alert("Could not delete the task. Please try again."),
    });
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    setAddError("");
    if (!addForm.title.trim()) { setAddError("Task title is required"); return; }
    const onSuccess = () => {
      qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
      qc.invalidateQueries({ queryKey: getGetTaskSummaryQueryKey() });
      setAddForm(emptyForm);
      closeModal();
    };
    if (editingId != null) {
      updateTask.mutate(
        {
          id: editingId,
          data: {
            title: addForm.title,
            description: addForm.description || null,
            dueDate: addForm.dueDate || null,
            priority: addForm.priority,
            type: addForm.type,
            category: addForm.category || null,
            remark: addForm.remark || null,
          },
        },
        { onSuccess, onError: () => setAddError("Failed to update task") }
      );
      return;
    }
    const finalTitle = company ? `${addForm.title.trim()} - ${company}` : addForm.title.trim();
    createTask.mutate(
      {
        data: {
          title: finalTitle,
          description: addForm.description || null,
          assignedTo: currentUser.id,
          assignedBy: currentUser.id,
          dueDate: addForm.dueDate || null,
          priority: addForm.priority,
          type: addForm.type,
          category: addForm.category || null,
          department: currentUser.department || null,
          remark: addForm.remark || null,
          sendEmail: false,
        },
      },
      { onSuccess, onError: () => setAddError("Failed to add task") }
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
        onSuccess: (created) => {
          qc.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
          setNewCat("");
          if (created?.name) setAdd("category", created.name);
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
          setAddForm((f) => (f.category === name ? { ...f, category: "" } : f));
        },
        onError: () => setCatError("Could not remove category"),
      }
    );
  };

  return (
    <>

      <div className="p-6">
        {/* Header */}
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground">My Tasks</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Tasks assigned to you, and tasks you assigned to others ({currentUser.name})
            </p>
          </div>
          <button onClick={() => { setEditingId(null); setAddForm(emptyForm); setAddError(""); setCompany(""); setShowAdd(true); }}
            className="shrink-0 px-4 py-2.5 bg-primary text-white font-bold rounded-xl text-sm hover:bg-primary/90 transition shadow-sm">
            ➕ New Task
          </button>
        </div>

        {/* Stat boxes */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          <button onClick={() => setFilterStatus("")}
            className={`rounded-xl p-4 text-center border-2 transition ${filterStatus === "" ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"}`}>
            <div className="text-3xl font-black text-foreground">{stats.total}</div>
            <div className="text-xs font-bold text-muted-foreground mt-1">Total Tasks</div>
          </button>
          <button onClick={() => setFilterStatus("done")}
            className={`rounded-xl p-4 text-center border-2 transition ${filterStatus === "done" ? "border-green-500 bg-green-100 dark:border-green-600 dark:bg-green-900/40" : "border-green-200 bg-green-50 hover:border-green-400 dark:border-green-800 dark:bg-green-950/40 dark:hover:border-green-600"}`}>
            <div className="text-3xl font-black text-green-600 dark:text-green-300">{stats.done}</div>
            <div className="text-xs font-bold text-green-600 dark:text-green-300 mt-1">✅ Done</div>
          </button>
          <button onClick={() => setFilterStatus("inProgress")}
            className={`rounded-xl p-4 text-center border-2 transition ${filterStatus === "inProgress" ? "border-amber-500 bg-amber-100 dark:border-amber-600 dark:bg-amber-900/40" : "border-amber-200 bg-amber-50 hover:border-amber-400 dark:border-amber-800 dark:bg-amber-950/40 dark:hover:border-amber-600"}`}>
            <div className="text-3xl font-black text-amber-600 dark:text-amber-300">{stats.inProgress}</div>
            <div className="text-xs font-bold text-amber-600 dark:text-amber-300 mt-1">⏳ In Progress</div>
          </button>
          <button onClick={() => setFilterStatus("pending")}
            className={`rounded-xl p-4 text-center border-2 transition ${filterStatus === "pending" ? "border-red-500 bg-red-100 dark:border-red-600 dark:bg-red-900/40" : "border-red-200 bg-red-50 hover:border-red-400 dark:border-red-800 dark:bg-red-950/40 dark:hover:border-red-600"}`}>
            <div className="text-3xl font-black text-red-600 dark:text-red-300">{stats.pending}</div>
            <div className="text-xs font-bold text-red-600 dark:text-red-300 mt-1">🔔 Pending</div>
          </button>
        </div>

        {/* Progress bar */}
        <div className="bg-card rounded-xl border border-border shadow-sm p-4 mb-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-semibold text-foreground">Overall Completion</span>
            <span className={`font-black ${pct >= 75 ? "text-green-600 dark:text-green-300" : pct >= 40 ? "text-amber-500 dark:text-amber-400" : "text-red-500 dark:text-red-400"}`}>{pct}%</span>
          </div>
          <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: pct >= 75 ? "#10b981" : pct >= 40 ? "#f59e0b" : "#ef4444" }} />
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <input type="search" placeholder="Search tasks..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring w-48" />
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="">All Status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="">All Types</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="one_time">One Time</option>
          </select>
          {(filterStatus || filterType || filterAssignedBy || search || dateMode !== "all") && (
            <button onClick={() => { setFilterStatus(""); setFilterType(""); setFilterAssignedBy(""); setSearch(""); setDateMode("all"); setFromDate(""); setToDate(""); setMonth(""); }}
              className="px-3 py-2 text-sm text-primary font-semibold hover:text-primary">
              Clear filters
            </button>
          )}
          <span className="self-center text-sm text-muted-foreground">{filtered.length} task(s)</span>
        </div>

        {/* Date filter */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs font-bold text-muted-foreground mr-1">📅 Date:</span>
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

        {/* Assigned-by name chips — click a person to see only their tasks */}
        {assigners.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-xs font-bold text-muted-foreground mr-1">Assigned by:</span>
            <button
              onClick={() => setFilterAssignedBy("")}
              className={cn("px-3 py-1.5 rounded-full text-xs font-semibold border transition",
                filterAssignedBy === "" ? "bg-primary text-white border-primary" : "bg-card text-muted-foreground border-border hover:border-primary")}
            >
              All ({myTasks.length})
            </button>
            {assigners.map((name) => {
              const count = myTasks.filter((t) => t.assignedByName === name).length;
              const active = filterAssignedBy === name;
              return (
                <button
                  key={name}
                  onClick={() => setFilterAssignedBy(active ? "" : name)}
                  className={cn("px-3 py-1.5 rounded-full text-xs font-semibold border transition flex items-center gap-1.5",
                    active ? "bg-primary text-white border-primary" : "bg-card text-muted-foreground border-border hover:border-primary")}
                >
                  <span className={cn("w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center",
                    active ? "bg-card/25 text-white" : "bg-primary/15 text-primary")}>
                    {name[0]}
                  </span>
                  {name}
                  <span className={cn("px-1.5 rounded-full text-[10px]", active ? "bg-card/25" : "bg-muted text-muted-foreground")}>{count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Task cards */}
        {isLoading ? (
          <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
            {myTasks.length === 0 ? "No tasks assigned to or by you yet" : "No tasks for this filter"}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((task) => {
              return (
              <div key={task.id}
                className={cn("bg-card rounded-xl border shadow-sm p-4 transition hover:shadow-md",
                  isOverdue(task.dueDate, task.status) ? "border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-800" : "border-border")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-foreground text-sm">{task.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">👤 Assigned by: <span className="font-semibold text-muted-foreground">{task.assignedByName ?? task.assignedToName ?? "Self"}</span></div>
                    {task.assignedBy === currentUser.id && task.assignedTo !== currentUser.id && (
                      <div className="text-xs text-muted-foreground mt-0.5">📤 Assigned to: <span className="font-semibold text-muted-foreground">{task.assignedToName ?? "Unassigned"}</span></div>
                    )}
                    {task.description && <div className="text-xs text-muted-foreground mt-0.5">{task.description}</div>}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {task.category && <span className="px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs">{task.category}</span>}
                      <span className="px-2 py-0.5 bg-muted text-muted-foreground rounded-full text-xs capitalize">{String(task.type).replace("_", " ")}</span>
                      {task.dueDate && (
                        <span className={cn("px-2 py-0.5 rounded-full text-xs",
                          isOverdue(task.dueDate, task.status) ? "bg-red-100 text-red-700 font-bold dark:bg-red-900/40 dark:text-red-300" : "bg-background border border-border text-muted-foreground")}>
                          📅 {formatDate(task.dueDate)} {task.dueTime && `⏰ ${task.dueTime}`} {isOverdue(task.dueDate, task.status) && "— OVERDUE!"}
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${task.priority === "high" || task.priority === "urgent" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" : task.priority === "medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"}`}>
                        {task.priority}
                      </span>
                    </div>
                    {task.remark && <div className="mt-1.5 text-xs bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 px-2 py-1 rounded-lg">💬 {task.remark}</div>}
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    {task.assignedTo === currentUser.id ? (
                      <select value={task.status}
                        onChange={(e) => handleStatusChange(task.id, e.target.value, task.title)}
                        className={`text-xs border rounded-full px-3 py-1.5 font-semibold focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer ${STATUS_COLORS[task.status] ?? ""}`}>
                        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                      </select>
                    ) : (
                      <span className={`text-xs border rounded-full px-3 py-1.5 font-semibold ${STATUS_COLORS[task.status] ?? ""}`}>
                        {STATUS_LABELS[task.status] ?? task.status}
                      </span>
                    )}
                    {(() => {
                      void reminderTick;
                      const hasReminder = !!getPersonalReminder(currentUser.id, task.id);
                      return (
                        <button onClick={() => openReminder(task)} title="Set reminder" aria-label="Set reminder"
                          className={cn("w-8 h-8 rounded-lg border transition flex items-center justify-center text-sm relative",
                            hasReminder ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground")}>
                          🔔
                          {hasReminder && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-primary rounded-full border-2 border-card" />}
                        </button>
                      );
                    })()}
                    <button onClick={() => openEdit(task)} title="Edit task" aria-label="Edit task"
                      className="w-8 h-8 rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition flex items-center justify-center text-sm">
                      ✏️
                    </button>
                    {task.assignedTo === currentUser.id && (
                      <button onClick={() => handleDelete(task.id, task.title)} title="Delete task" aria-label="Delete task"
                        className="w-8 h-8 rounded-lg border border-border text-muted-foreground hover:bg-red-50 hover:text-red-600 hover:border-red-200 dark:hover:bg-red-950/40 dark:hover:text-red-300 dark:hover:border-red-800 transition flex items-center justify-center text-sm">
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add own-task modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={closeModal}>
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h2 className="text-lg font-extrabold text-foreground">{editingId != null ? "Edit Task" : "New Task"}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {editingId != null ? "Update the task details and remark" : `This task will be self-assigned to you (${currentUser.name})`}
                </p>
              </div>
              <button onClick={closeModal} className="text-muted-foreground hover:text-foreground text-xl leading-none">✕</button>
            </div>
            <form onSubmit={handleAddTask} className="p-6 space-y-4">
              {addError && <div className="bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm px-3 py-2 rounded-lg">{addError}</div>}

              <div>
                <label className="block text-sm font-semibold text-foreground mb-1">Task Title *</label>
                <input value={addForm.title} onChange={(e) => setAdd("title", e.target.value)} autoFocus
                  placeholder="What needs to be done?" data-testid="input-own-task-title"
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>

              <div>
                <label className="block text-sm font-semibold text-foreground mb-1">Description</label>
                <textarea value={addForm.description} onChange={(e) => setAdd("description", e.target.value)} rows={2}
                  placeholder="Detail (optional)"
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-foreground mb-1">Type</label>
                  <select value={addForm.type} onChange={(e) => setAdd("type", e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="one_time">One Time</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-foreground mb-1">Priority</label>
                  <select value={addForm.priority} onChange={(e) => setAdd("priority", e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-foreground mb-1">Category</label>
                  <select value={addForm.category} onChange={(e) => setAdd("category", e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="">— Select —</option>
                    {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
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
                        {categories.map((c) => (
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
                <div>
                  <label className="block text-sm font-semibold text-foreground mb-1">Due Date</label>
                  <input type="date" value={addForm.dueDate} onChange={(e) => setAdd("dueDate", e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
              </div>

              {/* Company (optional) is a Head-Office-only feature */}
              {editingId == null && currentUser.center === "Head Office" && (
                <div>
                  <label className="block text-sm font-semibold text-foreground mb-1">Company (optional)</label>
                  <select value={company} onChange={(e) => setCompany(e.target.value)} data-testid="select-company"
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
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
                        {addForm.title.trim() ? `${addForm.title.trim()} - ${company}` : `… - ${company}`}
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

              <div>
                <label className="block text-sm font-semibold text-foreground mb-1">Remark</label>
                <input value={addForm.remark} onChange={(e) => setAdd("remark", e.target.value)}
                  placeholder="A note (optional)"
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal}
                  className="flex-1 py-2.5 border border-border text-muted-foreground font-bold rounded-xl text-sm hover:bg-muted transition">
                  Cancel
                </button>
                <button type="submit" disabled={createTask.isPending || updateTask.isPending} data-testid="btn-add-own-task"
                  className="flex-1 py-2.5 bg-primary text-white font-bold rounded-xl text-sm hover:bg-primary/90 transition disabled:opacity-60">
                  {editingId != null
                    ? (updateTask.isPending ? "Saving..." : "✔ Save Changes")
                    : (createTask.isPending ? "Adding..." : "✔ Add Task")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Set personal reminder modal */}
      {reminderTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setReminderTask(null)}>
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h2 className="text-lg font-extrabold text-foreground">🔔 Set reminder</h2>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">"{reminderTask.title}"</p>
              </div>
              <button onClick={() => setReminderTask(null)} className="text-muted-foreground hover:text-foreground text-xl leading-none">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-foreground mb-1">Start time</label>
                <input type="datetime-local" value={reminderStart} onChange={(e) => setReminderStart(e.target.value)}
                  className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                <p className="text-xs text-muted-foreground mt-1.5">A popup will appear on your laptop at this time.</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-foreground mb-1">End time <span className="font-normal text-muted-foreground">(optional)</span></label>
                <input type="datetime-local" value={reminderEnd} min={reminderStart || undefined} onChange={(e) => setReminderEnd(e.target.value)}
                  className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                <p className="text-xs text-muted-foreground mt-1.5">A second popup will appear at the end time.</p>
              </div>

              <div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-1">Remind again after end?</label>
                    <input type="number" min={0} max={50} value={reminderAfterCount} disabled={!reminderEnd}
                      onChange={(e) => setReminderAfterCount(Number(e.target.value))}
                      className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:bg-muted" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-1">Every how many minutes?</label>
                    <input type="number" min={1} value={reminderAfterInterval} disabled={!reminderEnd || reminderAfterCount < 1}
                      onChange={(e) => setReminderAfterInterval(Number(e.target.value))}
                      className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:bg-muted" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {!reminderEnd
                    ? "Set an end time first to keep getting reminders after it."
                    : reminderAfterCount > 0
                      ? `After the end time you'll be reminded ${reminderAfterCount} more time${reminderAfterCount > 1 ? "s" : ""}, every ${Math.max(1, reminderAfterInterval)} minute${Math.max(1, reminderAfterInterval) > 1 ? "s" : ""}, until you mark the task done.`
                      : "Only the start and end time popups will appear."}
                </p>
              </div>
              <p className="text-xs text-muted-foreground -mt-1">Reminders stop automatically once you mark the task as done.</p>
              {!desktopOn && (
                <div className="bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs px-3 py-2 rounded-lg">
                  ⚠️ To get popups, enable <b>"Laptop popup"</b> in the header above and keep the browser open.
                </div>
              )}
              <div className="flex gap-3 pt-1">
                {getPersonalReminder(currentUser.id, reminderTask.id) && (
                  <button type="button" onClick={clearReminder}
                    className="px-4 py-2.5 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-300 font-bold rounded-xl text-sm hover:bg-red-50 dark:hover:bg-red-950/40 transition">
                    Remove
                  </button>
                )}
                <button type="button" onClick={() => setReminderTask(null)}
                  className="flex-1 py-2.5 border border-border text-muted-foreground font-bold rounded-xl text-sm hover:bg-muted transition">
                  Cancel
                </button>
                <button type="button" onClick={saveReminder} disabled={!reminderStart}
                  className="flex-1 py-2.5 bg-primary text-white font-bold rounded-xl text-sm hover:bg-primary/90 transition disabled:opacity-60">
                  ✔ Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
