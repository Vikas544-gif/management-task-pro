import { useState } from "react";
import {
  useListUsers, useCreateUser, useUpdateUser, useDeleteUser, useListCredentials,
  getListUsersQueryKey, getListTasksQueryKey, getListCredentialsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { isAllCentersViewer, resolveAllowedCenters } from "@/lib/utils";

interface CurrentUser { id: number; name: string; role: string; department: string; }
interface HierarchyProps { currentUser: CurrentUser; }

const DEPTS = ["Management", "Operations", "Quality & Training", "Quality", "Training", "Accounts", "MIS", "Director", "HR", "IT"];
const ROLE_COLORS: Record<string, string> = {
  Boss: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};
function roleClass(role: string) {
  return ROLE_COLORS[role] ?? "bg-primary/10 text-primary";
}

export default function Hierarchy({ currentUser }: HierarchyProps) {
  const qc = useQueryClient();
  const { data: users = [], isLoading } = useListUsers();
  const isBoss = currentUser.department === "Management" || currentUser.role === "Boss";
  const isMis = isAllCentersViewer(currentUser);
  const isCenterHead = currentUser.role === "Center Head";
  // Boss & MIS get full access to every center's credentials; a Center Head
  // sees/manages only their own center.
  const seesAll = isBoss || isMis;
  const canView = isBoss || isMis || isCenterHead;
  const myCenter = users.find((u) => u.id === currentUser.id)?.center ?? null;
  // Boss/MIS fetch all credentials; a Center Head fetches ONLY their center's
  // (the server filters by ?center=, so other centers' passwords never reach the client).
  // MIS gets every center EXCEPT Head Office — the server strips Head Office /
  // Boss credentials so they never even reach the MIS client.
  const credParams = isBoss
    ? undefined
    : isMis
      ? { excludeCenter: "Head Office" }
      : (myCenter ? { center: myCenter } : undefined);
  const { data: credentials = [] } = useListCredentials(credParams, {
    query: { enabled: canView && (seesAll || !!myCenter), queryKey: getListCredentialsQueryKey(credParams) },
  });
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();

  const passwordMap = new Map(credentials.map((c) => [c.id, c.password]));

  const [showAddForm, setShowAddForm] = useState(false);
  const [addError, setAddError] = useState("");
  const [flash, setFlash] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [resetId, setResetId] = useState<number | null>(null);
  const [newPw, setNewPw] = useState("");
  const [showAddPw, setShowAddPw] = useState(false);
  const [centerFilter, setCenterFilter] = useState("All");
  const [addForm, setAddForm] = useState({
    name: "", role: "", username: "", password: "", department: "Accounts", center: isMis ? "Thane Center" : "Head Office", email: "", reportsTo: "" as string,
  });

  // Per-user center restriction (Boss/MIS only). null = no restriction.
  const allowedCenters = resolveAllowedCenters(
    users.find((u) => u.id === currentUser.id) ?? null,
    users
  );
  // Boss sees every center; MIS sees the four outer centers (never Head Office);
  // a Center Head sees only their own center. A custom set narrows this further.
  let baseUsers = isBoss
    ? users
    : isMis
      ? users.filter((u) => u.center && u.center !== "Head Office")
      : users.filter((u) => u.center === myCenter);
  if (allowedCenters) baseUsers = baseUsers.filter((u) => u.center && allowedCenters.has(u.center));

  const CENTER_ORDER = ["Head Office", "Thane Center", "Malad Center", "Pune Center", "Navi Mumbai Center"];
  // MIS may not assign anyone to Head Office, so it is dropped from the choices.
  // A custom center set also limits which centers a user can be added/moved into.
  const centerChoices = (isMis ? CENTER_ORDER.filter((c) => c !== "Head Office") : CENTER_ORDER)
    .filter((c) => !allowedCenters || allowedCenters.has(c));
  const centers = (() => {
    const set = new Set(baseUsers.map((u) => u.center).filter((c): c is string => Boolean(c)));
    const rank = (c: string) => { const i = CENTER_ORDER.indexOf(c); return i === -1 ? CENTER_ORDER.length : i; };
    return Array.from(set).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  })();
  // Every standard center is always offered when adding/editing a user (even centers with no users yet)
  const allCenterOptions = (() => {
    const set = new Set<string>([...centerChoices, ...baseUsers.map((u) => u.center).filter((c): c is string => Boolean(c))]);
    const rank = (c: string) => { const i = CENTER_ORDER.indexOf(c); return i === -1 ? CENTER_ORDER.length : i; };
    return Array.from(set).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  })();
  const activeCenter = centerFilter !== "All" && centers.includes(centerFilter) ? centerFilter : "All";
  // Only people who actually have a login appear in the credentials view — Sales Agents
  // have no username/password, so they are excluded here (they live in the Team page).
  // A Center Head's view hides their center's HR staff entirely (ID + password) —
  // mirrors the server, which never sends them. The Center Head still sees their
  // Team Leaders and their own row. Boss & MIS views are unaffected.
  const hideHrFromCenterHead = isCenterHead && !seesAll;
  const loginUsers = baseUsers.filter(
    (u) => !!u.username && !(hideHrFromCenterHead && u.department === "HR")
  );
  const visibleUsers = activeCenter === "All" ? loginUsers : loginUsers.filter((u) => u.center === activeCenter);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
    qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
    qc.invalidateQueries({ queryKey: getListCredentialsQueryKey() });
  };

  const handleReset = (id: number) => {
    if (!newPw.trim()) return;
    updateUser.mutate({ id, data: { password: newPw } }, {
      onSuccess: () => { invalidate(); showFlash("✓ Password reset"); setResetId(null); setNewPw(""); },
    });
  };

  const showFlash = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(""), 2500);
  };

  const handleField = (
    id: number,
    field: "reportsTo" | "department" | "center" | "email" | "name" | "role" | "username",
    value: string,
    revert?: () => void,
  ) => {
    // MIS may never move anyone into Head Office.
    if (field === "center" && isMis && value === "Head Office") {
      revert?.();
      showFlash("✗ MIS cannot assign Head Office");
      return;
    }
    const data: Record<string, unknown> = {};
    if (field === "reportsTo") data.reportsTo = value === "" ? null : parseInt(value);
    else if (field === "email") data.email = value === "" ? null : value;
    else if (field === "name") data.name = value;
    else if (field === "role") data.role = value;
    else if (field === "username") data.username = value;
    else if (field === "center") data.center = value;
    else data.department = value;
    updateUser.mutate({ id, data }, {
      onSuccess: () => { invalidate(); showFlash("✓ Saved"); },
      onError: () => { revert?.(); showFlash(field === "username" ? "✗ Username already taken" : "✗ Save failed"); },
    });
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setAddError("");
    if (!addForm.name || !addForm.username || !addForm.password || !addForm.role) {
      setAddError("Name, Role, Username, Password are required");
      return;
    }
    createUser.mutate(
      { data: {
        name: addForm.name, role: addForm.role, username: addForm.username,
        password: addForm.password, department: addForm.department,
        center: isBoss
          ? (addForm.center.trim() || "Head Office")
          : isMis
            ? ((addForm.center.trim() && addForm.center.trim() !== "Head Office") ? addForm.center.trim() : "Thane Center")
            : (myCenter ?? "Head Office"),
        reportsTo: addForm.reportsTo === "" ? null : parseInt(addForm.reportsTo),
        email: addForm.email || null,
      } },
      {
        onSuccess: () => {
          invalidate();
          showFlash("✓ New user added");
          setShowAddForm(false);
          setAddForm({ name: "", role: "", username: "", password: "", department: "Accounts", center: isMis ? "Thane Center" : "Head Office", email: "", reportsTo: "" });
        },
        onError: () => setAddError("Failed to add user (username must be unique)"),
      }
    );
  };

  const handleDelete = (id: number, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    deleteUser.mutate({ id }, { onSuccess: () => { invalidate(); showFlash("✓ User deleted"); } });
  };

  if (!canView) {
    return (
      <div className="p-5">
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <div className="text-4xl mb-3">🔒</div>
          <div className="font-bold text-foreground">Restricted</div>
          <div className="text-sm text-muted-foreground mt-1">Only Boss, MIS or Center Heads can view this page</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-extrabold text-foreground flex items-center gap-2">🔑 Credentials &amp; Hierarchy</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPasswords((v) => !v)}
            className="px-4 py-2 bg-muted text-foreground text-sm font-semibold rounded-lg hover:bg-muted transition flex items-center gap-1.5">
            {showPasswords ? "🙈 Hide Passwords" : "👁 Show Passwords"}
          </button>
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 transition flex items-center gap-1.5">
            + Add New User
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-4">{seesAll ? "All user login credentials, and who reports to whom" : `Login credentials for your center${myCenter ? ` — ${myCenter}` : ""}`}</p>

      {flash && (
        <div className="mb-3 px-4 py-2 bg-green-50 border border-green-200 dark:bg-green-950/40 dark:border-green-800 rounded-lg text-green-700 dark:text-green-300 text-xs font-medium inline-block">{flash}</div>
      )}

      {/* Add form */}
      {showAddForm && (
        <div className="mb-4 bg-card rounded-xl border border-border shadow-sm p-4">
          <div className="font-semibold text-foreground text-sm mb-3">New User</div>
          {addError && <div className="mb-2 text-xs text-red-600 dark:text-red-300">{addError}</div>}
          <form onSubmit={handleAdd} className="grid grid-cols-3 gap-2.5">
            <input placeholder="Full Name *" value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            <input placeholder="Role * (e.g. Asst Manager)" value={addForm.role} onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value }))} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            <input placeholder="Username *" value={addForm.username} onChange={(e) => setAddForm((f) => ({ ...f, username: e.target.value }))} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            <div className="relative">
              <input type={showAddPw ? "text" : "password"} placeholder="Password *" value={addForm.password} onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))} className="w-full pr-10 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              <button type="button" onClick={() => setShowAddPw((s) => !s)} title={showAddPw ? "Hide password" : "Show password"} aria-label={showAddPw ? "Hide password" : "Show password"}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-base">
                {showAddPw ? "🙈" : "👁"}
              </button>
            </div>
            <input type="email" placeholder="Email (auto reminders)" value={addForm.email} onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            <select value={addForm.department} onChange={(e) => setAddForm((f) => ({ ...f, department: e.target.value }))} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              {DEPTS.map((d) => <option key={d}>{d}</option>)}
            </select>
            {seesAll && (
              <select value={addForm.center} onChange={(e) => setAddForm((f) => ({ ...f, center: e.target.value }))} className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                {allCenterOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <select value={addForm.reportsTo} onChange={(e) => setAddForm((f) => ({ ...f, reportsTo: e.target.value }))} className="col-span-3 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">— Top of hierarchy (Boss) —</option>
              {baseUsers.filter((u) => u.role !== "Sales Agent").map((u) => <option key={u.id} value={u.id}>Reports to: {u.name} ({u.role})</option>)}
            </select>
            <div className="flex gap-2 col-span-3">
              <button type="submit" disabled={createUser.isPending} className="px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-60">
                {createUser.isPending ? "Adding..." : "Add User"}
              </button>
              <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 bg-muted text-foreground text-xs font-semibold rounded-lg hover:bg-muted">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Center options for datalists */}
      <datalist id="center-options">
        {allCenterOptions.map((c) => <option key={c} value={c} />)}
      </datalist>

      {/* Center filter */}
      {seesAll && centers.length > 1 && (
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">🏢 Filter by Center</span>
          <button
            onClick={() => setCenterFilter("All")}
            className={"px-3 py-1.5 rounded-full text-xs font-semibold transition border " + (activeCenter === "All" ? "bg-primary text-white border-primary" : "bg-card text-foreground border-border hover:bg-muted")}>
            All Centers
          </button>
          {centers.map((c) => (
            <button key={c} onClick={() => setCenterFilter(c)}
              className={"px-3 py-1.5 rounded-full text-xs font-semibold transition border " + (activeCenter === c ? "bg-primary text-white border-primary" : "bg-card text-foreground border-border hover:bg-muted")}>
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-background border-b border-border">
                {["NAME","ROLE","USERNAME","PASSWORD","DEPARTMENT","CENTER","REPORTS TO (MANAGER)","EMAIL (FOR AUTO REMINDERS)",""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">Loading...</td></tr>
              ) : visibleUsers.map((u) => {
                const isTop = u.reportsTo == null;
                return (
                  <tr key={u.id} className="hover:bg-muted">
                    <td className="px-4 py-3">
                      <input
                        type="text" defaultValue={u.name} placeholder="Full name"
                        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== u.name) handleField(u.id, "name", v); else e.target.value = u.name; }}
                        className="px-2 py-1.5 border border-border rounded-lg text-xs font-bold text-foreground w-36 focus:outline-none focus:ring-2 focus:ring-ring bg-card" />
                    </td>
                    <td className="px-4 py-3">
                      {seesAll ? (
                        <input
                          type="text" defaultValue={u.role} placeholder="Role"
                          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== u.role) handleField(u.id, "role", v); else e.target.value = u.role; }}
                          className="px-2 py-1.5 border border-border rounded-lg text-xs font-semibold w-32 focus:outline-none focus:ring-2 focus:ring-ring bg-card" />
                      ) : (
                        <span className="text-xs font-semibold text-muted-foreground">{u.role}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text" defaultValue={u.username ?? ""} placeholder="username"
                        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== u.username) handleField(u.id, "username", v, () => { e.target.value = u.username ?? ""; }); else e.target.value = u.username ?? ""; }}
                        className="px-2 py-1.5 border border-border rounded-lg text-xs font-mono text-primary w-32 focus:outline-none focus:ring-2 focus:ring-ring bg-card" />
                    </td>
                    <td className="px-4 py-3">
                      {resetId === u.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            autoFocus type="text" value={newPw} placeholder="New password"
                            onChange={(e) => setNewPw(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleReset(u.id); if (e.key === "Escape") { setResetId(null); setNewPw(""); } }}
                            className="px-2 py-1 border border-border rounded-lg text-xs w-32 focus:outline-none focus:ring-2 focus:ring-ring" />
                          <button onClick={() => handleReset(u.id)} disabled={updateUser.isPending}
                            className="px-2 py-1 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-60">Save</button>
                          <button onClick={() => { setResetId(null); setNewPw(""); }}
                            className="px-2 py-1 bg-muted text-muted-foreground text-xs font-semibold rounded-lg hover:bg-muted">✕</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-muted-foreground text-xs select-all">
                            {showPasswords ? (passwordMap.get(u.id) ?? "—") : "••••••••"}
                          </span>
                          <button onClick={() => { setResetId(u.id); setNewPw(""); }} title="Reset password"
                            className="text-muted-foreground hover:text-primary transition text-xs">✎</button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {seesAll ? (
                        <select value={u.department} onChange={(e) => handleField(u.id, "department", e.target.value)}
                          className="px-2 py-1.5 border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring bg-card">
                          {DEPTS.map((d) => <option key={d}>{d}</option>)}
                        </select>
                      ) : (
                        <span className="text-xs text-muted-foreground">{u.department}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isBoss ? (
                        <input
                          list="center-options" type="text" defaultValue={u.center ?? ""} placeholder="Center"
                          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== u.center) handleField(u.id, "center", v); else e.target.value = u.center ?? ""; }}
                          className="px-2 py-1.5 border border-border rounded-lg text-xs w-32 focus:outline-none focus:ring-2 focus:ring-ring bg-card" />
                      ) : isMis ? (
                        <select value={u.center ?? ""} onChange={(e) => { const v = e.target.value; if (v && v !== u.center) handleField(u.id, "center", v); }}
                          className="px-2 py-1.5 border border-border rounded-lg text-xs w-32 focus:outline-none focus:ring-2 focus:ring-ring bg-card">
                          {centerChoices.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : (
                        <span className="text-xs text-muted-foreground">{u.center ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isTop ? (
                        <select value="" onChange={(e) => handleField(u.id, "reportsTo", e.target.value)}
                          className="px-2 py-1.5 border border-border rounded-lg text-xs italic text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring bg-card">
                          <option value="">— Top of hierarchy —</option>
                          {baseUsers.filter((m) => m.id !== u.id && m.role !== "Sales Agent").map((m) => <option key={m.id} value={m.id} className="not-italic text-foreground">{m.name}</option>)}
                        </select>
                      ) : (
                        <select value={String(u.reportsTo)} onChange={(e) => handleField(u.id, "reportsTo", e.target.value)}
                          className="px-2 py-1.5 border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring bg-card">
                          <option value="">— Top of hierarchy —</option>
                          {baseUsers.filter((m) => m.id !== u.id && m.role !== "Sales Agent").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="email" defaultValue={u.email ?? ""} placeholder="name@company.com"
                        onBlur={(e) => { if ((e.target.value || "") !== (u.email ?? "")) handleField(u.id, "email", e.target.value); }}
                        className="px-2 py-1.5 border border-border rounded-lg text-xs w-48 focus:outline-none focus:ring-2 focus:ring-ring" />
                    </td>
                    <td className="px-4 py-3">
                      {u.id !== currentUser.id && (
                        <button onClick={() => handleDelete(u.id, u.name)} title="Delete user"
                          className="text-muted-foreground hover:text-red-500 dark:hover:text-red-400 transition text-sm">🗑</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2">💡 Department / Center / Reports To / Email save automatically as soon as you change them</p>
    </div>
  );
}
