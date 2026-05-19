import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@workspace/replit-auth-web";
import Layout from "@/components/Layout";
import Landing from "@/pages/Landing";
import LoginPage from "@/pages/Login";
import AppDashboard from "@/pages/AppDashboard";
import InboxPage from "@/pages/Inbox";
import CalendarPage from "@/pages/Agenda";
import TasksPage from "@/pages/Tarefas";
import PeoplePage from "@/pages/People";
import RegrasPage from "@/pages/Regras";
import ConciergePage from "@/pages/Concierge";
import CasaPage from "@/pages/Casa";
import SettingsPage from "@/pages/Settings";
import OnboardingPage from "@/pages/Onboarding";
import AdminPage from "@/pages/Admin";
import NotFound from "@/pages/not-found";
import DevToolbar from "@/components/DevToolbar";
import { Home } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

function LoadingScreen() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-4"
      style={{ background: "#F7F4EA" }}
    >
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{ background: "#0E3B2E" }}
      >
        <Home className="h-7 w-7 text-white" strokeWidth={1.5} />
      </div>
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full animate-bounce"
            style={{
              background: "#0E3B2E",
              animationDelay: `${i * 0.15}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function AppShell() {
  return (
    <Layout>
      <Switch>
        {/* Primary 4-tab routes */}
        <Route path="/app"       component={AppDashboard} />
        <Route path="/inbox"     component={InboxPage} />
        <Route path="/calendar"  component={CalendarPage} />
        <Route path="/casa"      component={CasaPage} />

        {/* Secondary routes */}
        <Route path="/tasks"     component={TasksPage} />
        <Route path="/people"    component={PeoplePage} />
        <Route path="/rules"     component={RegrasPage} />
        <Route path="/concierge" component={ConciergePage} />
        <Route path="/settings/privacy" component={SettingsPage} />

        {/* Legacy redirects */}
        <Route path="/hoje">
          {() => { window.location.replace("/app"); return null; }}
        </Route>
        <Route path="/tarefas">
          {() => { window.location.replace("/tasks"); return null; }}
        </Route>
        <Route path="/agenda">
          {() => { window.location.replace("/calendar"); return null; }}
        </Route>
        <Route path="/regras">
          {() => { window.location.replace("/rules"); return null; }}
        </Route>

        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

interface OnboardingStateEnvelope {
  state: { completed: boolean; current_step: number } | null;
}

function AuthenticatedApp() {
  const [location] = useLocation();

  const { data: onboarding, isLoading } = useQuery<OnboardingStateEnvelope>({
    queryKey: ["onboarding-state"],
    queryFn: () =>
      fetch("/api/onboarding/state", { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<OnboardingStateEnvelope>;
      }),
    staleTime: 60_000,
  });

  if (isLoading) return <LoadingScreen />;

  const onboardingComplete = onboarding?.state?.completed ?? false;
  const onOnboarding = location === "/onboarding";

  if (!onboardingComplete && !onOnboarding) {
    return <Redirect to="/onboarding" />;
  }

  return (
    <Switch>
      <Route path="/onboarding" component={OnboardingPage} />
      <Route component={AppShell} />
    </Switch>
  );
}

function Router() {
  const { user, isLoading } = useAuth();

  return (
    <Switch>
      {/* Landing is always public */}
      <Route path="/" component={Landing} />

      {/* Admin — requires auth, bypasses onboarding check */}
      <Route path="/admin">
        {isLoading ? <LoadingScreen /> : !user ? <LoginPage /> : <AdminPage />}
      </Route>

      {/* All other routes require auth */}
      <Route>
        {isLoading ? (
          <LoadingScreen />
        ) : !user ? (
          <LoginPage />
        ) : (
          <AuthenticatedApp />
        )}
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
          <DevToolbar />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
