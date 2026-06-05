import { Clock, ListChecks, Inbox as InboxIcon, Zap, ChevronRight, ArrowRight, Banknote, CheckCircle2, School, AlertTriangle } from "lucide-react";
import WaitlistCard from "@/components/WaitlistCard";
import { Link } from "wouter";
import {
  useGetDashboardSummary,
  useGetTodayEvents,
  useGetUpcomingTasks,
  useGetActivityFeed,
  useListPatterns,
  useGetPaymentReimbursements,
  useSettlePaymentObligation,
  getGetPaymentReimbursementsQueryKey,
  useListActionCascades,
  type PaymentObligation,
  type ActionCascadeWithActions,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import CategoryBadge from "@/components/CategoryBadge";
import { formatTime, formatDate, formatRelativeTime, isPast } from "@/lib/utils";
import { cn } from "@/lib/utils";

import { V } from "@/lib/brand";

const NUDGE_STATUSES = new Set(["suggested", "threshold_met"]);

const METHOD_LABELS: Record<string, string> = {
  pix: "Pix", boleto: "Boleto", cartao: "Cartão", dinheiro: "Dinheiro", ted: "TED",
};

function formatCents(cents: number) {
  return `R$\u00A0${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

function ReimbursementsCard() {
  const { data, isLoading } = useGetPaymentReimbursements();
  const qc = useQueryClient();
  const { toast } = useToast();
  const settle = useSettlePaymentObligation({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetPaymentReimbursementsQueryKey() });
        toast({ description: "Acerto registrado." });
      },
    },
  });

  if (isLoading) return null;
  if (!data?.has_member) return null;

  const owedByMe = data?.owed_by_me ?? [];
  const owedToMe = data?.owed_to_me ?? [];
  if (owedByMe.length === 0 && owedToMe.length === 0) return null;

  function ObligationRow({ ob, dir }: { ob: PaymentObligation; dir: "by_me" | "to_me" }) {
    return (
      <div className="flex items-center gap-3 py-2.5" style={{ borderBottom: "1px solid rgba(14,59,46,0.07)" }}>
        <div className="flex-1 min-w-0">
          <p className="text-sm leading-snug truncate" style={{ color: V.ink }}>{ob.description}</p>
          <p className="text-xs mt-0.5" style={{ color: V.muted }}>
            {ob.amount_cents ? formatCents(ob.amount_cents) : "—"}
            {ob.due_date ? ` · vence ${ob.due_date.split("-").reverse().join("/")}` : ""}
            {ob.payment_method ? ` · ${METHOD_LABELS[ob.payment_method] ?? ob.payment_method}` : ""}
          </p>
        </div>
        <button
          onClick={() => settle.mutate({ id: ob.id, data: {} })}
          disabled={settle.isPending}
          className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-opacity disabled:opacity-50"
          style={{ background: "#EAF1E5", color: V.primary }}
          data-testid={`settle-${ob.id}`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          Acertar
        </button>
      </div>
    );
  }

  return (
    <section data-testid="reimbursements-card">
      <div className="flex items-center gap-2 mb-3">
        <Banknote className="w-4 h-4" style={{ color: V.sage }} />
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: V.muted }}>Reembolsos</h2>
      </div>
      <div className="rounded-3xl overflow-hidden" style={{ background: V.cream, border: `1px solid rgba(14,59,46,0.10)` }}>
        {owedByMe.length > 0 && (
          <div className="px-4 pt-3 pb-1">
            <p className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: "#DC2626" }}>Você deve</p>
            {owedByMe.map((ob) => <ObligationRow key={ob.id} ob={ob} dir="by_me" />)}
          </div>
        )}
        {owedToMe.length > 0 && (
          <div className="px-4 pt-3 pb-1">
            <p className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: "#059669" }}>Te devem</p>
            {owedToMe.map((ob) => <ObligationRow key={ob.id} ob={ob} dir="to_me" />)}
          </div>
        )}
      </div>
    </section>
  );
}

function CrecheEscolaSection() {
  const { data: cascades = [] } = useListActionCascades();

  const matriculaCascades = (cascades as ActionCascadeWithActions[]).filter(
    (c) => c.cascade_type === "matricula" && c.actions?.some((a) => a.status === "pending"),
  );
  const backupCascades = (cascades as ActionCascadeWithActions[]).filter(
    (c) => c.cascade_type === "backup_care" && c.actions?.some((a) => a.status === "pending"),
  );

  const hasExtras = matriculaCascades.length > 0 || backupCascades.length > 0;

  return (
    <div className="space-y-3" data-testid="creche-escola-section">
      {/* Waitlists (WF-20) — own header inside */}
      <WaitlistCard />

      {/* Matrícula deadlines (WF-21) */}
      {matriculaCascades.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <School className="w-4 h-4" style={{ color: V.sage }} />
              <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: V.muted }}>
                Matrículas pendentes
              </h2>
            </div>
            <Link href="/inbox" className="text-xs font-medium" style={{ color: V.primary }}>
              Ver na Caixa →
            </Link>
          </div>
          <div className="rounded-3xl overflow-hidden" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.10)" }}>
            {matriculaCascades.map((c, i) => {
              const pending = c.actions?.filter((a) => a.status === "pending").length ?? 0;
              return (
                <Link href="/inbox" key={c.id}>
                  <div
                    className="flex items-center gap-3 px-4 py-3 hover:opacity-80 transition-opacity"
                    style={{ borderTop: i > 0 ? "1px solid rgba(14,59,46,0.07)" : "none" }}
                  >
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: V.primary }} />
                    <p className="flex-1 text-sm font-medium truncate" style={{ color: V.ink }}>
                      {c.trigger_description}
                    </p>
                    <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: "#EAF1E5", color: V.primary }}>
                      {pending} doc{pending !== 1 ? "s" : ""}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: V.muted }} />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Active backup care cascades (WF-24) */}
      {backupCascades.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" style={{ color: "#B45309" }} />
              <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#B45309" }}>
                Cuidado emergencial
              </h2>
            </div>
            <Link href="/inbox" className="text-xs font-medium" style={{ color: V.primary }}>
              Resolver →
            </Link>
          </div>
          <div className="rounded-3xl overflow-hidden" style={{ background: "#FFFBEB", border: "1px solid rgba(180,83,9,0.20)" }}>
            {backupCascades.map((c, i) => {
              const pending = c.actions?.filter((a) => a.status === "pending").length ?? 0;
              return (
                <Link href="/inbox" key={c.id}>
                  <div
                    className="flex items-center gap-3 px-4 py-3 hover:opacity-80 transition-opacity"
                    style={{ borderTop: i > 0 ? "1px solid rgba(180,83,9,0.12)" : "none" }}
                  >
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: "#D97706" }} />
                    <p className="flex-1 text-sm font-medium truncate" style={{ color: V.ink }}>
                      {c.trigger_description}
                    </p>
                    <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(180,83,9,0.10)", color: "#B45309" }}>
                      {pending} passo{pending !== 1 ? "s" : ""}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: "#B45309" }} />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Section header — only when there are cascades beyond waitlists */}
      {!hasExtras && null}
    </div>
  );
}

function PatternNudge() {
  const { data: allPatterns } = useListPatterns();
  const count = allPatterns?.filter((p) => NUDGE_STATUSES.has(p.status)).length ?? 0;
  if (count === 0) return null;
  return (
    <Link href="/rules">
      <div
        className="flex items-center gap-3 rounded-2xl px-4 py-3 cursor-pointer hover:opacity-90 transition-opacity"
        style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.12)" }}
        data-testid="pattern-nudge"
      >
        <span className="text-lg shrink-0">💡</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: V.ink }}>
            {count === 1 ? "1 sugestão de regra detectada" : `${count} sugestões de regras detectadas`}
          </p>
          <p className="text-xs mt-0.5" style={{ color: V.muted }}>Ver e aprovar padrões →</p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0" style={{ color: V.sage }} />
      </div>
    </Link>
  );
}

export default function AppDashboard() {
  const { data: summary, isLoading } = useGetDashboardSummary();
  const { data: todayEvents } = useGetTodayEvents();
  const { data: upcomingTasks } = useGetUpcomingTasks();
  const { data: activityFeed } = useGetActivityFeed();

  const today = new Date();
  const hour = today.getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  return (
    <div className="px-4 py-6 md:py-8 space-y-7 animate-fade-in-up">

      {/* Greeting */}
      <div>
        <p className="text-sm font-medium" style={{ color: V.muted }}>
          {formatDate(today)}
        </p>
        <h1 className="font-serif text-4xl font-semibold tracking-tight mt-1" style={{ color: V.ink }}>
          {greeting}, Camila ☀️
        </h1>
        <p className="text-sm mt-1" style={{ color: V.muted }}>Sua casa, organizada com você.</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <Link href="/inbox">
          <div className="rounded-3xl p-4 flex flex-col gap-2 cursor-pointer hover:opacity-90 transition-opacity"
            style={{ background: (summary?.pending_inbox_count ?? 0) > 0 ? V.primary : V.cream, border: `1px solid rgba(14,59,46,0.10)`, boxShadow: "0 4px 16px rgba(14,59,46,0.08)" }}
            data-testid="stat-inbox">
            <InboxIcon className="w-4 h-4" style={{ color: (summary?.pending_inbox_count ?? 0) > 0 ? "rgba(255,255,255,0.8)" : V.sage }} />
            <span className="font-serif text-3xl font-semibold" style={{ color: (summary?.pending_inbox_count ?? 0) > 0 ? "white" : V.ink }}>
              {isLoading ? "—" : summary?.pending_inbox_count ?? 0}
            </span>
            <span className="text-[11px] leading-tight" style={{ color: (summary?.pending_inbox_count ?? 0) > 0 ? "rgba(255,255,255,0.75)" : V.muted }}>
              Para processar
            </span>
          </div>
        </Link>

        <div className="rounded-3xl p-4 flex flex-col gap-2" style={{ background: V.cream, border: `1px solid rgba(14,59,46,0.10)` }} data-testid="stat-events">
          <Clock className="w-4 h-4" style={{ color: V.sage }} />
          <span className="font-serif text-3xl font-semibold" style={{ color: V.ink }}>{isLoading ? "—" : summary?.todays_events_count ?? 0}</span>
          <span className="text-[11px] leading-tight" style={{ color: V.muted }}>Hoje na agenda</span>
        </div>

        <Link href="/tasks">
          <div className="rounded-3xl p-4 flex flex-col gap-2 cursor-pointer hover:opacity-90 transition-opacity"
            style={{ background: (summary?.tasks_overdue ?? 0) > 0 ? "#B45309" : V.cream, border: `1px solid rgba(14,59,46,0.10)` }}
            data-testid="stat-tasks">
            <ListChecks className="w-4 h-4" style={{ color: (summary?.tasks_overdue ?? 0) > 0 ? "rgba(255,255,255,0.8)" : V.sage }} />
            <span className="font-serif text-3xl font-semibold" style={{ color: (summary?.tasks_overdue ?? 0) > 0 ? "white" : V.ink }}>
              {isLoading ? "—" : (summary?.tasks_due_today ?? 0) + (summary?.tasks_overdue ?? 0)}
            </span>
            <span className="text-[11px] leading-tight" style={{ color: (summary?.tasks_overdue ?? 0) > 0 ? "rgba(255,255,255,0.75)" : V.muted }}>
              Tarefas pendentes
            </span>
          </div>
        </Link>
      </div>

      {/* Active rules pill */}
      {(summary?.active_rules_count ?? 0) > 0 && (
        <Link href="/rules">
          <div className="flex items-center justify-between px-4 py-3 rounded-2xl cursor-pointer hover:opacity-80 transition-opacity"
            style={{ background: "#EAF1E5", color: V.primary }}>
            <div className="flex items-center gap-2.5">
              <Zap className="w-4 h-4" />
              <span className="text-sm font-medium">{summary?.active_rules_count} regras ativas — automatizando sua rotina</span>
            </div>
            <ChevronRight className="w-4 h-4 opacity-60" />
          </div>
        </Link>
      )}

      {/* Pattern nudge — surfaces when AI has detected new rule suggestions */}
      <PatternNudge />

      {/* Creche & Escola — WF-20 waitlists + WF-21 matrícula deadlines + WF-24 backup cascades */}
      <CrecheEscolaSection />

      {/* Reimbursements tracker — only shows when there are pending reimbursements */}
      <ReimbursementsCard />

      {/* Today's events */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: V.muted }}>Hoje</h2>
        {!todayEvents?.length ? (
          <div className="rounded-3xl p-6 text-center text-sm" style={{ background: V.cream, color: V.muted, border: `1px solid rgba(14,59,46,0.08)` }}>
            Nenhum compromisso hoje. Aproveite o dia. 🌿
          </div>
        ) : (
          <div className="space-y-2.5">
            {todayEvents.map((ev) => (
              <div key={ev.id} className="flex items-start gap-4 rounded-3xl p-4"
                style={{ background: V.cream, border: `1px solid rgba(14,59,46,0.08)`, boxShadow: "0 2px 8px rgba(14,59,46,0.05)" }}
                data-testid={`event-card-${ev.id}`}>
                <div className="flex flex-col items-center min-w-[44px] pt-0.5">
                  <span className="text-sm font-semibold" style={{ color: V.ink }}>{formatTime(ev.start_at)}</span>
                  {ev.end_at && <span className="text-[10px]" style={{ color: V.muted }}>{formatTime(ev.end_at)}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-snug" style={{ color: V.ink }}>{ev.title}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <CategoryBadge category={ev.category} />
                    {(ev.members?.length ?? 0) > 0 && (
                      <span className="text-xs" style={{ color: V.muted }}>{ev.members?.join(", ")}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Upcoming tasks */}
      {(upcomingTasks?.length ?? 0) > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: V.muted }}>Próximas tarefas</h2>
            <Link href="/tasks" className="text-xs font-medium" style={{ color: V.primary }}>Ver todas →</Link>
          </div>
          <div className="space-y-2">
            {upcomingTasks?.slice(0, 4).map((task) => (
              <div key={task.id} className="flex items-center gap-3 rounded-2xl px-4 py-3"
                style={{ background: V.cream, border: `1px solid rgba(14,59,46,0.08)` }}
                data-testid={`task-row-${task.id}`}>
                <div className="w-4 h-4 rounded-full border-2 shrink-0" style={{ borderColor: V.sage }} />
                <p className="flex-1 text-sm" style={{ color: V.ink }}>{task.title}</p>
                {task.due_at && (
                  <span className={cn("text-xs font-medium shrink-0", isPast(task.due_at) ? "text-red-600" : "")}
                    style={{ color: isPast(task.due_at) ? undefined : V.muted }}>
                    {formatDate(task.due_at)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Activity feed */}
      {(activityFeed?.length ?? 0) > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: V.muted }}>Atividade recente</h2>
          <div className="rounded-3xl overflow-hidden" style={{ background: V.cream, border: `1px solid rgba(14,59,46,0.08)` }}>
            {activityFeed?.slice(0, 5).map((item, i) => (
              <div key={item.id}
                className="flex items-start gap-3 px-4 py-3"
                style={{ borderTop: i > 0 ? `1px solid rgba(14,59,46,0.07)` : "none" }}
                data-testid={`activity-${item.id}`}>
                <div className="w-1.5 h-1.5 rounded-full mt-2 shrink-0" style={{ background: V.sage }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm leading-snug" style={{ color: V.ink }}>{item.description}</p>
                  <p className="text-xs mt-0.5" style={{ color: V.muted }}>{formatRelativeTime(item.timestamp)}</p>
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
