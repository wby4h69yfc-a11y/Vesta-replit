import { useState, useEffect } from "react";
import { Clock, CheckSquare, Inbox as InboxIcon, Zap, ArrowRight, MessageCircle } from "lucide-react";
import { Link } from "wouter";
import {
  useGetDashboardSummary,
  useGetTodayEvents,
  useGetUpcomingTasks,
  useGetActivityFeed,
} from "@workspace/api-client-react";
import CategoryBadge from "@/components/CategoryBadge";
import { formatTime, formatRelativeTime, formatDate, isPast } from "@/lib/utils";
import { cn } from "@/lib/utils";
const V = {
  primary: "#0E3B2E",
  sage:    "#6F856F",
  ivory:   "#F7F4EA",
  cream:   "#FFFDF6",
  ink:     "#12231C",
  muted:   "#5F6B61",
  wa:      "#25D366",
  waHeader:"#075E54",
};

/* ── WhatsApp CTA card ── */
type WaInfo = { twilio_number?: string | null; twilioConfigured?: boolean };

function WhatsAppHero({ name }: { name?: string }) {
  const [waNumber, setWaNumber] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/webhook/whatsapp/info", { credentials: "include" })
      .then((r) => r.json())
      .then((d: WaInfo) => { if (d.twilio_number) setWaNumber(d.twilio_number); })
      .catch(() => {});
  }, []);

  function openWA(prefill?: string) {
    const num = waNumber ?? "14155238886"; // Twilio sandbox fallback
    const url = prefill
      ? `https://wa.me/${num}?text=${encodeURIComponent(prefill)}`
      : `https://wa.me/${num}`;
    window.open(url, "_blank");
  }

  const EXAMPLES = [
    "Reunião da escola quinta 19h",
    "Consulta da Bia semana que vem",
    "Levar lanche quinta",
  ];

  return (
    <div className="rounded-3xl overflow-hidden" style={{ border: "1px solid rgba(14,59,46,0.10)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4" style={{ background: V.waHeader }}>
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.15)" }}>
          <MessageCircle className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-white leading-none">Encaminhe um recado</p>
          <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.65)" }}>
            {name ? `Oi, ${name}! ` : ""}A Vesta organiza e avisa quando precisar.
          </p>
        </div>
        <button
          onClick={() => openWA()}
          className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold"
          style={{ background: "#25D366", color: "white" }}
        >
          Abrir →
        </button>
      </div>

      {/* Quick-action chips — each opens WhatsApp with pre-filled text */}
      <div className="px-4 py-3 flex flex-wrap gap-2" style={{ background: "#ECE5DD" }}>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => openWA(ex)}
            className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
            style={{ borderColor: "rgba(14,59,46,0.25)", color: V.primary, background: "rgba(255,255,255,0.70)" }}
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Last action summary strip ── */
function LastActionStrip() {
  const { data: activityFeed } = useGetActivityFeed();
  const last = activityFeed?.[0];
  if (!last) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm"
      style={{ background: "#EAF1E5", color: V.ink }}>
      <Zap className="h-4 w-4 shrink-0" style={{ color: V.primary }} />
      <span className="flex-1 truncate">
        <span className="font-medium">Vesta anotou: </span>{last.description}
      </span>
      <span className="text-xs shrink-0" style={{ color: V.muted }}>{formatRelativeTime(last.timestamp)}</span>
    </div>
  );
}

/* ── Compact stat pill ── */
function StatPill({ icon: Icon, count, label, to, alert }: {
  icon: React.ElementType; count: number; label: string; to?: string; alert?: boolean;
}) {
  const inner = (
    <div className={cn(
      "flex items-center gap-2 px-3 py-2.5 rounded-2xl text-sm transition-opacity",
      to && "cursor-pointer hover:opacity-80",
      alert ? "text-white" : "text-foreground bg-card border border-border",
    )} style={alert ? { background: V.primary } : undefined}>
      <Icon className="h-4 w-4 opacity-70 shrink-0" />
      <span className="font-bold text-base leading-none">{count}</span>
      <span className="text-xs opacity-70 leading-tight">{label}</span>
    </div>
  );
  return to ? <Link href={to}>{inner}</Link> : inner;
}

/* ── Main ── */
export default function Hoje() {
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary();
  const { data: todayEvents, isLoading: loadingEvents } = useGetTodayEvents();
  const { data: upcomingTasks } = useGetUpcomingTasks();
  const { data: activityFeed } = useGetActivityFeed();

  const today = new Date();
  const h = today.getHours();
  const greeting = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";

  const pendingInbox  = summary?.pending_inbox_count ?? 0;
  const todayCount    = summary?.todays_events_count ?? 0;
  const tasksPending  = (summary?.tasks_due_today ?? 0) + (summary?.tasks_overdue ?? 0);
  const hasAlert      = pendingInbox > 0 || (summary?.tasks_overdue ?? 0) > 0;

  return (
    <div className="p-4 space-y-4 animate-fade-in-up">
      {/* Greeting — minimal */}
      <div>
        <p className="text-xs" style={{ color: V.muted }}>{formatDate(today)}</p>
        <h1 className="text-xl font-bold mt-0.5" style={{ color: V.ink }}>{greeting}</h1>
      </div>

      {/* ① PRIMARY: WhatsApp command layer */}
      <WhatsAppHero />

      {/* Last action summary */}
      <LastActionStrip />

      {/* ② SECONDARY: compact stat row — inbox is the priority action */}
      {(loadingSummary || hasAlert || todayCount > 0 || tasksPending > 0) && (
        <div className="flex flex-wrap gap-2">
          <StatPill
            icon={InboxIcon}
            count={loadingSummary ? 0 : pendingInbox}
            label="Para processar"
            to="/inbox"
            alert={pendingInbox > 0}
          />
          <StatPill
            icon={Clock}
            count={loadingSummary ? 0 : todayCount}
            label="Hoje na agenda"
          />
          <StatPill
            icon={CheckSquare}
            count={loadingSummary ? 0 : tasksPending}
            label="Tarefas"
            to="/tarefas"
            alert={(summary?.tasks_overdue ?? 0) > 0}
          />
        </div>
      )}

      {/* Inbox CTA if there's something to process */}
      {pendingInbox > 0 && (
        <Link href="/inbox">
          <div className="flex items-center justify-between rounded-2xl px-4 py-3 cursor-pointer hover:opacity-90 transition-opacity"
            style={{ background: V.primary, color: "white" }}>
            <div>
              <p className="text-sm font-semibold">
                {pendingInbox === 1 ? "1 recado" : `${pendingInbox} recados`} esperando aprovação
              </p>
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.65)" }}>
                Revise e aprove em um toque
              </p>
            </div>
            <ArrowRight className="h-5 w-5 shrink-0 opacity-80" />
          </div>
        </Link>
      )}

      {/* ③ Today's schedule — below the fold */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: V.muted }}>Agenda de hoje</h2>
        {loadingEvents ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />)}
          </div>
        ) : !todayEvents?.length ? (
          <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
            Nenhum compromisso hoje.
          </div>
        ) : (
          <div className="space-y-2">
            {todayEvents.map((ev) => (
              <div key={ev.id}
                className="flex items-start gap-3 bg-card border border-border rounded-xl p-3"
                data-testid={`event-card-${ev.id}`}>
                <div className="flex flex-col items-center min-w-[40px]">
                  <span className="text-sm font-semibold text-foreground">{formatTime(ev.start_at)}</span>
                  {ev.end_at && <span className="text-[10px] text-muted-foreground">{formatTime(ev.end_at)}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground leading-snug">{ev.title}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <CategoryBadge category={ev.category} />
                    {(ev.members?.length ?? 0) > 0 && (
                      <span className="text-xs text-muted-foreground">{ev.members?.join(", ")}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ④ Upcoming tasks — compact */}
      {(upcomingTasks?.length ?? 0) > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: V.muted }}>Próximas tarefas</h2>
          <div className="space-y-1.5">
            {upcomingTasks?.slice(0, 3).map((task) => (
              <div key={task.id}
                className="flex items-center gap-3 bg-card border border-border rounded-xl px-3 py-2.5"
                data-testid={`task-row-${task.id}`}>
                <div className="w-4 h-4 rounded-full border-2 border-muted-foreground shrink-0" />
                <p className="flex-1 text-sm text-foreground">{task.title}</p>
                {task.due_at && (
                  <span className={cn("text-xs", isPast(task.due_at) ? "text-destructive font-medium" : "text-muted-foreground")}>
                    {formatDate(task.due_at)}
                  </span>
                )}
              </div>
            ))}
            {(upcomingTasks?.length ?? 0) > 3 && (
              <Link href="/tarefas">
                <p className="text-xs text-center py-1" style={{ color: V.sage }}>
                  Ver todas as tarefas →
                </p>
              </Link>
            )}
          </div>
        </section>
      )}

      {/* ⑤ Recent activity — minimal, last 3 */}
      {(activityFeed?.length ?? 0) > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: V.muted }}>Atividade recente</h2>
          <div className="space-y-1">
            {activityFeed?.slice(0, 3).map((item) => (
              <div key={item.id} className="flex items-start gap-3 py-1.5" data-testid={`activity-${item.id}`}>
                <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: V.sage }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm leading-snug text-foreground">{item.description}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{formatRelativeTime(item.timestamp)}</p>
                </div>
                {item.category && <CategoryBadge category={item.category} className="shrink-0" />}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
