/**
 * Hoje — the app's primary surface.
 *
 * The app's job: connect, configure, audit, and escalate.
 * WhatsApp is where Vesta operates day to day.
 *
 * Layout (top → bottom):
 *  1. Greeting + date
 *  2. WhatsApp CTA — the primary call to action
 *  3. Last action strip — one-line audit of most recent WA activity
 *  4. Escalation banner — only shown when items need web review
 *  5. Today's agenda — informational, below the fold
 */
import { useState, useEffect } from "react";
import { ArrowRight, MessageCircle } from "lucide-react";
import { Link } from "wouter";
import {
  useGetDashboardSummary,
  useGetTodayEvents,
  useGetActivityFeed,
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
  wa:        "#25D366",
  waHeader:  "#075E54",
  escalation:"#EAF1E5",
};

/* ── WhatsApp CTA card ─────────────────────────────────────────────────────── */
type WaInfo = { twilio_number?: string | null; twilioConfigured?: boolean };

const QUICK_SENDS = [
  "Reunião da escola quinta 19h",
  "Consulta da Bia semana que vem",
  "Levar lanche quinta",
];

function WhatsAppHero({ name }: { name?: string }) {
  const [waNumber, setWaNumber] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/webhook/whatsapp/info", { credentials: "include" })
      .then((r) => r.json())
      .then((d: WaInfo) => { if (d.twilio_number) setWaNumber(d.twilio_number); })
      .catch(() => {});
  }, []);

  function openWA(prefill?: string) {
    const num = waNumber ?? "14155238886";
    const url = prefill
      ? `https://wa.me/${num}?text=${encodeURIComponent(prefill)}`
      : `https://wa.me/${num}`;
    window.open(url, "_blank");
  }

  return (
    <div className="rounded-3xl overflow-hidden" style={{ border: "1px solid rgba(14,59,46,0.10)" }}>
      <div className="flex items-center gap-3 px-4 py-4" style={{ background: V.waHeader }}>
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "rgba(255,255,255,0.15)" }}
        >
          <MessageCircle className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white leading-none">Encaminhe um recado</p>
          <p className="text-[11px] mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.65)" }}>
            {name ? `Oi, ${name}! ` : ""}A Vesta organiza e avisa quando precisar.
          </p>
        </div>
        <button
          onClick={() => openWA()}
          className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold"
          style={{ background: V.wa, color: "white" }}
        >
          Abrir →
        </button>
      </div>

      <div className="px-4 py-3 flex flex-wrap gap-2" style={{ background: "#ECE5DD" }}>
        {QUICK_SENDS.map((ex) => (
          <button
            key={ex}
            onClick={() => openWA(ex)}
            className="rounded-full border px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
            style={{
              borderColor: "rgba(14,59,46,0.25)",
              color: V.primary,
              background: "rgba(255,255,255,0.70)",
            }}
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Last action strip (audit) ─────────────────────────────────────────────── */
function LastActionStrip() {
  const { data: activityFeed } = useGetActivityFeed();
  const last = activityFeed?.[0];
  if (!last) return null;
  return (
    <div
      className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm"
      style={{ background: V.escalation, color: V.ink }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-0.5" style={{ background: V.sage, display: "inline-block" }} />
      <span className="flex-1 min-w-0 truncate">
        <span className="font-medium">Vesta anotou: </span>{last.description}
      </span>
      <span className="text-xs shrink-0" style={{ color: V.muted }}>
        {formatRelativeTime(last.timestamp)}
      </span>
    </div>
  );
}

/* ── Escalation banner (requires web review) ───────────────────────────────── */
function EscalationBanner({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Link href="/inbox">
      <div
        className="flex items-center justify-between rounded-2xl px-4 py-3 cursor-pointer hover:opacity-90 transition-opacity"
        style={{ background: V.primary, color: "white" }}
      >
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

/* ── Main ──────────────────────────────────────────────────────────────────── */
export default function Hoje() {
  const { data: summary } = useGetDashboardSummary();
  const { data: todayEvents, isLoading: loadingEvents } = useGetTodayEvents();

  const today = new Date();
  const h = today.getHours();
  const greeting = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const pendingInbox = summary?.pending_inbox_count ?? 0;

  return (
    <div className="p-4 space-y-4 animate-fade-in-up">
      {/* ① Greeting */}
      <div>
        <p className="text-xs" style={{ color: V.muted }}>{formatDate(today)}</p>
        <h1 className="text-xl font-bold mt-0.5" style={{ color: V.ink }}>{greeting}</h1>
      </div>

      {/* ② PRIMARY — WhatsApp is where Vesta works */}
      <WhatsAppHero />

      {/* ③ Audit strip — last thing Vesta recorded */}
      <LastActionStrip />

      {/* ④ Escalation — only surfaces when explicit web review is needed */}
      <EscalationBanner count={pendingInbox} />

      {/* ⑤ Today's agenda — informational */}
      <section>
        <h2
          className="text-xs font-semibold uppercase tracking-wide mb-2"
          style={{ color: V.muted }}
        >
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
              <div
                key={ev.id}
                className="flex items-start gap-3 bg-card border border-border rounded-xl p-3"
                data-testid={`event-card-${ev.id}`}
              >
                <div className="flex flex-col items-center min-w-[40px]">
                  <span className="text-sm font-semibold text-foreground">
                    {formatTime(ev.start_at)}
                  </span>
                  {ev.end_at && (
                    <span className="text-[10px] text-muted-foreground">
                      {formatTime(ev.end_at)}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground leading-snug">{ev.title}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <CategoryBadge category={ev.category} />
                    {(ev.members?.length ?? 0) > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {ev.members?.join(", ")}
                      </span>
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
