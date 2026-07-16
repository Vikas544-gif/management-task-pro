import { useState, useMemo } from "react";
import { useListUsers, useUpdateUser, getListUsersQueryKey, useForceRelogin } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { CONTROLLABLE_ITEMS, roleDefaultVisible } from "@/lib/permissions";
import { CENTER_ORDER, isAllCentersViewer } from "@/lib/utils";

const HEAD_OFFICE = "Head Office";

interface AccessControlProps {
  currentUser: { id: number; name: string } | null;
}

export default function AccessControl({ currentUser }: AccessControlProps) {
  const qc = useQueryClient();
  const { data: users = [] } = useListUsers();
  const updateUser = useUpdateUser();
  const forceRelogin = useForceRelogin();
  // Confirm dialog + result message for the "force everyone to re-login" action.
  const [showReloginConfirm, setShowReloginConfirm] = useState(false);
  const [reloginDone, setReloginDone] = useState(false);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Local draft of the selected user's access. `mode` = "default" means follow
  // role rules (pagePermissions = null); "custom" means use the checked set.
  const [mode, setMode] = useState<"default" | "custom">("default");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // Center access draft (Boss/MIS-level users only). "default" = follow role
  // (centerPermissions = null); "custom" = restrict to the checked set.
  const [centerMode, setCenterMode] = useState<"default" | "custom">("default");
  const [centerChecked, setCenterChecked] = useState<Set<string>>(new Set());
  // Assign-list visibility draft. "default" = use normal scoping (assignVisibleUserIds
  // = null); "custom" = this person's picker shows ONLY the checked user IDs.
  const [assignMode, setAssignMode] = useState<"default" | "custom">("default");
  const [assignChecked, setAssignChecked] = useState<Set<number>>(new Set());
  // Whether recurring tasks are auto-generated for the selected user.
  const [autoTasks, setAutoTasks] = useState(true);
  const [saved, setSaved] = useState(false);

  // Only people who can actually log in are worth managing.
  const loginUsers = useMemo(
    () =>
      users
        .filter((u) => !!u.username)
        .sort((a, b) => (a.center ?? "").localeCompare(b.center ?? "") || a.name.localeCompare(b.name)),
    [users]
  );

  const byCenter = useMemo(() => {
    const map = new Map<string, typeof loginUsers>();
    for (const u of loginUsers) {
      const c = u.center ?? "—";
      if (!map.has(c)) map.set(c, []);
      map.get(c)!.push(u);
    }
    return map;
  }, [loginUsers]);

  const selected = users.find((u) => u.id === selectedId) ?? null;

  // Every center that exists in the company, in canonical display order.
  const allCenters = useMemo(() => {
    const set = new Set<string>([...CENTER_ORDER, ...users.map((u) => u.center).filter((c): c is string => Boolean(c))]);
    const rank = (c: string) => { const i = CENTER_ORDER.indexOf(c); return i === -1 ? CENTER_ORDER.length : i; };
    return Array.from(set).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }, [users]);

  // Center access only applies to Boss / MIS-level (all-centers) viewers — every
  // other role is already scoped to its own center/subtree, so there is nothing
  // to restrict. A Boss may be limited to any center; MIS/Director can never be
  // granted Head Office (the role ceiling already excludes it).
  const selectedIsBoss = !!selected && (selected.department === "Management" || selected.role === "Boss");
  const selectedIsAllViewer = isAllCentersViewer(selected);
  const centerEligible = selectedIsBoss || selectedIsAllViewer;
  // Centers this user's ROLE can ever see — the ceiling a custom set narrows.
  const centerCeiling = useMemo(
    () => (selectedIsBoss ? allCenters : allCenters.filter((c) => c !== HEAD_OFFICE)),
    [selectedIsBoss, allCenters]
  );

  // Load a user's current access into the editable draft.
  const selectUser = (id: number) => {
    const u = users.find((x) => x.id === id);
    setSelectedId(id);
    setSaved(false);
    const perms = u?.pagePermissions;
    if (perms == null) {
      setMode("default");
      // Pre-fill the checkboxes with the role-default set so switching to custom
      // starts from a sensible baseline.
      const base = new Set<string>(
        CONTROLLABLE_ITEMS.filter((item) => roleDefaultVisible(item, u, users)).map((i) => i.href)
      );
      setChecked(base);
    } else {
      setMode("custom");
      setChecked(new Set(perms));
    }
    // Center access draft
    const cperms = u?.centerPermissions;
    const uIsBoss = !!u && (u.department === "Management" || u.role === "Boss");
    const ceiling = uIsBoss ? allCenters : allCenters.filter((c) => c !== HEAD_OFFICE);
    if (cperms == null) {
      setCenterMode("default");
      setCenterChecked(new Set(ceiling));
    } else {
      setCenterMode("custom");
      setCenterChecked(new Set(cperms));
    }
    // Assign-list visibility draft
    const avis = u?.assignVisibleUserIds;
    if (avis == null) {
      setAssignMode("default");
      setAssignChecked(new Set());
    } else {
      setAssignMode("custom");
      setAssignChecked(new Set(avis));
    }
    // Auto-task generation draft (default ON if the flag is missing/true).
    setAutoTasks(u?.autoTasksEnabled !== false);
  };

  const toggle = (href: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });
    setSaved(false);
  };

  const centerToggle = (center: string) => {
    setCenterChecked((prev) => {
      const next = new Set(prev);
      if (next.has(center)) next.delete(center);
      else next.add(center);
      return next;
    });
    setSaved(false);
  };

  const assignToggle = (uid: number) => {
    setAssignChecked((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
    setSaved(false);
  };

  const handleSave = () => {
    if (!selected) return;
    const pagePermissions = mode === "default" ? null : Array.from(checked);
    // Only persist a center set for eligible (Boss/MIS-level) users; everyone
    // else stays on the role default (null). The custom set is intersected with
    // the role ceiling so it can only ever narrow, never widen.
    const centerPermissions =
      !centerEligible || centerMode === "default"
        ? null
        : centerCeiling.filter((c) => centerChecked.has(c));
    // Assign-list visibility: null = default scoping; otherwise the explicit set
    // of user IDs that appear in this person's "Assign To" picker (self excluded).
    const assignVisibleUserIds =
      assignMode === "default"
        ? null
        : Array.from(assignChecked).filter((uid) => uid !== selected.id);
    updateUser.mutate(
      { id: selected.id, data: { pagePermissions, centerPermissions, assignVisibleUserIds, autoTasksEnabled: autoTasks } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
          setSaved(true);
        },
      }
    );
  };

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Access Control</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Choose which sections each person can open. By default everyone follows their role's rules — switch a
            person to custom access to hide or show specific sections just for them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setReloginDone(false); setShowReloginConfirm(true); }}
          className="shrink-0 px-3 py-2 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-muted text-foreground"
        >
          Force everyone to re-login
        </button>
      </div>

      {showReloginConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card rounded-xl border border-border shadow-xl w-full max-w-md p-5">
            <h2 className="text-base font-bold text-foreground">Force everyone to re-login?</h2>
            {reloginDone ? (
              <p className="text-sm text-muted-foreground mt-2">
                Done. Everyone else has been logged out and will need to log in again. You stay logged in.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground mt-2">
                This logs out <b>all other users</b> immediately — they'll have to log in again to keep using the app.
                Use this after publishing an update so everyone lands on the new version. You will stay logged in.
              </p>
            )}
            {forceRelogin.isError && !reloginDone && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                Something went wrong. Please try again.
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              {reloginDone ? (
                <button
                  type="button"
                  onClick={() => setShowReloginConfirm(false)}
                  className="px-3 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90"
                >
                  Close
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setShowReloginConfirm(false)}
                    className="px-3 py-2 text-sm font-semibold rounded-lg border border-border bg-card hover:bg-muted text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={forceRelogin.isPending}
                    onClick={() =>
                      forceRelogin.mutate(undefined, {
                        onSuccess: () => setReloginDone(true),
                      })
                    }
                    className="px-3 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {forceRelogin.isPending ? "Working…" : "Yes, log everyone out"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-5">
        {/* User list */}
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden self-start">
          <div className="px-4 py-3 border-b border-border text-xs font-bold uppercase tracking-wide text-muted-foreground">
            People
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-2 space-y-3">
            {Array.from(byCenter.entries()).map(([center, members]) => (
              <div key={center}>
                <div className="px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
                  {center}
                </div>
                <div className="space-y-0.5">
                  {members.map((u) => {
                    const custom = u.pagePermissions != null || u.centerPermissions != null || u.assignVisibleUserIds != null;
                    const active = u.id === selectedId;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => selectUser(u.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between gap-2 ${
                          active ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"
                        }`}
                      >
                        <span className="truncate">
                          {u.name}
                          {u.id === currentUser?.id && " (you)"}
                        </span>
                        {custom && (
                          <span
                            className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              active ? "bg-primary-foreground/20" : "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                            }`}
                            title="This person has custom access"
                          >
                            CUSTOM
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Detail / editor */}
        <div className="bg-card rounded-xl border border-border shadow-sm p-5 self-start">
          {!selected ? (
            <div className="text-sm text-muted-foreground py-12 text-center">
              Select a person on the left to manage their access.
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <div className="text-base font-bold text-foreground">{selected.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {selected.role} · {selected.department} · {selected.center ?? "—"}
                  </div>
                </div>
                {saved && (
                  <span className="shrink-0 text-xs font-semibold text-green-600 dark:text-green-400">✓ Saved</span>
                )}
              </div>

              {/* Mode switch */}
              <div className="flex gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => {
                    setMode("default");
                    setSaved(false);
                  }}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                    mode === "default"
                      ? "bg-primary/10 border-primary/40 text-foreground"
                      : "bg-card border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Default (by role)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("custom");
                    setSaved(false);
                  }}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                    mode === "custom"
                      ? "bg-primary/10 border-primary/40 text-foreground"
                      : "bg-card border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Custom access
                </button>
              </div>

              <p className="text-xs text-muted-foreground mb-3">
                {mode === "default"
                  ? "This person sees the sections their role normally allows (shown below, read-only)."
                  : "Untick a section to hide it from this person. You can only hide sections their role already allows — you can never grant a section their role doesn't include."}
              </p>

              {/* Module checklist */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {CONTROLLABLE_ITEMS.map((item) => {
                  const roleAllowed = roleDefaultVisible(item, selected, users);
                  // Overrides are restriction-only: a section the role can't see
                  // can never be granted here, so it's shown disabled & unavailable.
                  const disabled = mode === "default" || !roleAllowed;
                  const on = !roleAllowed ? false : mode === "default" ? roleAllowed : checked.has(item.href);
                  return (
                    <label
                      key={item.href}
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                        disabled
                          ? "border-border bg-muted/40 cursor-not-allowed"
                          : "border-border bg-card cursor-pointer hover:bg-muted"
                      } ${on ? "" : "opacity-60"}`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={disabled}
                        onChange={() => toggle(item.href)}
                        className="w-4 h-4 rounded accent-primary"
                      />
                      <span className="text-base w-5 text-center shrink-0">{item.icon}</span>
                      <span className="text-foreground">{item.label}</span>
                      {mode === "custom" && !roleAllowed && (
                        <span
                          className="ml-auto text-[10px] text-muted-foreground"
                          title="This section isn't available for this person's role, so it can't be granted here."
                        >
                          not for this role
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>

              {/* ── Center access (Boss / MIS-level users only) ─────────── */}
              <div className="mt-6 pt-5 border-t border-border">
                <div className="text-sm font-bold text-foreground mb-1">Center access</div>
                {!centerEligible ? (
                  <p className="text-xs text-muted-foreground">
                    Center access only applies to Boss and MIS-level people who can see every center. This person is
                    already limited to their own center by their role, so there is nothing to restrict here.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground mb-3">
                      By default this person sees every center their role allows. Switch to custom to limit them to
                      specific centers — you can only narrow what their role already allows, never grant beyond it.
                    </p>
                    <div className="flex gap-2 mb-4">
                      <button
                        type="button"
                        onClick={() => { setCenterMode("default"); setSaved(false); }}
                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                          centerMode === "default"
                            ? "bg-primary/10 border-primary/40 text-foreground"
                            : "bg-card border-border text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        Default (all centers)
                      </button>
                      <button
                        type="button"
                        onClick={() => { setCenterMode("custom"); setSaved(false); }}
                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                          centerMode === "custom"
                            ? "bg-primary/10 border-primary/40 text-foreground"
                            : "bg-card border-border text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        Custom centers
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {allCenters.map((center) => {
                        const roleAllowed = centerCeiling.includes(center);
                        const disabled = centerMode === "default" || !roleAllowed;
                        const on = !roleAllowed ? false : centerMode === "default" ? true : centerChecked.has(center);
                        return (
                          <label
                            key={center}
                            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                              disabled
                                ? "border-border bg-muted/40 cursor-not-allowed"
                                : "border-border bg-card cursor-pointer hover:bg-muted"
                            } ${on ? "" : "opacity-60"}`}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={disabled}
                              onChange={() => centerToggle(center)}
                              className="w-4 h-4 rounded accent-primary"
                            />
                            <span className="text-foreground">{center}</span>
                            {centerMode === "custom" && !roleAllowed && (
                              <span
                                className="ml-auto text-[10px] text-muted-foreground"
                                title="This center isn't available for this person's role, so it can't be granted here."
                              >
                                not for this role
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* ── Assign-list visibility ───────────────────────────────── */}
              <div className="mt-6 pt-5 border-t border-border">
                <div className="text-sm font-bold text-foreground mb-1">Assign-list visibility</div>
                <p className="text-xs text-muted-foreground mb-3">
                  Controls who appears in <span className="font-semibold">{selected.name}</span>'s "Assign To" dropdown
                  on the Assign Task page. By default it follows the normal center rules. Switch to custom to choose
                  exactly which people they can assign tasks to — everyone else is hidden from their picker.
                </p>
                <div className="flex gap-2 mb-4">
                  <button
                    type="button"
                    onClick={() => { setAssignMode("default"); setSaved(false); }}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                      assignMode === "default"
                        ? "bg-primary/10 border-primary/40 text-foreground"
                        : "bg-card border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Default (by rules)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAssignMode("custom"); setSaved(false); }}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                      assignMode === "custom"
                        ? "bg-primary/10 border-primary/40 text-foreground"
                        : "bg-card border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Custom people
                  </button>
                </div>
                {assignMode === "custom" && (
                  <div className="space-y-3">
                    {Array.from(byCenter.entries()).map(([center, members]) => {
                      const selectable = members.filter((u) => u.id !== selected.id);
                      if (selectable.length === 0) return null;
                      return (
                        <div key={center}>
                          <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">{center}</div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {selectable.map((u) => {
                              const on = assignChecked.has(u.id);
                              return (
                                <label
                                  key={u.id}
                                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-sm cursor-pointer transition-colors border-border bg-card hover:bg-muted ${on ? "" : "opacity-60"}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={() => assignToggle(u.id)}
                                    className="w-4 h-4 rounded accent-primary"
                                  />
                                  <span className="text-foreground truncate">{u.name}</span>
                                  <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{u.role}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── Auto-generate recurring tasks ────────────────────────── */}
              <div className="mt-6 pt-5 border-t border-border">
                <div className="text-sm font-bold text-foreground mb-1">Auto-generate recurring tasks</div>
                <p className="text-xs text-muted-foreground mb-3">
                  When ON, the system automatically creates this person's daily / weekly / monthly recurring tasks.
                  Turn it OFF to stop generating tasks for <span className="font-semibold">{selected.name}</span> — their
                  existing recurring tasks will also be removed. Turn it back ON any time to resume.
                </p>
                <label
                  className={`flex items-center gap-3 px-3 py-3 rounded-lg border cursor-pointer transition-colors ${
                    autoTasks ? "border-primary/40 bg-primary/10" : "border-border bg-card hover:bg-muted"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={autoTasks}
                    onChange={() => { setAutoTasks((v) => !v); setSaved(false); }}
                    className="w-4 h-4 rounded accent-primary"
                  />
                  <span className="text-sm font-semibold text-foreground">
                    {autoTasks ? "Auto-generation is ON" : "Auto-generation is OFF"}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {autoTasks ? "Tasks are created automatically" : "No tasks will be created"}
                  </span>
                </label>
              </div>

              <div className="mt-5 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={updateUser.isPending}
                  className="px-5 py-2.5 bg-primary text-white font-bold rounded-xl text-sm hover:bg-primary/90 disabled:opacity-60 transition"
                >
                  {updateUser.isPending ? "Saving..." : "Save access"}
                </button>
                {mode === "custom" && (
                  <span className="text-xs text-muted-foreground">
                    {checked.size} section{checked.size === 1 ? "" : "s"} allowed
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
