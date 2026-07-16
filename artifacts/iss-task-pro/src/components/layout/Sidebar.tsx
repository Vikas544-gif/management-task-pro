import { Link, useLocation } from "wouter";
import { useListUsers } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, canAccessPage, type PermUser } from "@/lib/permissions";

interface SidebarProps {
  user: (PermUser & { name: string }) | null;
}

export default function Sidebar({ user }: SidebarProps) {
  const [location] = useLocation();
  const { data: allUsers = [] } = useListUsers();

  const navItems = NAV_ITEMS.filter((item) => canAccessPage(user, allUsers, item.href));

  return (
    <aside className="w-60 flex-shrink-0 flex flex-col bg-sidebar text-sidebar-foreground">
      <div className="px-5 py-5 border-b border-sidebar-border">
        <div className="text-white font-bold text-base leading-tight">Management Task Pro</div>
        <div className="text-xs mt-0.5 text-sidebar-foreground/70">
          Task Management System
        </div>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const active =
            item.href === "/"
              ? location === "/"
              : location === item.href || location.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-white"
              )}
              data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <span className="text-base w-5 text-center shrink-0">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
