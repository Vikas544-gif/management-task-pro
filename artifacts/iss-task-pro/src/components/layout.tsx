import React from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { 
  Sidebar, 
  SidebarContent, 
  SidebarHeader, 
  SidebarMenu, 
  SidebarMenuItem, 
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarFooter,
  SidebarProvider
} from "@/components/ui/sidebar";
import { 
  LayoutDashboard, 
  CheckSquare, 
  Calendar, 
  CalendarDays, 
  CalendarRange, 
  Users, 
  PlusCircle, 
  BarChart, 
  Settings,
  LogOut,
  User as UserIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  if (!user) return <>{children}</>;

  return (
    <SidebarProvider>
      <div className="flex h-screen overflow-hidden w-full bg-background">
        <Sidebar className="border-r border-sidebar-border shadow-sm">
          <SidebarHeader className="p-4 flex items-center justify-between border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
            <div className="flex items-center gap-2 font-bold text-lg text-primary tracking-tight">
              <div className="w-8 h-8 bg-primary rounded flex items-center justify-center text-primary-foreground text-xs">
                MTP
              </div>
              Management Task Pro
            </div>
          </SidebarHeader>
          <SidebarContent className="p-2 gap-4">
            <SidebarGroup>
              <SidebarGroupLabel className="text-xs uppercase tracking-wider text-sidebar-foreground/50">Overview</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === "/"}>
                      <Link href="/" className="flex items-center gap-2">
                        <LayoutDashboard className="h-4 w-4" />
                        <span>Dashboard</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === "/reports"}>
                      <Link href="/reports" className="flex items-center gap-2">
                        <BarChart className="h-4 w-4" />
                        <span>Reports</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel className="text-xs uppercase tracking-wider text-sidebar-foreground/50">Tasks</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === "/tasks"}>
                      <Link href="/tasks" className="flex items-center gap-2">
                        <CheckSquare className="h-4 w-4" />
                        <span>All Tasks</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === "/tasks/daily"}>
                      <Link href="/tasks/daily" className="flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        <span>Daily Tasks</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === "/tasks/weekly"}>
                      <Link href="/tasks/weekly" className="flex items-center gap-2">
                        <CalendarDays className="h-4 w-4" />
                        <span>Weekly Tasks</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === "/tasks/monthly"}>
                      <Link href="/tasks/monthly" className="flex items-center gap-2">
                        <CalendarRange className="h-4 w-4" />
                        <span>Monthly Tasks</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === "/assign"}>
                      <Link href="/assign" className="flex items-center gap-2">
                        <PlusCircle className="h-4 w-4" />
                        <span>Assign Task</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {(user.role === "Admin" || user.role === "Manager") && (
              <SidebarGroup>
                <SidebarGroupLabel className="text-xs uppercase tracking-wider text-sidebar-foreground/50">Management</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location === "/team"}>
                        <Link href="/team" className="flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          <span>Team</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location === "/settings"}>
                        <Link href="/settings" className="flex items-center gap-2">
                          <Settings className="h-4 w-4" />
                          <span>Settings</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </SidebarContent>
          <SidebarFooter className="p-4 border-t border-sidebar-border flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center text-sidebar-foreground font-medium">
                {user.name.charAt(0)}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-sidebar-foreground leading-none">{user.name}</span>
                <span className="text-xs text-sidebar-foreground/70">{user.role}</span>
              </div>
            </div>
            <Button variant="outline" size="sm" className="w-full justify-start gap-2 bg-sidebar-accent border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent/80 hover:text-sidebar-foreground" onClick={logout}>
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </SidebarFooter>
        </Sidebar>
        <main className="flex-1 overflow-auto bg-background p-6">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
