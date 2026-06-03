import { Link, useLocation } from "wouter";
import { Home, Inbox, CalendarDays, Building2 } from "lucide-react";
import { useListInboxItems } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { V } from "@/lib/brand";

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
    <div className="min-h-screen flex" style={{ background: V.bg }}>

      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex w-60 flex-col shrink-0 sticky top-0 h-screen"
        style={{ background: V.surfaceDeep }}>
        <div className="p-6 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ border: "1px solid rgba(255,255,255,0.15)" }}>
              <svg viewBox="0 0 80 80" className="h-5 w-5" aria-hidden="true" style={{ color: V.brand }}>
                <path fill="currentColor" fillRule="evenodd"
                  d="M14 70 Q8 70 8 64 L8 39 A32 32 0 0 1 72 39 L72 64 Q72 70 66 70 Z M40 30 A17 17 0 0 0 23 47 L23 64 Q23 66 25 66 L55 66 Q57 66 57 64 L57 47 A17 17 0 0 0 40 30 Z" />
              </svg>
            </div>
            <span className="text-xl font-medium text-white tracking-tight"
              style={{ fontFamily: "var(--font-serif)" }}>Vesta</span>
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
                  background: active ? `${V.brand}22` : "transparent",
                  color: active ? V.brand : "rgba(253,251,246,0.55)",
                }}
                data-testid={`nav-${path.replace(/\//g, "-").slice(1)}`}
              >
                <div className="relative">
                  <Icon className="h-5 w-5" />
                  {showBadge && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full text-[9px] font-bold flex items-center justify-center"
                      style={{ background: V.brand, color: V.fgInverse }}>
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
            style={{ color: "rgba(253,251,246,0.3)" }}>
            ← Voltar ao site
          </Link>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Mobile header */}
        <header className="md:hidden sticky top-0 z-40 px-5 py-3.5 flex items-center justify-between"
          style={{ background: `${V.bg}f5`, backdropFilter: "blur(8px)", borderBottom: `1px solid ${V.border}` }}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl"
              style={{ background: V.brand }}>
              <svg viewBox="0 0 80 80" className="h-4 w-4 text-white" aria-hidden="true">
                <path fill="currentColor" fillRule="evenodd"
                  d="M14 70 Q8 70 8 64 L8 39 A32 32 0 0 1 72 39 L72 64 Q72 70 66 70 Z M40 30 A17 17 0 0 0 23 47 L23 64 Q23 66 25 66 L55 66 Q57 66 57 64 L57 47 A17 17 0 0 0 40 30 Z" />
              </svg>
            </div>
            <span className="text-lg font-medium tracking-tight"
              style={{ color: V.fg, fontFamily: "var(--font-serif)" }}>Vesta</span>
          </div>
          <Link href="/" className="text-xs" style={{ color: V.fgMuted }}>← Site</Link>
        </header>

        {/* Desktop top bar */}
        <header className="hidden md:flex items-center px-8 py-4 sticky top-0 z-30"
          style={{ background: `${V.bg}f5`, backdropFilter: "blur(8px)", borderBottom: `1px solid ${V.border}` }}>
          <p className="text-xs font-medium" style={{ color: V.fgMuted, fontFamily: "var(--font-mono)" }}>
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
          style={{ background: `${V.bg}f8`, backdropFilter: "blur(12px)", borderTop: `1px solid ${V.border}` }}>
          <div className="flex items-center justify-around px-2 pt-2 pb-safe-or-2">
            {NAV.map(({ path, label, icon: Icon, badge, testId }) => {
              const active = isActive(path);
              const showBadge = badge && pendingCount > 0;
              return (
                <Link key={path} href={path}
                  className="flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl text-[10px] font-medium transition-colors"
                  style={{ color: active ? V.brand : V.fgMuted }}
                  data-testid={`nav-${testId}`}
                >
                  <div className="relative">
                    <Icon className={cn("h-5.5 w-5.5", active && "stroke-[2.5]")} style={{ height: 22, width: 22 }} />
                    {showBadge && (
                      <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-0.5 rounded-full text-white text-[9px] font-bold flex items-center justify-center"
                        style={{ background: V.brand }}>
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
