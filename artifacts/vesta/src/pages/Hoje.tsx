/**
 * Hoje — the app's primary surface.
 *
 * WhatsApp is where Vesta operates day to day.
 * This screen connects, audits, and escalates.
 *
 * Layout (top → bottom):
 *  1. Greeting + date
 *  2. WhatsApp CTA card (with connection status pill)
 *  3. FirstForwardPrompt — only when Vesta has never handled anything
 *  4. RecentWhatsAppActionsHandled — last 3 things Vesta did
 *  5. EscalationBanner — only when items need web review
 *  6. Today's agenda
 */
import { useState, useEffect } from "react";
import { ArrowRight, MessageCircle, CheckCircle2, Clock, Wifi, WifiOff } from "lucide-react";
import { Link } from "wouter";
import {
  useGetDashboardSummary,
  useGetTodayEvents,
  useGetActivityFeed,
  useListPatterns,
} from "@workspace/api-client-react";
import CategoryBadge from "@/components/CategoryBadge";
import { formatTime, formatRelativeTime, formatDate } from "@/lib/utils";

const V = {
  primary:   "#0E3B2E",
  sage:      "#6F856F",
  ivory:     "#F7F4EA",
  cream:     "#FFFDF6",
  ink:       "#12231C",
  muted:     "#5F6B61",
  beige:     "#EEE6D6",
  wa:        "#25D366",
  waHeader:  "#075E54",
};

type WaInfo = {
  twilio_number?: string | null;
  twilioConfigured?: boolean;
  status?: string;
};

/* ── ConnectionStatusPill ──────────────────────────────────────────────────── */
function ConnectionStatusPill({ info }: { info: WaInfo | null }) {
  if (!info) return null;
  if (info.twilioConfigured && info.twilio_number) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
        style={{ background: "rgba(37,211,102,0.15)" }}>
        <Wifi className="h-3 w-3" style={{ color: "#25D366" }} />
        <span className="text-[11px] font-medium" style={{ color: "#25D366" }}>
          Conectado · +{info.twilio_number}
        </span>
      </div>
    );
  }
  return (
    <Link href="/casa">
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full cursor-pointer"
        style={{ background: "rgba(245,158,11,0.15)" }}>
        <WifiOff className="h-3 w-3" style={{ color: "#D97706" }} />
        <span className="text-[11px] font-medium" style={{ color: "#D97706" }}>
          Não configurado · Configurar →
        </span>
      </div>
    </Link>
  );
}

/* ── WhatsApp CTA card ─────────────────────────────────────────────────────── */
const QUICK_SENDS = [
  "Reunião da escola quinta 19h",
  "Consulta da Bia semana que vem",
  "Levar lanche quinta",
];

function WhatsAppHero({ name, waInfo }: { name?: string; waInfo: WaInfo | null }) {
  function openWA(prefill?: string) {
    const num = waInfo?.twilio_number ?? "14155238886";
    const url = prefill
      ? `https://wa.me/${num}?text=${encodeURIComponent(prefill)}`
      : `https://wa.me/${num}`;
    window.open(url, "_blank");
  }

  return (
    <div className="rounded-3xl overflow-hidden" style={{ border: "1px solid rgba(14,59,46,0.10)" }}>
      <div className="flex items-center gap-3 px-4 py-4" style={{ background: V.waHeader }}>
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "rgba(255,255,255,0.15)" }}>
          <MessageCircle className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white leading-none">Encaminhe um recado</p>
          <p className="text-[11px] mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.65)" }}>
            {name ? `Oi, ${name}! ` : ""}A Vesta organiza e avisa quando precisar.
          </p>
        </div>
        <button onClick={() => openWA()}
          className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold"
          style={{ background: V.wa, color: "white" }}>
          Abrir →
        </button>
      </div>

      <div className="px-4 py-3 space-y-2.5" style={{ background: "#ECE5DD" }}>
        <div className="flex flex-wrap gap-2">
          {QUICK_SENDS.map((ex) => (
            <button key={ex} onClick={() => openWA(ex)}
              className="rounded-full border px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
              style={{ borderColor: "rgba(14,59,46,0.25)", color: V.primary, background: "rgba(255,255,255,0.70)" }}>
              {ex}
            </button>
          ))}
        </div>
        <ConnectionStatusPill info={waInfo} />
      </div>
    </div>
  );
}

/* ── FirstForwardPrompt ────────────────────────────────────────────────────── */
function FirstForwardPrompt({ waNumber }: { waNumber: string | null }) {
  function openWA(prefill: string) {
    const num = waNumber ?? "14155238886";
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(prefill)}`, "_blank");
  }

  return (
    <div className="rounded-2xl p-5 space-y-4"
      style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.10)" }}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "#EAF1E5" }}>
          <MessageCircle className="h-5 w-5" style={{ color: V.primary }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: V.ink }}>
            Pronto! Encaminhe seu primeiro recado
          </p>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: V.muted }}>
            A Vesta está no ar. Encaminhe qualquer mensagem da escola, consulta, boleto ou lembrete pelo WhatsApp — ela classifica e organiza automaticamente.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: V.muted }}>
          Experimente agora
        </p>
        {[
          { label: "📅  Evento ou reunião", ex: "Reunião da escola quinta 19h" },
          { label: "🏥  Consulta médica", ex: "Consulta da Bia pediatra na terça 14h" },
          { label: "💰  Conta ou boleto", ex: "Conta de luz vence dia 10 R$280" },
        ].map(({ label, ex }) => (
          <button key={ex} onClick={() => openWA(ex)}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm text-left transition-opacity hover:opacity-80"
            style={{ background: "#EAF1E5", color: V.ink }}>
            <span>{label}</span>
            <ArrowRight className="h-4 w-4 shrink-0" style={{ color: V.sage }} />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── RecentWhatsAppActionsHandled ──────────────────────────────────────────── */
type ActivityItem = {
  id: number;
  description: string;
  category?: string | null;
  action_type?: string | null;
  timestamp: string;
};

function RecentWhatsAppActionsHandled({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return null;

  const ACTION_TYPE_ICON: Record<string, string> = {
    approved:  "✅",
    dismissed: "✖️",
    auto:      "⚡",
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: V.muted }}>
          Últimas ações da Vesta
        </h2>
        <Link href="/inbox">
          <span className="text-xs font-medium" style={{ color: V.primary }}>Ver todas →</span>
        </Link>
      </div>
      <div className="rounded-2xl overflow-hidden" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
        {items.slice(0, 3).map((item, i) => (
          <div key={item.id}
            className="flex items-start gap-3 px-4 py-3"
            style={{ borderTop: i > 0 ? "1px solid rgba(14,59,46,0.06)" : "none" }}>
            <span className="text-sm shrink-0 mt-0.5">
              {ACTION_TYPE_ICON[item.action_type ?? "approved"] ?? "✅"}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm leading-snug line-clamp-1" style={{ color: V.ink }}>
                {item.description}
              </p>
              {item.category && (
                <CategoryBadge category={item.category} className="mt-1" />
              )}
            </div>
            <span className="text-[10px] shrink-0 mt-0.5" style={{ color: V.muted }}>
              {formatRelativeTime(item.timestamp)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── EscalationBanner ──────────────────────────────────────────────────────── */
function EscalationBanner({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Link href="/inbox">
      <div className="flex items-center justify-between rounded-2xl px-4 py-3 cursor-pointer hover:opacity-90 transition-opacity"
        style={{ background: V.primary, color: "white" }}>
        <div>
          <p className="text-sm font-semibold">
            {count === 1 ? "1 recado" : `${count} recados`} aguardando revisão
          </p>
          <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.65)" }}>
            Alguns itens precisam de confirmação no app
          </p>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0 opacity-80" />
      </div>
    </Link>
  );
}

/* ── PatternNudge ──────────────────────────────────────────────────────────── */
const NUDGE_STATUSES = new Set(["suggested", "threshold_met"]);

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

/* ── Main ──────────────────────────────────────────────────────────────────── */
export default function Hoje() {
  const { data: summary } = useGetDashboardSummary();
  const { data: todayEvents, isLoading: loadingEvents } = useGetTodayEvents();
  const { data: activityFeed } = useGetActivityFeed();
  const [waInfo, setWaInfo] = useState<WaInfo | null>(null);

  useEffect(() => {
    fetch("/api/webhook/whatsapp/info", { credentials: "include" })
      .then((r) => r.json())
      .then((d: WaInfo) => setWaInfo(d))
      .catch(() => {});
  }, []);

  const today = new Date();
  const h = today.getHours();
  const greeting = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const pendingInbox = summary?.pending_inbox_count ?? 0;
  const feed = (activityFeed ?? []) as ActivityItem[];
  const isFirstUse = feed.length === 0 && pendingInbox === 0;

  return (
    <div className="p-4 space-y-4 animate-fade-in-up">
      {/* ① Greeting */}
      <div>
        <p className="text-xs" style={{ color: V.muted }}>{formatDate(today)}</p>
        <h1 className="text-xl font-bold mt-0.5" style={{ color: V.ink }}>{greeting}</h1>
      </div>

      {/* ② PRIMARY — WhatsApp is where Vesta works */}
      <WhatsAppHero waInfo={waInfo} />

      {/* ③ First-use prompt — only before Vesta has handled anything */}
      {isFirstUse && <FirstForwardPrompt waNumber={waInfo?.twilio_number ?? null} />}

      {/* ④ Recent WA actions — replaces the single audit strip */}
      {!isFirstUse && <RecentWhatsAppActionsHandled items={feed} />}

      {/* ⑤ Escalation — only surfaces when explicit web review is needed */}
      <EscalationBanner count={pendingInbox} />

      {/* ⑤b Pattern nudge — appears when there are unreviewed pattern suggestions */}
      <PatternNudge />

      {/* ⑥ Today's agenda */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: V.muted }}>
          Agenda de hoje
        </h2>
        {loadingEvents ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />
            ))}
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
                  {ev.end_at && (
                    <span className="text-[10px] text-muted-foreground">{formatTime(ev.end_at)}</span>
                  )}
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
    </div>
  );
}
