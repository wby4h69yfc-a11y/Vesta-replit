import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { Users, Home, MessageSquare, CheckCircle, XCircle, Clock, Smartphone, Calendar, TrendingUp, RefreshCw } from "lucide-react";

const V = {
  primary:  "#0E3B2E",
  sage:     "#6F856F",
  ivory:    "#F7F4EA",
  cream:    "#FFFDF6",
  muted:    "#9CA3AF",
  green:    "#16A34A",
  red:      "#DC2626",
  amber:    "#D97706",
};

/* ── Types ────────────────────────────────────────────────────────────────── */
interface AdminStats {
  summary: {
    total_users:         number;
    total_households:    number;
    onboarding_complete: number;
    whatsapp_verified:   number;
    calendar_connected:  number;
    total_inbox_items:   number;
    total_actions:       number;
    actions_approved:    number;
    actions_rejected:    number;
    actions_pending:     number;
  };
  signups_by_day:      Array<{ day: string; cnt: number }>;
  inbox_by_day:        Array<{ day: string; cnt: number }>;
  actions_by_category: Array<{ category: string; cnt: number }>;
  inbox_by_source:     Array<{ source: string; cnt: number }>;
  recent_users:        Array<{
    id:          string;
    email:       string | null;
    firstName:   string | null;
    lastName:    string | null;
    createdAt:   string;
    household_id: number | null;
  }>;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function fmtDay(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function fmtDatetime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function pct(part: number, total: number) {
  if (!total) return "—";
  return `${Math.round((part / total) * 100)}%`;
}

/* ── Stat card ───────────────────────────────────────────────────────────── */
function StatCard({ icon: Icon, label, value, sub, color = V.primary }: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-2xl p-4 flex gap-3 items-start" style={{ background: V.cream, border: `1px solid #E5E1D3` }}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}18` }}>
        <Icon className="h-4.5 w-4.5" style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-xs" style={{ color: V.muted }}>{label}</p>
        <p className="text-2xl font-bold leading-tight" style={{ color: V.primary }}>{value}</p>
        {sub && <p className="text-xs mt-0.5" style={{ color: V.sage }}>{sub}</p>}
      </div>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────────────────── */
export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setRefreshing(true);
    try {
      const r = await fetch("/api/admin/stats", { credentials: "include" });
      if (r.status === 403) { setError("Acesso negado."); return; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setStats(await r.json() as AdminStats);
      setError(null);
    } catch (e) {
      setError("Não foi possível carregar os dados.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { void load(); }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: V.ivory }}>
        <div className="text-center space-y-3">
          <div className="w-10 h-10 rounded-2xl mx-auto flex items-center justify-center" style={{ background: V.primary }}>
            <TrendingUp className="h-5 w-5 text-white" />
          </div>
          <p className="text-sm" style={{ color: V.muted }}>Carregando métricas…</p>
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: V.ivory }}>
        <div className="text-center space-y-2">
          <p className="font-semibold" style={{ color: V.primary }}>{error ?? "Erro desconhecido"}</p>
          <button onClick={load} className="text-sm underline" style={{ color: V.sage }}>Tentar novamente</button>
        </div>
      </div>
    );
  }

  const { summary, signups_by_day, inbox_by_day, actions_by_category, inbox_by_source, recent_users } = stats;

  const signupChartData = signups_by_day.map((r) => ({ day: fmtDay(r.day), cnt: r.cnt }));
  const inboxChartData  = inbox_by_day.map((r)   => ({ day: fmtDay(r.day), cnt: r.cnt }));
  const catChartData    = actions_by_category.map((r) => ({ name: r.category, cnt: r.cnt }));

  return (
    <div className="min-h-screen pb-16" style={{ background: V.ivory }}>
      {/* Header */}
      <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between" style={{ background: V.primary }}>
        <div>
          <p className="text-xs text-white/60 uppercase tracking-wider font-semibold">Vesta</p>
          <h1 className="text-lg font-bold text-white leading-tight">Admin</h1>
        </div>
        <button
          onClick={load}
          disabled={refreshing}
          className="p-2 rounded-xl transition-colors"
          style={{ background: "rgba(255,255,255,0.1)" }}
        >
          <RefreshCw className={`h-4 w-4 text-white ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-5 space-y-6">

        {/* Summary grid */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: V.sage }}>Resumo geral</h2>
          <div className="grid grid-cols-2 gap-3">
            <StatCard icon={Users}         label="Usuários"            value={summary.total_users} />
            <StatCard icon={Home}          label="Lares"               value={summary.total_households} />
            <StatCard icon={CheckCircle}   label="Onboarding completo" value={summary.onboarding_complete}
              sub={`${pct(summary.onboarding_complete, summary.total_users)} dos cadastros`} color={V.green} />
            <StatCard icon={Smartphone}    label="WhatsApp verificado" value={summary.whatsapp_verified}
              sub={`${pct(summary.whatsapp_verified, summary.total_users)} dos usuários`} color="#25D366" />
            <StatCard icon={Calendar}      label="Agenda conectada"    value={summary.calendar_connected}
              sub={`${pct(summary.calendar_connected, summary.total_users)} dos usuários`} color="#4285F4" />
            <StatCard icon={MessageSquare} label="Msgs processadas"    value={summary.total_inbox_items} />
          </div>
        </section>

        {/* Action funnel */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: V.sage }}>Funil de ações</h2>
          <div className="rounded-2xl p-4 space-y-3" style={{ background: V.cream, border: "1px solid #E5E1D3" }}>
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: V.muted }}>Total classificadas</span>
              <span className="font-bold" style={{ color: V.primary }}>{summary.total_actions}</span>
            </div>
            {[
              { label: "Aprovadas", value: summary.actions_approved, color: V.green,   Icon: CheckCircle },
              { label: "Pendentes", value: summary.actions_pending,  color: V.amber,   Icon: Clock },
              { label: "Rejeitadas",value: summary.actions_rejected, color: V.red,     Icon: XCircle },
            ].map(({ label, value, color, Icon }) => (
              <div key={label}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <div className="flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5" style={{ color }} />
                    <span style={{ color: V.primary }}>{label}</span>
                  </div>
                  <span className="font-semibold" style={{ color }}>
                    {value} <span className="font-normal text-xs" style={{ color: V.muted }}>({pct(value, summary.total_actions)})</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full" style={{ background: "#E5E1D3" }}>
                  <div
                    className="h-1.5 rounded-full transition-all"
                    style={{ width: `${summary.total_actions ? (value / summary.total_actions) * 100 : 0}%`, background: color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Sign-ups chart */}
        {signupChartData.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: V.sage }}>Cadastros — últimos 30 dias</h2>
            <div className="rounded-2xl p-4" style={{ background: V.cream, border: "1px solid #E5E1D3" }}>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={signupChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: V.muted }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: V.muted }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: V.cream, border: "1px solid #E5E1D3", borderRadius: 12, fontSize: 12 }}
                    formatter={(v: number) => [v, "cadastros"]}
                  />
                  <Bar dataKey="cnt" radius={[4, 4, 0, 0]} fill={V.primary} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* Inbox chart */}
        {inboxChartData.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: V.sage }}>Mensagens recebidas — últimos 30 dias</h2>
            <div className="rounded-2xl p-4" style={{ background: V.cream, border: "1px solid #E5E1D3" }}>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={inboxChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: V.muted }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: V.muted }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: V.cream, border: "1px solid #E5E1D3", borderRadius: 12, fontSize: 12 }}
                    formatter={(v: number) => [v, "mensagens"]}
                  />
                  <Bar dataKey="cnt" radius={[4, 4, 0, 0]} fill="#25D366" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* Actions by category */}
        {catChartData.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: V.sage }}>Ações por categoria</h2>
            <div className="rounded-2xl p-4" style={{ background: V.cream, border: "1px solid #E5E1D3" }}>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={catChartData} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 10, fill: V.muted }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: V.primary }} axisLine={false} tickLine={false} width={70} />
                  <Tooltip
                    contentStyle={{ background: V.cream, border: "1px solid #E5E1D3", borderRadius: 12, fontSize: 12 }}
                    formatter={(v: number) => [v, "ações"]}
                  />
                  <Bar dataKey="cnt" radius={[0, 4, 4, 0]}>
                    {catChartData.map((_, i) => (
                      <Cell key={i} fill={i % 2 === 0 ? V.primary : V.sage} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* Inbox by source */}
        {inbox_by_source.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: V.sage }}>Fontes de mensagens</h2>
            <div className="rounded-2xl p-4 space-y-2" style={{ background: V.cream, border: "1px solid #E5E1D3" }}>
              {inbox_by_source.map((row) => (
                <div key={row.source} className="flex items-center justify-between text-sm">
                  <span style={{ color: V.primary }}>{row.source}</span>
                  <span className="font-semibold tabular-nums" style={{ color: V.sage }}>{row.cnt}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Recent sign-ups */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: V.sage }}>Últimos cadastros</h2>
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #E5E1D3" }}>
            {recent_users.length === 0 ? (
              <div className="p-6 text-center text-sm" style={{ color: V.muted, background: V.cream }}>
                Nenhum cadastro ainda.
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: "#E5E1D3" }}>
                {recent_users.map((u) => (
                  <div key={u.id} className="flex items-center gap-3 px-4 py-3" style={{ background: V.cream }}>
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-white"
                      style={{ background: V.primary }}
                    >
                      {(u.firstName?.[0] ?? u.email?.[0] ?? "?").toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate" style={{ color: V.primary }}>
                        {[u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || "Sem nome"}
                      </p>
                      <p className="text-xs truncate" style={{ color: V.muted }}>{u.email ?? "—"}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs" style={{ color: V.muted }}>{fmtDatetime(u.createdAt)}</p>
                      {u.household_id && (
                        <p className="text-xs" style={{ color: V.sage }}>Lar #{u.household_id}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <p className="text-center text-xs pb-4" style={{ color: V.muted }}>
          Dados ao vivo • Vesta Admin
        </p>
      </div>
    </div>
  );
}
