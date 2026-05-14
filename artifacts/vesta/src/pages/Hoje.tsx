import { Clock, TrendingUp, CheckSquare, Inbox as InboxIcon, Zap } from "lucide-react";
import { Link } from "wouter";
import {
  useGetDashboardSummary,
  useGetTodayEvents,
  useGetUpcomingTasks,
  useGetActivityFeed,
  useGetCategoryBreakdown,
} from "@workspace/api-client-react";
import CategoryBadge from "@/components/CategoryBadge";
import { formatTime, formatRelativeTime, formatDate, isPast } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const CATEGORY_COLORS: Record<string, string> = {
  escola:    "#3b82f6",
  saude:     "#10b981",
  casa:      "#f59e0b",
  social:    "#f43f5e",
  logistica: "#8b5cf6",
  refeicoes: "#f97316",
  servicos:  "#64748b",
  outros:    "#a8a29e",
};

export default function Hoje() {
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary();
  const { data: todayEvents, isLoading: loadingEvents } = useGetTodayEvents();
  const { data: upcomingTasks } = useGetUpcomingTasks();
  const { data: activityFeed } = useGetActivityFeed();
  const { data: breakdown } = useGetCategoryBreakdown();

  const today = new Date();
  const greeting = today.getHours() < 12 ? "Bom dia" : today.getHours() < 18 ? "Boa tarde" : "Boa noite";

  return (
    <div className="p-4 space-y-5 animate-fade-in-up">
      {/* Header greeting */}
      <div>
        <p className="text-sm text-muted-foreground">{formatDate(today)}</p>
        <h1 className="text-2xl font-bold text-foreground mt-0.5">{greeting}</h1>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2">
        <Link href="/inbox">
          <div
            className={cn(
              "rounded-2xl p-3 flex flex-col gap-1 cursor-pointer hover:opacity-90 transition-opacity",
              (summary?.pending_inbox_count ?? 0) > 0 ? "bg-primary text-primary-foreground" : "bg-card border border-border text-foreground",
            )}
            data-testid="stat-inbox"
          >
            <InboxIcon className="w-4 h-4 opacity-80" />
            <span className="text-2xl font-bold">{loadingSummary ? "—" : summary?.pending_inbox_count ?? 0}</span>
            <span className="text-[11px] opacity-75 leading-tight">Para processar</span>
          </div>
        </Link>

        <div className="rounded-2xl p-3 bg-card border border-border flex flex-col gap-1" data-testid="stat-events">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <span className="text-2xl font-bold">{loadingSummary ? "—" : summary?.todays_events_count ?? 0}</span>
          <span className="text-[11px] text-muted-foreground leading-tight">Hoje na agenda</span>
        </div>

        <Link href="/tarefas">
          <div
            className={cn(
              "rounded-2xl p-3 flex flex-col gap-1 cursor-pointer hover:opacity-90 transition-opacity",
              (summary?.tasks_overdue ?? 0) > 0 ? "bg-amber-500 text-white" : "bg-card border border-border text-foreground",
            )}
            data-testid="stat-tasks"
          >
            <CheckSquare className="w-4 h-4 opacity-80" />
            <span className="text-2xl font-bold">
              {loadingSummary ? "—" : (summary?.tasks_due_today ?? 0) + (summary?.tasks_overdue ?? 0)}
            </span>
            <span className="text-[11px] opacity-75 leading-tight">Tarefas pendentes</span>
          </div>
        </Link>
      </div>

      {/* Active rules indicator */}
      {(summary?.active_rules_count ?? 0) > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-secondary rounded-xl text-sm text-secondary-foreground">
          <Zap className="w-4 h-4 text-primary" />
          <span>{summary?.active_rules_count} regras ativas — automatizando sua rotina</span>
        </div>
      )}

      {/* Today's events */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Hoje</h2>
        {loadingEvents ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : !todayEvents?.length ? (
          <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
            Nenhum compromisso hoje. Aproveite o dia.
          </div>
        ) : (
          <div className="space-y-2">
            {todayEvents.map((ev) => (
              <div
                key={ev.id}
                className="flex items-start gap-3 bg-card border border-border rounded-xl p-3"
                data-testid={`event-card-${ev.id}`}
              >
                <div className="flex flex-col items-center min-w-[40px]">
                  <span className="text-sm font-semibold text-foreground">{formatTime(ev.start_at)}</span>
                  {ev.end_at && (
                    <span className="text-[10px] text-muted-foreground">{formatTime(ev.end_at)}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground leading-snug">{ev.title}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <CategoryBadge category={ev.category} />
                    {ev.members?.length > 0 && (
                      <span className="text-xs text-muted-foreground">{ev.members.join(", ")}</span>
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
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Próximas tarefas</h2>
          <div className="space-y-1.5">
            {upcomingTasks?.slice(0, 4).map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-3 bg-card border border-border rounded-xl px-3 py-2.5"
                data-testid={`task-row-${task.id}`}
              >
                <div className="w-4 h-4 rounded-full border-2 border-muted-foreground shrink-0" />
                <p className="flex-1 text-sm text-foreground">{task.title}</p>
                {task.due_at && (
                  <span className={cn("text-xs", isPast(task.due_at) ? "text-destructive font-medium" : "text-muted-foreground")}>
                    {formatDate(task.due_at)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Category breakdown */}
      {(breakdown?.length ?? 0) > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Este mês</h2>
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center gap-4">
              <div className="w-28 h-28 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={breakdown}
                      cx="50%"
                      cy="50%"
                      innerRadius={26}
                      outerRadius={48}
                      dataKey="count"
                      paddingAngle={2}
                    >
                      {breakdown?.map((entry) => (
                        <Cell key={entry.category} fill={CATEGORY_COLORS[entry.category] ?? "#a8a29e"} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number, _: string, props: { payload?: { label?: string } }) => [v, props.payload?.label ?? ""]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1.5">
                {breakdown?.map((item) => (
                  <div key={item.category} className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: CATEGORY_COLORS[item.category] ?? "#a8a29e" }}
                    />
                    <span className="text-xs text-foreground flex-1">{item.label}</span>
                    <span className="text-xs font-semibold text-muted-foreground">{item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Activity feed */}
      {(activityFeed?.length ?? 0) > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Atividade recente</h2>
          <div className="space-y-1">
            {activityFeed?.slice(0, 5).map((item) => (
              <div key={item.id} className="flex items-start gap-3 py-2" data-testid={`activity-${item.id}`}>
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground leading-snug">{item.description}</p>
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
