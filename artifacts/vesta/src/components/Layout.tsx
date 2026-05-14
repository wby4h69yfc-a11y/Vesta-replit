import { Link, useLocation } from "wouter";
import { Home, Inbox, Calendar, CheckSquare, Settings } from "lucide-react";
import { useListInboxItems } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

const NAV = [
  { path: "/hoje",    label: "Hoje",          icon: Home },
  { path: "/inbox",   label: "Para processar", icon: Inbox },
  { path: "/agenda",  label: "Agenda",         icon: Calendar },
  { path: "/tarefas", label: "Tarefas",        icon: CheckSquare },
  { path: "/casa",    label: "Casa",           icon: Settings },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: inboxItems } = useListInboxItems({ status: "ready_for_review", limit: 99 });
  const pendingCount = inboxItems?.length ?? 0;

  return (
    <div className="min-h-screen flex flex-col bg-background max-w-lg mx-auto relative">
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border px-4 pt-safe">
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: "#1B3A2D" }}>
              <Home className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight" style={{ color: "#1B3A2D" }}>vesta</span>
          </div>
          <Link href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            ← Site
          </Link>
        </div>
      </header>

      <main className="flex-1 overflow-auto pb-24">
        {children}
      </main>

      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg z-50 bg-card/95 backdrop-blur border-t border-border">
        <div className="flex items-stretch pb-safe">
          {NAV.map(({ path, label, icon: Icon }) => {
            const isActive = location.startsWith(path);
            const showBadge = path === "/inbox" && pendingCount > 0;
            return (
              <Link
                key={path}
                href={path}
                className={cn(
                  "flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 text-[10px] font-medium transition-colors relative",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-testid={`nav-${path.replace("/", "") || "hoje"}`}
              >
                <div className="relative">
                  <Icon className={cn("w-5 h-5", isActive && "stroke-[2.5]")} />
                  {showBadge && (
                    <span className="absolute -top-1 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                      {pendingCount > 99 ? "99+" : pendingCount}
                    </span>
                  )}
                </div>
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
