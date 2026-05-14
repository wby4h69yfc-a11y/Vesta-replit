import { Link, useLocation } from "wouter";
import { Home, Inbox, CalendarDays, Building2 } from "lucide-react";
import { useListInboxItems } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

const V = {
  primary: "#0E3B2E",
  deep:    "#08251E",
  sage:    "#6F856F",
  ivory:   "#F7F4EA",
  cream:   "#FFFDF6",
  ink:     "#12231C",
  muted:   "#5F6B61",
};

const NAV = [
  { path: "/app",      label: "Hoje",   icon: Home,        testId: "app" },
  { path: "/inbox",    label: "Caixa",  icon: Inbox,       testId: "inbox", badge: true },
  { path: "/calendar", label: "Agenda", icon: CalendarDays, testId: "calendar" },
  { path: "/casa",     label: "Casa",   icon: Building2,   testId: "casa" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: inboxItems } = useListInboxItems({ status: "ready_for_review", limit: 99 });
  const pendingCount = inboxItems?.length ?? 0;

  function isActive(path: string) {
    return location === path || location.startsWith(path + "/");
  }

  return (
    <div className="min-h-screen flex" style={{ background: V.ivory }}>

      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex w-60 flex-col shrink-0 sticky top-0 h-screen"
        style={{ background: V.primary }}>
        <div className="p-6 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ border: "1px solid rgba(255,255,255,0.2)" }}>
              <Home className="h-5 w-5 text-white" strokeWidth={1.8} />
            </div>
            <span className="text-xl font-semibold text-white tracking-tight">vesta</span>
          </div>
        </div>

        <nav className="flex-1 px-3 py-2 space-y-0.5">
          {NAV.map(({ path, label, icon: Icon, badge }) => {
            const active = isActive(path);
            const showBadge = badge && pendingCount > 0;
            return (
              <Link key={path} href={path}
                className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-colors"
                style={{
                  background: active ? "rgba(255,255,255,0.15)" : "transparent",
                  color: active ? "white" : "rgba(255,255,255,0.65)",
                }}
                data-testid={`nav-${path.replace(/\//g, "-").slice(1)}`}
              >
                <div className="relative">
                  <Icon className="h-5 w-5" />
                  {showBadge && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full bg-amber-400 text-[9px] font-bold flex items-center justify-center"
                      style={{ color: V.deep }}>
                      {pendingCount > 99 ? "99+" : pendingCount}
                    </span>
                  )}
                </div>
                <span>{label === "Caixa" ? "Caixa de entrada" : label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 pt-0">
          <Link href="/" className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs transition-colors"
            style={{ color: "rgba(255,255,255,0.35)" }}>
            ← Voltar ao site
          </Link>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Mobile header */}
        <header className="md:hidden sticky top-0 z-40 px-5 py-3.5 flex items-center justify-between"
          style={{ background: "rgba(247,244,234,0.95)", backdropFilter: "blur(8px)", borderBottom: "1px solid rgba(14,59,46,0.08)" }}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: V.primary }}>
              <Home className="h-4 w-4 text-white" strokeWidth={1.8} />
            </div>
            <span className="text-lg font-semibold tracking-tight" style={{ color: V.ink }}>vesta</span>
          </div>
          <Link href="/" className="text-xs" style={{ color: V.muted }}>← Site</Link>
        </header>

        {/* Desktop top bar */}
        <header className="hidden md:flex items-center px-8 py-4 sticky top-0 z-30"
          style={{ background: "rgba(247,244,234,0.95)", backdropFilter: "blur(8px)", borderBottom: "1px solid rgba(14,59,46,0.08)" }}>
          <p className="text-xs font-medium" style={{ color: V.muted }}>
            {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto pb-24 md:pb-8">
          <div className="max-w-2xl mx-auto md:max-w-none md:px-8">
            {children}
          </div>
        </main>

        {/* ── Mobile bottom nav — 4 tabs ── */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50"
          style={{ background: "rgba(247,244,234,0.97)", backdropFilter: "blur(12px)", borderTop: "1px solid rgba(14,59,46,0.08)" }}>
          <div className="flex items-center justify-around px-2 pt-2 pb-safe-or-2">
            {NAV.map(({ path, label, icon: Icon, badge, testId }) => {
              const active = isActive(path);
              const showBadge = badge && pendingCount > 0;
              return (
                <Link key={path} href={path}
                  className="flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl text-[10px] font-medium transition-colors"
                  style={{ color: active ? V.primary : V.sage }}
                  data-testid={`nav-${testId}`}
                >
                  <div className="relative">
                    <Icon className={cn("h-5.5 w-5.5", active && "stroke-[2.5]")} style={{ height: 22, width: 22 }} />
                    {showBadge && (
                      <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-0.5 rounded-full text-white text-[9px] font-bold flex items-center justify-center"
                        style={{ background: V.primary }}>
                        {pendingCount > 99 ? "99+" : pendingCount}
                      </span>
                    )}
                  </div>
                  <span className={cn(active && "font-semibold")}>{label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
