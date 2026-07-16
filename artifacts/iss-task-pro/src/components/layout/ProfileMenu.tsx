import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateUser, getListCredentialsQueryKey } from "@workspace/api-client-react";
import { useTheme, ACCENTS, THEMES } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface ProfileMenuProps {
  user: { id: number; name: string; role: string; department: string };
  onLogout: () => void;
}

export default function ProfileMenu({ user, onLogout }: ProfileMenuProps) {
  const qc = useQueryClient();
  const updateUser = useUpdateUser();
  const { theme, accent, setTheme, setAccent } = useTheme();
  const [open, setOpen] = useState(false);
  const [showPwForm, setShowPwForm] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const resetPwForm = () => {
    setShowPwForm(false);
    setNewPw("");
    setConfirmPw("");
    setPwError("");
  };

  useEffect(() => {
    if (!open) {
      resetPwForm();
      setPwSuccess(false);
    }
  }, [open]);

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    setPwError("");
    if (!newPw.trim()) {
      setPwError("Please enter a new password");
      return;
    }
    if (newPw !== confirmPw) {
      setPwError("Passwords do not match");
      return;
    }
    updateUser.mutate(
      { id: user.id, data: { password: newPw } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListCredentialsQueryKey() });
          resetPwForm();
          setPwSuccess(true);
          setTimeout(() => setPwSuccess(false), 2500);
        },
        onError: () => setPwError("Password could not be changed, please try again"),
      }
    );
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="btn-profile-menu"
        className="flex items-center gap-2 hover:bg-muted rounded-full pl-1 pr-2 py-1 transition"
      >
        <div className="w-8 h-8 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">
          {user.name[0]}
        </div>
        <div className="text-sm text-foreground font-medium hidden sm:block">{user.name}</div>
        <span className="text-muted-foreground text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <div className="font-bold text-foreground text-sm">{user.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {user.role} · {user.department}
            </div>
          </div>

          <div className="px-4 py-3 border-b border-border">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              🎨 Theme
            </span>
            <div className="grid grid-cols-3 gap-1.5 mt-2 max-h-48 overflow-y-auto pr-0.5">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  data-testid={`btn-theme-${t.id}`}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border p-1.5 transition",
                    theme === t.id ? "border-primary ring-2 ring-ring" : "border-border hover:border-primary/50"
                  )}
                >
                  <span
                    className="relative w-full h-7 rounded-md border border-border flex items-center justify-between px-1.5"
                    style={{ background: t.bg }}
                  >
                    <span className="text-[11px] leading-none">{t.emoji}</span>
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: t.fg }} />
                  </span>
                  <span className="text-[10px] font-semibold text-foreground">{t.label}</span>
                </button>
              ))}
            </div>

            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1 mt-3 mb-2">
              ✨ Accent
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setAccent(a.id)}
                  title={a.label}
                  aria-label={a.label}
                  aria-pressed={accent === a.id}
                  data-testid={`btn-accent-${a.id}`}
                  className={cn(
                    "w-6 h-6 rounded-full border-2 transition flex items-center justify-center",
                    accent === a.id ? "border-foreground scale-110 shadow-md" : "border-transparent hover:scale-110"
                  )}
                  style={{ background: a.swatch }}
                >
                  {accent === a.id && (
                    <span className="text-white text-[10px] font-bold drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.9)]">✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {pwSuccess && (
            <div className="px-4 py-2 text-xs text-green-600 font-medium bg-green-50 dark:text-green-300 dark:bg-green-950/40">✓ Password changed successfully</div>
          )}

          <div className="p-2">
            {showPwForm ? (
              <form onSubmit={handleChangePassword} className="p-2 space-y-2">
                {pwError && <div className="text-xs text-red-600 dark:text-red-300">{pwError}</div>}
                <input
                  type="password" autoFocus value={newPw} placeholder="New password"
                  onChange={(e) => setNewPw(e.target.value)}
                  data-testid="input-header-new-password"
                  className="w-full px-2.5 py-1.5 rounded-lg text-xs border border-border focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <input
                  type="password" value={confirmPw} placeholder="Confirm new password"
                  onChange={(e) => setConfirmPw(e.target.value)}
                  data-testid="input-header-confirm-password"
                  className="w-full px-2.5 py-1.5 rounded-lg text-xs border border-border focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <div className="flex gap-1.5">
                  <button
                    type="submit" disabled={updateUser.isPending}
                    data-testid="btn-header-save-password"
                    className="flex-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-60"
                  >
                    {updateUser.isPending ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button" onClick={resetPwForm}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-muted text-muted-foreground hover:bg-muted"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => { setPwSuccess(false); setShowPwForm(true); }}
                data-testid="btn-header-change-password"
                className="w-full text-left px-3 py-2 rounded-lg text-sm text-foreground hover:bg-muted transition flex items-center gap-2"
              >
                🔑 Change Password
              </button>
            )}

            <button
              onClick={onLogout}
              data-testid="btn-header-logout"
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40 transition flex items-center gap-2"
            >
              🚪 Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
