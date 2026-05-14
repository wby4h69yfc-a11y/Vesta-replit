import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import Landing from "@/pages/Landing";
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
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

function AppShell() {
  return (
    <Layout>
      <Switch>
        {/* Primary 4-tab routes */}
        <Route path="/app"       component={AppDashboard} />
        <Route path="/inbox"     component={InboxPage} />
        <Route path="/calendar"  component={CalendarPage} />
        <Route path="/casa"      component={CasaPage} />

        {/* Secondary routes (accessible from within pages) */}
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

function Router() {
  return (
    <Switch>
      <Route path="/"             component={Landing} />
      <Route path="/onboarding"   component={OnboardingPage} />
      <Route                      component={AppShell} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
