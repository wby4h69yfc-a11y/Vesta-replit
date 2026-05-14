import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import Hoje from "@/pages/Hoje";
import InboxPage from "@/pages/Inbox";
import AgendaPage from "@/pages/Agenda";
import TarefasPage from "@/pages/Tarefas";
import RegrasPage from "@/pages/Regras";
import CasaPage from "@/pages/Casa";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Hoje} />
        <Route path="/inbox" component={InboxPage} />
        <Route path="/agenda" component={AgendaPage} />
        <Route path="/tarefas" component={TarefasPage} />
        <Route path="/regras" component={RegrasPage} />
        <Route path="/casa" component={CasaPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
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
