import { Link, useLocation } from "wouter";
import { Home, Inbox, CalendarDays, ListChecks, Users, ShieldCheck, ShoppingBag, Settings, MoreHorizontal, Plus, X } from "lucide-react";
import { useListInboxItems } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

const V = {
  primary: "#0E3B2E",
  deep:    "#08251E",
  sage:    "#6F856F",
  ivory:   "#F7F4EA",
  cream:   "#FFFDF6",
  ink:     "#12231C",
  muted:   "#5F6B61",
};

const NAV_ITEMS = [
  { path: "/app",              label: "Início",          icon: Home,         testId: "app" },
  { path: "/inbox",            label: "Caixa de entrada",icon: Inbox,        testId: "inbox", badge: true },
  { path: "/calendar",         label: "Planejamento",    icon: CalendarDays, testId: "calendar" },
  { path: "/tasks",            label: "Tarefas",         icon: ListChecks,   testId: "tasks" },
  { path: "/people",           label: "Pessoas",         icon: Users,        testId: "people" },
  { path: "/rules",            label: "Regras",          icon: ShieldCheck,  testId: "rules" },
  { path: "/concierge",        label: "Concierge",       icon: ShoppingBag,  testId: "concierge" },
  { path: "/settings/privacy", label: "Configurações",   icon: Settings,     testId: "settings" },
];

/* Bottom nav shows 4 + center capture button */
const BOTTOM_NAV = [
  NAV_ITEMS[0], // Início
  NAV_ITEMS[1], // Caixa
  null,         // center plus
  NAV_ITEMS[3], // Tarefas
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const { data: inboxItems } = useListInboxItems({ status: "ready_for_review", limit: 99 });
  const pendingCount = inboxItems?.length ?? 0;

  function isActive(path: string) {
    return location === path || location.startsWith(path + "/");
  }

  return (
    <div className="min-h-screen flex" style={{ background: V.ivory }}>

      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex w-64 flex-col shrink-0 sticky top-0 h-screen"
        style={{ background: V.primary }}>
        {/* Logo */}
        <div className="p-6 pb-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl"
              style={{ border: "1px solid rgba(255,255,255,0.2)" }}>
              <Home className="h-6 w-6 text-white" strokeWidth={1.8} />
            </div>
            <span className="text-2xl font-semibold text-white tracking-tight">vesta</span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-4 py-4 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(({ path, label, icon: Icon, badge }) => {
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
                    <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full text-[9px] font-bold flex items-center justify-center"
                      style={{ background: V.gold, color: V.deep }}>
                      {pendingCount > 99 ? "99+" : pendingCount}
                    </span>
                  )}
                </div>
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Back to site */}
        <div className="p-4 pt-0">
          <Link href="/" className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs transition-colors"
            style={{ color: "rgba(255,255,255,0.4)" }}>
            ← Voltar ao site
          </Link>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Mobile header */}
        <header className="md:hidden sticky top-0 z-40 px-4 py-3 flex items-center justify-between"
          style={{ background: "rgba(247,244,234,0.95)", backdropFilter: "blur(8px)", borderBottom: `1px solid rgba(14,59,46,0.08)` }}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl"
              style={{ background: V.primary }}>
              <Home className="h-4.5 w-4.5 text-white" strokeWidth={1.8} />
            </div>
            <span className="text-lg font-semibold tracking-tight" style={{ color: V.ink }}>vesta</span>
          </div>
          <Link href="/" className="text-xs" style={{ color: V.muted }}>← Site</Link>
        </header>

        {/* Desktop top bar */}
        <header className="hidden md:flex items-center justify-between px-8 py-5 sticky top-0 z-30"
          style={{ background: "rgba(247,244,234,0.95)", backdropFilter: "blur(8px)", borderBottom: `1px solid rgba(14,59,46,0.08)` }}>
          <div>
            <p className="text-xs font-medium" style={{ color: V.muted }}>
              {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
            </p>
          </div>
          <button className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: V.primary }}>
            <Plus className="h-4 w-4" />
            Capturar
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto pb-28 md:pb-8">
          <div className="max-w-2xl mx-auto md:max-w-none md:px-8">
            {children}
          </div>
        </main>

        {/* ── Mobile bottom nav ── */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 px-4 pb-safe"
          style={{ background: "rgba(247,244,234,0.97)", backdropFilter: "blur(12px)", borderTop: `1px solid rgba(14,59,46,0.08)` }}>
          <div className="flex items-center justify-around py-2 relative">
            {BOTTOM_NAV.map((item, i) => {
              if (!item) {
                return (
                  <button key="capture" className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg"
                    style={{ background: V.primary, boxShadow: "0 8px 24px rgba(14,59,46,0.30)", marginTop: -8 }}>
                    <Plus className="h-6 w-6" />
                  </button>
                );
              }
              const active = isActive(item.path);
              const showBadge = item.badge && pendingCount > 0;
              return (
                <Link key={item.path} href={item.path}
                  className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[10px] font-medium transition-colors"
                  style={{ color: active ? V.primary : V.sage }}
                  data-testid={`nav-${item.testId}`}
                >
                  <div className="relative">
                    <item.icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />
                    {showBadge && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full text-white text-[9px] font-bold flex items-center justify-center"
                        style={{ background: V.primary }}>
                        {pendingCount > 99 ? "99+" : pendingCount}
                      </span>
                    )}
                  </div>
                  <span>{item.label === "Caixa de entrada" ? "Caixa" : item.label}</span>
                </Link>
              );
            })}

            {/* Mais button */}
            <button
              onClick={() => setMoreOpen(!moreOpen)}
              className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[10px] font-medium"
              style={{ color: V.sage }}
            >
              <MoreHorizontal className="h-5 w-5" />
              <span>Mais</span>
            </button>
          </div>
        </nav>

        {/* Mais overlay */}
        {moreOpen && (
          <div className="md:hidden fixed inset-0 z-40" onClick={() => setMoreOpen(false)}>
            <div className="absolute inset-0 bg-black/30" />
            <div className="absolute bottom-20 left-4 right-4 rounded-3xl p-4 space-y-1"
              style={{ background: V.cream, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
              <div className="flex items-center justify-between mb-3 px-2">
                <span className="text-sm font-bold" style={{ color: V.ink }}>Navegação</span>
                <button onClick={() => setMoreOpen(false)}><X className="h-4 w-4" style={{ color: V.muted }} /></button>
              </div>
              {NAV_ITEMS.slice(4).map(({ path, label, icon: Icon }) => (
                <Link key={path} href={path}
                  onClick={() => setMoreOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition-colors"
                  style={{
                    background: isActive(path) ? "#EAF1E5" : "transparent",
                    color: isActive(path) ? V.primary : V.ink,
                  }}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
