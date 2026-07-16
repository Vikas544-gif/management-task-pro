import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
  MutationCache,
  useQueryClient,
} from "@tanstack/react-query";
import { useGetMe, useLogout, getGetMeQueryKey, useListUsers } from "@workspace/api-client-react";
import { disableBackgroundPush } from "@/lib/push";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import TaskList from "@/pages/TaskList";
import AssignTask from "@/pages/AssignTask";
import MyTasks from "@/pages/MyTasks";
import Team from "@/pages/Team";
import Hierarchy from "@/pages/Hierarchy";
import Reports from "@/pages/Reports";
import SalesReport from "@/pages/SalesReport";
import AssignmentMonitor from "@/pages/AssignmentMonitor";
import Attendance from "@/pages/Attendance";
import Eod from "@/pages/Eod";
import AccessControl from "@/pages/AccessControl";
import EmailSettings from "@/pages/EmailSettings";
import Holidays from "@/pages/Holidays";
import Layout from "@/components/layout/Layout";
import { ThemeProvider } from "@/lib/theme";
import { canAccessPage, firstAccessiblePath, type PermUser } from "@/lib/permissions";

function AccessDenied() {
  return (
    <div className="p-8 max-w-md mx-auto mt-16 text-center">
      <div className="text-4xl mb-3">🔒</div>
      <h1 className="text-lg font-semibold text-foreground">Access restricted</h1>
      <p className="text-sm text-muted-foreground mt-2">
        You don't have access to this section. Please contact your administrator if you think this is a mistake.
      </p>
    </div>
  );
}

function isUnauthorized(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { status?: number }).status === 401;
}

// On any 401 (e.g. an expired/cleared session mid-use), drop the cached session
// user so the app falls back to the Login screen.
function handleUnauthorized() {
  queryClient.setQueryData(getGetMeQueryKey(), null);
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } },
  queryCache: new QueryCache({
    onError: (err) => {
      if (isUnauthorized(err)) handleUnauthorized();
    },
  }),
  mutationCache: new MutationCache({
    onError: (err) => {
      if (isUnauthorized(err)) handleUnauthorized();
    },
  }),
});

function AppInner() {
  const qc = useQueryClient();
  // Source of truth for "who is logged in" is the server session, NOT
  // localStorage — so it can't be spoofed by editing browser storage.
  const meQuery = useGetMe({
    query: { queryKey: getGetMeQueryKey(), retry: false, staleTime: Infinity },
  });
  const logoutMutation = useLogout();
  const user = meQuery.data ?? null;

  const handleLoginSuccess = () => {
    qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
  };

  const handleLogout = async () => {
    // Unsubscribe this browser from background push BEFORE the session ends
    // (the unsubscribe API needs the cookie) — avoids task popups leaking to
    // the next person on a shared computer.
    await disableBackgroundPush().catch(() => {});
    logoutMutation.mutate(undefined, {
      onSettled: () => {
        localStorage.removeItem("iss_user");
        qc.setQueryData(getGetMeQueryKey(), null);
        qc.clear();
      },
    });
  };

  if (meQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  if (!user) return <Login onLogin={handleLoginSuccess} />;

  return <AuthedApp user={user} onLogout={handleLogout} />;
}

function AuthedApp({
  user,
  onLogout,
}: {
  user: PermUser & { id: number; name: string; role: string; department: string };
  onLogout: () => void;
}) {
  const { data: allUsers = [] } = useListUsers();
  // Route-level guard so a restricted page can't be reached by typing its URL,
  // not just by hiding the nav link.
  const guard = (href: string, node: React.ReactNode) =>
    canAccessPage(user, allUsers, href) ? node : <AccessDenied />;

  return (
    <Layout user={user} onLogout={onLogout}>
      <Switch>
        <Route path="/">
          {() =>
            canAccessPage(user, allUsers, "/")
              ? <Dashboard currentUser={user} />
              : <Redirect to={firstAccessiblePath(user, allUsers)} />}
        </Route>
        <Route path="/my-tasks">{() => guard("/my-tasks", <MyTasks currentUser={user} />)}</Route>
        <Route path="/tasks">{() => guard("/tasks", <TaskList type="all" currentUser={user} />)}</Route>
        <Route path="/tasks/daily">{() => guard("/tasks/daily", <TaskList type="daily" currentUser={user} />)}</Route>
        <Route path="/tasks/weekly">{() => guard("/tasks/weekly", <TaskList type="weekly" currentUser={user} />)}</Route>
        <Route path="/tasks/monthly">{() => guard("/tasks/monthly", <TaskList type="monthly" currentUser={user} />)}</Route>
        <Route path="/assign">{() => guard("/assign", <AssignTask currentUser={user} />)}</Route>
        <Route path="/team">{() => guard("/team", <Team currentUser={user} />)}</Route>
        <Route path="/hierarchy">{() => guard("/hierarchy", <Hierarchy currentUser={user} />)}</Route>
        <Route path="/reports">{() => guard("/reports", <Reports currentUser={user} />)}</Route>
        <Route path="/sales-report">{() => guard("/sales-report", <SalesReport currentUser={user} />)}</Route>
        <Route path="/monitor">{() => guard("/monitor", <AssignmentMonitor currentUser={user} />)}</Route>
        <Route path="/attendance">{() => guard("/attendance", <Attendance currentUser={user} />)}</Route>
        <Route path="/eod">{() => guard("/eod", <Eod currentUser={user} />)}</Route>
        <Route path="/access">{() => guard("/access", <AccessControl currentUser={user} />)}</Route>
        <Route path="/holidays">{() => guard("/holidays", <Holidays currentUser={user} />)}</Route>
        <Route path="/settings">{() => guard("/settings", <EmailSettings />)}</Route>
        <Route>{() => <div className="p-8 text-muted-foreground">Page not found</div>}</Route>
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppInner />
        </WouterRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
