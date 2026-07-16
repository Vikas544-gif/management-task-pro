import Sidebar from "./Sidebar";
import NotificationBell from "./NotificationBell";
import ProfileMenu from "./ProfileMenu";
import { useDesktopNotif } from "@/hooks/use-desktop-notif";
import { useTaskReminders } from "@/hooks/use-task-reminders";

interface LayoutProps {
  children: React.ReactNode;
  user:
    | { id: number; name: string; role: string; department: string; pagePermissions?: string[] | null }
    | null;
  onLogout: () => void;
}

function TaskReminders({ userId }: { userId: number }) {
  useTaskReminders(userId);
  return null;
}

function DesktopNotifToggle({ userId }: { userId: number }) {
  const { enabled, toggle } = useDesktopNotif(userId);
  return (
    <button
      type="button"
      onClick={toggle}
      role="switch"
      aria-checked={enabled}
      aria-label="Popup notifications on your laptop screen"
      title={enabled ? "Laptop popup: On" : "Laptop popup: Off — click to enable"}
      className={`group flex items-center gap-2.5 h-9 pl-2.5 pr-2.5 rounded-full border transition-all duration-300 ${
        enabled
          ? "border-primary/40 bg-gradient-to-r from-primary/10 to-indigo-500/10 shadow-[0_0_0_3px_rgba(99,102,241,0.10)]"
          : "border-border bg-card hover:bg-muted hover:border-muted-foreground/30"
      }`}
    >
      <span
        className={`flex items-center justify-center w-6 h-6 rounded-full text-sm leading-none transition-all duration-300 ${
          enabled
            ? "bg-primary text-white shadow-sm scale-100"
            : "bg-muted text-muted-foreground scale-95"
        }`}
      >
        💻
      </span>
      <span className="flex flex-col items-start leading-none hidden sm:flex">
        <span className="text-xs font-bold text-foreground">Laptop popup</span>
        <span
          className={`text-[10px] font-semibold tracking-wide transition-colors duration-300 ${
            enabled ? "text-primary" : "text-muted-foreground"
          }`}
        >
          {enabled ? "ON" : "OFF"}
        </span>
      </span>
      <span
        className={`relative w-10 rounded-full transition-colors duration-300 shrink-0 ${
          enabled ? "bg-gradient-to-r from-primary to-indigo-500" : "bg-muted-foreground/30"
        }`}
        style={{ height: "1.375rem" }}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-[1.125rem] h-[1.125rem] rounded-full bg-white shadow-md transition-all duration-300 ease-out flex items-center justify-center ${
            enabled ? "translate-x-[1.125rem]" : ""
          }`}
        >
          {enabled && <span className="block w-1.5 h-1.5 rounded-full bg-primary" />}
        </span>
      </span>
    </button>
  );
}

export default function Layout({ children, user, onLogout }: LayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar user={user} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {user && <TaskReminders userId={user.id} />}
        {user && (
          <header className="h-14 shrink-0 bg-card border-b border-border flex items-center justify-end px-6 gap-4">
            <DesktopNotifToggle userId={user.id} />
            <NotificationBell userId={user.id} />
            <ProfileMenu user={user} onLogout={onLogout} />
          </header>
        )}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
