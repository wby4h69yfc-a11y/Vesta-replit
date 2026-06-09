import { useState, useEffect, useRef } from "react";
import {
  Users, ShieldCheck, ChevronRight, Plus, Trash2, Pencil,
  Home, Baby, Heart, Lock, Bell, Key, HelpCircle, LogOut,
  Sparkles, CheckCircle, Clock, AlertCircle, X,
  CalendarDays, Mail, RefreshCw, Unlink, ExternalLink,
  MessageCircle, Copy, Check, Zap, TrendingUp, Pause, Play,
  CheckCircle2, History, Download, Shield, Phone,
  Wifi, WifiOff,
} from "lucide-react";
import {
  useGetHousehold,
  useUpdateHousehold,
  useListMembers, useCreateMember, useUpdateMember, useDeleteMember,
  useCreateHouseholdInvite,
  useGetHouseholdPlanStatus,
  useListRules, useCreateRule, useToggleRule, useDeleteRule,
  useListPatterns, useTriggerPatternDetection,
  useListContacts, useCreateContact, useUpdateContact, useRequestContactConsent,
  useGetContactsConsentDue,
  useListAuditLog,
  useDeleteAccount,
  exportPrivacyData,
  getPrivacyExportSummary,
  type PrivacyExportSummary,
  getListMembersQueryKey,
  getListRulesQueryKey, getListPatternsQueryKey, getListContactsQueryKey,
  getGetContactsConsentDueQueryKey,
  type Member,
  type PatternObservation,
} from "@workspace/api-client-react";
import UpgradePrompt from "@/components/UpgradePrompt";
import PatternSuggestions from "@/components/PatternSuggestions";
import { Link } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import CategoryBadge from "@/components/CategoryBadge";
import { CATEGORIES } from "@/lib/categories";
import { cn, formatRelativeTime, isUpgradeError } from "@/lib/utils";

import { V } from "@/lib/brand";

type Tab = "inicio" | "familia" | "regras" | "privacidade";

/* ── TabBar ──────────────────────────────────────────────────────────────── */
function TabBar({ active, onChange, patternCount = 0 }: { active: Tab; onChange: (t: Tab) => void; patternCount?: number }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "inicio",      label: "Início" },
    { id: "familia",     label: "Família" },
    { id: "regras",      label: "Regras" },
    { id: "privacidade", label: "Privacidade" },
  ];
  return (
    <div className="flex" style={{ borderBottom: "1px solid rgba(14,59,46,0.08)" }}>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className="flex-1 py-3 text-xs font-semibold transition-colors relative"
          style={{
            color: active === t.id ? V.primary : V.muted,
            borderBottom: active === t.id ? `2px solid ${V.primary}` : "2px solid transparent",
          }}>
          <span className="relative inline-flex items-center gap-1">
            {t.label}
            {t.id === "regras" && patternCount > 0 && (
              <span className="min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center"
                style={{ background: "#EF4444", color: "white" }}>
                {patternCount > 9 ? "9+" : patternCount}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

/* ── WhatsAppConnectionScreen ─────────────────────────────────────────────── */
type WebhookInfo = {
  webhook_url: string | null;
  method: string;
  status: string;
  twilioConfigured: boolean;
  twilio_number: string | null;
};

function WhatsAppConnectionScreen() {
  const [info, setInfo] = useState<WebhookInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/webhook/whatsapp/info", { credentials: "include" })
      .then((r) => r.json())
      .then((d: WebhookInfo) => setInfo(d))
      .catch(() => null);
  }, []);

  async function copyUrl() {
    const text = info?.webhook_url;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!info) {
    return <div className="h-40 rounded-3xl animate-pulse" style={{ background: V.beige }} />;
  }

  if (info.twilioConfigured) {
    return (
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: V.muted }}>WhatsApp</h2>
        <div className="rounded-3xl overflow-hidden" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
          {/* Status header */}
          <div className="flex items-center gap-3 px-5 py-4" style={{ background: "#F0FDF4", borderBottom: "1px solid #BBF7D0" }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#DCFCE7" }}>
              <Wifi className="h-4 w-4" style={{ color: "#059669" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: "#065F46" }}>WhatsApp ativo</p>
              {info.twilio_number && (
                <p className="text-xs" style={{ color: "#047857" }}>+{info.twilio_number}</p>
              )}
            </div>
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ background: "#DCFCE7", color: "#065F46" }}>
              Conectado
            </span>
          </div>

          {/* Usage tips */}
          <div className="px-5 py-4 space-y-3" style={{ borderBottom: "1px solid rgba(14,59,46,0.06)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: V.muted }}>Como usar</p>
            {[
              "Encaminhe qualquer mensagem — escola, médico, boleto, lembrete",
              "Vesta classifica e cria a ação automaticamente",
              "Você aprova com \"sim\" no WhatsApp ou aqui no app",
            ].map((tip, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "#059669" }} />
                <p className="text-sm leading-snug" style={{ color: V.ink }}>{tip}</p>
              </div>
            ))}
          </div>

          {/* Webhook URL */}
          {info.webhook_url && (
            <div className="px-5 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: V.muted }}>
                URL do webhook (Twilio)
              </p>
              <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: V.beige }}>
                <code className="flex-1 text-[10px] break-all" style={{ color: V.ink }}>
                  {info.webhook_url}
                </code>
                <button onClick={() => void copyUrl()}
                  className="shrink-0 p-1.5 rounded-lg transition-colors"
                  style={{ background: copied ? "#D1FAE5" : "rgba(14,59,46,0.08)" }}
                  title="Copiar URL">
                  {copied
                    ? <Check className="h-3.5 w-3.5" style={{ color: "#065F46" }} />
                    : <Copy className="h-3.5 w-3.5" style={{ color: V.primary }} />}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }

  /* Not configured */
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: V.muted }}>WhatsApp</h2>
      <div className="rounded-3xl overflow-hidden" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
        {/* Status header */}
        <div className="flex items-center gap-3 px-5 py-4" style={{ background: "#FEF3C7", borderBottom: "1px solid #FDE68A" }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#FEF9C3" }}>
            <WifiOff className="h-4 w-4" style={{ color: "#D97706" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: "#92400E" }}>WhatsApp não configurado</p>
            <p className="text-xs" style={{ color: "#B45309" }}>Configure o Twilio para começar</p>
          </div>
        </div>

        {/* Setup steps */}
        <div className="px-5 py-4 space-y-4" style={{ borderBottom: "1px solid rgba(14,59,46,0.06)" }}>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: V.muted }}>Configurar em 3 passos</p>
          {[
            { n: "1", text: "Acesse console.twilio.com e crie uma conta gratuita" },
            { n: "2", text: "Vá em Messaging → Try it out → Send a WhatsApp Message → Sandbox" },
            { n: "3", text: "No campo \"When a Message Comes In\", cole o URL abaixo" },
          ].map((step) => (
            <div key={step.n} className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-white"
                style={{ background: V.primary }}>
                {step.n}
              </div>
              <p className="text-sm leading-snug pt-0.5" style={{ color: V.ink }}>{step.text}</p>
            </div>
          ))}
        </div>

        {/* Webhook URL */}
        {info.webhook_url && (
          <div className="px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: V.muted }}>
              URL do webhook — cole no Twilio
            </p>
            <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: V.beige }}>
              <code className="flex-1 text-[10px] break-all" style={{ color: V.ink }}>
                {info.webhook_url}
              </code>
              <button onClick={() => void copyUrl()}
                className="shrink-0 p-1.5 rounded-lg transition-colors"
                style={{ background: copied ? "#D1FAE5" : "rgba(14,59,46,0.08)" }}
                title="Copiar URL">
                {copied
                  ? <Check className="h-3.5 w-3.5" style={{ color: "#065F46" }} />
                  : <Copy className="h-3.5 w-3.5" style={{ color: V.primary }} />}
              </button>
            </div>
            <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 mt-3 text-xs font-medium"
              style={{ color: V.primary }}>
              <ExternalLink className="h-3.5 w-3.5" />
              Abrir Twilio Console
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Google integrations ─────────────────────────────────────────────────── */
function GoogleIntegrationsSection() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState<"calendar" | "gmail" | null>(null);
  const [toast2, setToast2] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleParam = params.get("google");
    if (googleParam === "connected") {
      setToast2("Google conectado com sucesso!");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (googleParam === "denied") {
      setToast2("Conexão cancelada.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    fetch("/api/google/status", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { connected: boolean }) => setConnected(d.connected))
      .catch(() => setConnected(false));
  }, []);

  useEffect(() => {
    if (!toast2) return;
    const t = setTimeout(() => setToast2(null), 3500);
    return () => clearTimeout(t);
  }, [toast2]);

  async function sync(type: "calendar" | "gmail") {
    setSyncing(type);
    try {
      const r = await fetch(`/api/google/${type === "calendar" ? "calendar" : "gmail"}/sync`, {
        method: "POST", credentials: "include",
      });
      const d = await r.json() as { synced?: number; imported?: number; error?: string };
      if (!r.ok) throw new Error(d.error ?? "Erro");
      const count = d.synced ?? d.imported ?? 0;
      setToast2(type === "calendar" ? `${count} evento(s) sincronizado(s)!` : `${count} e-mail(s) importado(s)!`);
    } catch (err) {
      setToast2(err instanceof Error ? err.message : "Erro ao sincronizar");
    } finally {
      setSyncing(null);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      await fetch("/api/google/disconnect", { method: "DELETE", credentials: "include" });
      setConnected(false);
      setToast2("Google desconectado.");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: V.muted }}>
        Integrações Google
      </h2>
      {toast2 && (
        <div className="mb-3 px-4 py-3 rounded-2xl text-sm font-medium flex items-center gap-2"
          style={{ background: "#D1FAE5", color: "#065F46" }}>
          <CheckCircle className="h-4 w-4 shrink-0" />{toast2}
        </div>
      )}
      <div className="rounded-3xl overflow-hidden" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
        <div className="flex items-center gap-4 px-5 py-4">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: connected ? "#D1FAE5" : V.beige }}>
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.47 2.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium" style={{ color: V.ink }}>Google</p>
            <p className="text-xs" style={{ color: V.muted }}>
              {connected === null ? "Verificando…" : connected ? "Agenda e Gmail conectados" : "Não conectado"}
            </p>
          </div>
          {connected === false && (
            <a href="/api/google/connect"
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold text-white shrink-0"
              style={{ background: V.primary }}>
              <ExternalLink className="h-3.5 w-3.5" /> Conectar
            </a>
          )}
          {connected && (
            <button onClick={() => void disconnect()} disabled={disconnecting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium shrink-0 disabled:opacity-50"
              style={{ background: "#FEE2E2", color: "#DC2626" }}>
              <Unlink className="h-3.5 w-3.5" />{disconnecting ? "…" : "Desconectar"}
            </button>
          )}
        </div>
        {connected && (
          <>
            {(["calendar", "gmail"] as const).map((type, i) => (
              <div key={type} className="flex items-center gap-4 px-5 py-4"
                style={{ borderTop: "1px solid rgba(14,59,46,0.06)" }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#EAF1E5" }}>
                  {type === "calendar"
                    ? <CalendarDays className="h-4 w-4" style={{ color: V.primary }} />
                    : <Mail className="h-4 w-4" style={{ color: V.primary }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: V.ink }}>{type === "calendar" ? "Google Agenda" : "Gmail"}</p>
                  <p className="text-xs" style={{ color: V.muted }}>{type === "calendar" ? "Importar próximos 30 dias" : "Importar não lidos para a caixa"}</p>
                </div>
                <button onClick={() => void sync(type)} disabled={syncing !== null}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold shrink-0 disabled:opacity-50"
                  style={{ background: "#EAF1E5", color: V.primary }}>
                  <RefreshCw className={cn("h-3.5 w-3.5", syncing === type && "animate-spin")} />
                  {syncing === type ? (type === "calendar" ? "Sincronizando…" : "Importando…") : (type === "calendar" ? "Sincronizar" : "Importar")}
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}

/* ── BriefingHourSelector ─────────────────────────────────────────────────── */
const TZ_LABELS: Record<string, string> = {
  "America/Sao_Paulo":   "Brasília",
  "America/Manaus":      "Manaus",
  "America/Belem":       "Belém",
  "America/Fortaleza":   "Fortaleza",
  "America/Recife":      "Recife",
  "America/Maceio":      "Maceió",
  "America/Bahia":       "Salvador",
  "America/Cuiaba":      "Cuiabá",
  "America/Porto_Velho": "Porto Velho",
  "America/Boa_Vista":   "Boa Vista",
  "America/Rio_Branco":  "Rio Branco",
  "America/Noronha":     "Fernando de Noronha",
};

/** Convert a UTC hour (0-23) to the household-local hour using Intl.DateTimeFormat. */
function utcHourToLocal(utcHour: number, tz: string): number {
  const ref = new Date();
  ref.setUTCHours(utcHour, 0, 0, 0);
  const formatted = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).format(ref);
  const h = parseInt(formatted, 10);
  return isNaN(h) ? utcHour : h % 24;
}

/** Convert a household-local hour back to the UTC-equivalent hour to store in DB. */
function localHourToUTC(localHour: number, tz: string): number {
  for (let u = 0; u < 24; u++) {
    if (utcHourToLocal(u, tz) === localHour) return u;
  }
  return localHour; // fallback for sub-hour offsets
}

const TZ_OPTIONS = Object.entries(TZ_LABELS).map(([value, label]) => ({ value, label }));

function BriefingHourSelector() {
  const { data: household } = useGetHousehold();
  const updateHousehold = useUpdateHousehold();
  const { toast } = useToast();

  const savedTz = household?.timezone ?? "America/Sao_Paulo";
  const tzLabel = TZ_LABELS[savedTz] ?? "horário local";

  // briefing_hour is stored as a household-local hour (e.g., 7 = 07h00 local).
  const savedLocal = household?.briefing_hour ?? 7;
  const savedQHStart = (household as Record<string, unknown> | undefined)?.quiet_hour_start as number | undefined ?? 21;
  const savedQHEnd = (household as Record<string, unknown> | undefined)?.quiet_hour_end as number | undefined ?? 7;

  const [selectedLocal, setSelectedLocal] = useState<number>(savedLocal);
  const [selectedTz, setSelectedTz] = useState<string>(savedTz);
  const [selectedQHStart, setSelectedQHStart] = useState<number>(savedQHStart);
  const [selectedQHEnd, setSelectedQHEnd] = useState<number>(savedQHEnd);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSelectedLocal(household?.briefing_hour ?? 7);
    setSelectedTz(savedTz);
    setSelectedQHStart((household as Record<string, unknown> | undefined)?.quiet_hour_start as number | undefined ?? 21);
    setSelectedQHEnd((household as Record<string, unknown> | undefined)?.quiet_hour_end as number | undefined ?? 7);
  }, [household?.briefing_hour, savedTz, savedQHStart, savedQHEnd]);

  function formatHour(h: number) {
    return `${h}h`;
  }

  async function handleSave() {
    try {
      await updateHousehold.mutateAsync({
        data: {
          briefing_hour: selectedLocal,
          timezone: selectedTz,
          quiet_hour_start: selectedQHStart,
          quiet_hour_end: selectedQHEnd,
        },
      });
      setSaved(true);
      const label = TZ_LABELS[selectedTz] ?? selectedTz;
      toast({ title: "Configurações salvas", description: `Resumo diário às ${formatHour(selectedLocal)} (horário de ${label})` });
      setTimeout(() => setSaved(false), 2500);
    } catch {
      toast({ title: "Erro ao salvar", description: "Tente novamente.", variant: "destructive" });
    }
  }

  async function handleToggleDigest(enabled: boolean) {
    try {
      await updateHousehold.mutateAsync({ data: { digest_enabled: enabled } });
      toast({
        title: enabled ? "Resumo diário ativado" : "Resumo diário desativado",
        description: enabled
          ? "Você voltará a receber o resumo diário via WhatsApp."
          : "Nenhum resumo diário será enviado até reativar.",
      });
    } catch {
      toast({ title: "Erro ao salvar", description: "Tente novamente.", variant: "destructive" });
    }
  }

  async function handleUnstop() {
    try {
      await updateHousehold.mutateAsync({ data: { digest_stopped: false, digest_enabled: true } });
      toast({ title: "Resumo reativado", description: "Você voltará a receber os resumos diários." });
    } catch {
      toast({ title: "Erro ao salvar", description: "Tente novamente.", variant: "destructive" });
    }
  }

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const isDirty =
    selectedLocal !== savedLocal ||
    selectedTz !== savedTz ||
    selectedQHStart !== savedQHStart ||
    selectedQHEnd !== savedQHEnd;

  const digestEnabled = household?.digest_enabled ?? true;
  const digestStopped = (household as Record<string, unknown> | undefined)?.digest_stopped as boolean | undefined ?? false;
  const digestPausedUntil = (household as Record<string, unknown> | undefined)?.digest_paused_until as string | null | undefined;
  const isPaused = digestPausedUntil ? new Date(digestPausedUntil) > new Date() : false;

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: V.muted }}>
        Resumo diário
      </h2>
      <div className="rounded-3xl overflow-hidden" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
        <div className="px-5 py-4 space-y-4">
          {/* Header with enable toggle */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#EAF1E5" }}>
              <Bell className="h-4 w-4" style={{ color: V.primary }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium" style={{ color: V.ink }}>Horário do resumo</p>
              <p className="text-xs" style={{ color: V.muted }}>
                Briefing diário às{" "}
                <span className="font-semibold" style={{ color: V.primary }}>
                  {formatHour(savedLocal)}
                </span>
                {" "}
                <span style={{ color: V.muted }}>(horário de {tzLabel})</span>
              </p>
              <p className="text-xs mt-0.5" style={{ color: V.muted }}>
                {household?.last_briefing_sent_at
                  ? <>Último resumo enviado: <span className="font-medium">{formatRelativeTime(household.last_briefing_sent_at)}</span></>
                  : "Nenhum resumo enviado ainda"}
              </p>
            </div>
            {/* Enable/disable toggle */}
            <button
              onClick={() => void handleToggleDigest(!digestEnabled)}
              disabled={updateHousehold.isPending}
              className="shrink-0 w-11 h-6 rounded-full transition-colors relative disabled:opacity-50"
              style={{ background: digestEnabled ? V.primary : "rgba(14,59,46,0.15)" }}
              title={digestEnabled ? "Desativar resumo diário" : "Ativar resumo diário"}
            >
              <span
                className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform"
                style={{ left: digestEnabled ? "calc(100% - 22px)" : "2px" }}
              />
            </button>
          </div>

          {/* Paused / Stopped status banners */}
          {digestStopped && (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl"
              style={{ background: "#FEF2F2", border: "1px solid #FECACA" }}>
              <AlertCircle className="h-4 w-4 shrink-0" style={{ color: "#DC2626" }} />
              <p className="text-xs flex-1" style={{ color: "#991B1B" }}>
                Resumos parados permanentemente (você enviou PARAR no WhatsApp).
              </p>
              <button
                onClick={() => void handleUnstop()}
                className="text-xs font-semibold shrink-0 underline"
                style={{ color: "#DC2626" }}
              >
                Reativar
              </button>
            </div>
          )}

          {!digestStopped && isPaused && (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl"
              style={{ background: "#FEF9C3", border: "1px solid #FDE68A" }}>
              <Pause className="h-4 w-4 shrink-0" style={{ color: "#D97706" }} />
              <p className="text-xs" style={{ color: "#92400E" }}>
                Pausado por 24h (PAUSAR no WhatsApp). Retoma automaticamente em{" "}
                {new Date(digestPausedUntil!).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.
              </p>
            </div>
          )}

          {/* WA commands hint */}
          <div className="px-3 py-2.5 rounded-xl text-xs space-y-1"
            style={{ background: V.beige, color: V.muted }}>
            <p className="font-medium" style={{ color: V.ink }}>Comandos no WhatsApp:</p>
            <p><span className="font-mono font-semibold">PAUSAR</span> — pausa por 24h</p>
            <p><span className="font-mono font-semibold">PARAR</span> — para indefinidamente</p>
            <p><span className="font-mono font-semibold">RETOMAR</span> — reativa os resumos</p>
          </div>

          {/* Timezone selector */}
          {digestEnabled && !digestStopped && (
            <>
              <div>
                <p className="text-xs font-medium mb-1.5" style={{ color: V.muted }}>Fuso horário</p>
                <select
                  value={selectedTz}
                  onChange={(e) => setSelectedTz(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm font-medium border-0 outline-none appearance-none"
                  style={{ background: V.beige, color: V.ink, cursor: "pointer" }}
                >
                  {TZ_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label} ({value})
                    </option>
                  ))}
                </select>
              </div>

              {/* Hour selector */}
              <div>
                <p className="text-xs font-medium mb-1.5" style={{ color: V.muted }}>Horário do resumo</p>
                <select
                  value={selectedLocal}
                  onChange={(e) => setSelectedLocal(Number(e.target.value))}
                  className="w-full px-4 py-2.5 rounded-xl text-sm font-medium border-0 outline-none appearance-none"
                  style={{ background: V.beige, color: V.ink, cursor: "pointer" }}
                >
                  {hours.map((h) => (
                    <option key={h} value={h}>
                      {formatHour(h)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Quiet hours */}
              <div>
                <p className="text-xs font-medium mb-1.5" style={{ color: V.muted }}>Horário silencioso</p>
                <p className="text-xs mb-2" style={{ color: V.muted }}>
                  Mensagens agendadas neste período serão enviadas após o fim da janela.
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <p className="text-xs mb-1" style={{ color: V.muted }}>Início</p>
                    <select
                      value={selectedQHStart}
                      onChange={(e) => setSelectedQHStart(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl text-sm font-medium border-0 outline-none appearance-none"
                      style={{ background: V.beige, color: V.ink, cursor: "pointer" }}
                    >
                      {hours.map((h) => (
                        <option key={h} value={h}>{formatHour(h)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs mb-1" style={{ color: V.muted }}>Fim</p>
                    <select
                      value={selectedQHEnd}
                      onChange={(e) => setSelectedQHEnd(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl text-sm font-medium border-0 outline-none appearance-none"
                      style={{ background: V.beige, color: V.ink, cursor: "pointer" }}
                    >
                      {hours.map((h) => (
                        <option key={h} value={h}>{formatHour(h)}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Save button */}
              <button
                onClick={() => void handleSave()}
                disabled={updateHousehold.isPending || !isDirty}
                className="w-full px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
                style={{ background: saved ? "#059669" : V.primary }}
              >
                {updateHousehold.isPending ? "…" : saved ? "Salvo ✓" : "Salvar"}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── Início tab ──────────────────────────────────────────────────────────── */
function InicioTab() {
  const { data: household } = useGetHousehold();
  const plan = household?.plan ?? "free";
  const isPremium = plan === "premium";

  const features = [
    { label: "Categorias ativas",         free: "3 de 7",     premium: "Todas 7" },
    { label: "Regras inteligentes",        free: "3 regras",   premium: "Ilimitado" },
    { label: "Histórico",                  free: "30 dias",    premium: "Completo + busca" },
    { label: "Resumo semanal (WhatsApp)", free: "—",          premium: "Dom 20h" },
    { label: "Parceiro com edição",        free: "Só leitura", premium: "Leitura + edição" },
    { label: "Imagens (papelzinho + OCR)", free: "—",          premium: "✓ com OCR" },
  ];

  return (
    <div className="space-y-6 py-6">
      {(household?.whatsapp_alert) && (
        <Link href="/casa">
          <div
            data-testid="wa-delivery-banner"
            className="flex items-start gap-3 rounded-2xl px-4 py-3.5"
            style={{ background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.25)" }}
          >
            <WifiOff className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "#DC2626" }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: "#991B1B" }}>
                Não conseguimos enviar mensagens para o seu WhatsApp
              </p>
              <p className="text-xs mt-0.5" style={{ color: "#B91C1C" }}>
                Verifique o número cadastrado em Casa → WhatsApp
              </p>
            </div>
          </div>
        </Link>
      )}
      <WhatsAppConnectionScreen />

      {household && (
        <div className="p-5 rounded-3xl flex items-center gap-4"
          style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-xl"
            style={{ background: V.primary }}>
            {household.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold" style={{ color: V.ink }}>{household.name}</p>
            {household.location && <p className="text-xs mt-0.5" style={{ color: V.muted }}>{household.location}</p>}
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full mt-1.5 inline-block"
              style={{ background: isPremium ? "#FEF3C7" : "#EAF1E5", color: isPremium ? "#92400E" : V.primary }}>
              {isPremium ? "Premium" : "Gratuito"}
            </span>
          </div>
        </div>
      )}

      {!isPremium && (
        <div className="p-5 rounded-3xl" style={{ background: "linear-gradient(135deg, #0E3B2E 0%, #1A5C45 100%)" }}>
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-white mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-white mb-0.5">Upgrade para Premium</p>
              <p className="text-xs text-white/70 mb-3">R$24,90/mês · ou R$199/ano (economize 34%)</p>
              <button className="px-5 py-2 rounded-full text-xs font-bold text-white bg-white/20 hover:bg-white/30 transition-colors">
                Ver benefícios →
              </button>
            </div>
          </div>
        </div>
      )}

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: V.muted }}>Seu plano</h2>
        <div className="rounded-3xl overflow-hidden" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
          {features.map((f, i) => (
            <div key={f.label} className="flex items-center gap-3 px-5 py-3.5"
              style={{ borderTop: i > 0 ? "1px solid rgba(14,59,46,0.06)" : "none" }}>
              {isPremium
                ? <CheckCircle className="h-4 w-4 shrink-0" style={{ color: V.primary }} />
                : <Lock className="h-4 w-4 shrink-0" style={{ color: V.muted }} />}
              <p className="flex-1 text-sm" style={{ color: V.ink }}>{f.label}</p>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{ background: isPremium ? "#EAF1E5" : V.beige, color: isPremium ? V.primary : V.muted }}>
                {isPremium ? f.premium : f.free}
              </span>
            </div>
          ))}
        </div>
      </section>

      <BriefingHourSelector />

      <GoogleIntegrationsSection />

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: V.muted }}>Conta</h2>
        <div className="rounded-3xl overflow-hidden" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
          {[
            { icon: Bell,       label: "Notificações", desc: "WhatsApp e push" },
            { icon: Key,        label: "Segurança",    desc: "Senha e acesso" },
            { icon: HelpCircle, label: "Ajuda",        desc: "FAQ e suporte" },
          ].map((item, i) => (
            <button key={item.label}
              className="w-full flex items-center gap-4 px-5 py-4 text-left hover:opacity-80 transition-opacity"
              style={{ borderTop: i > 0 ? "1px solid rgba(14,59,46,0.06)" : "none" }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "#EAF1E5" }}>
                <item.icon className="h-4 w-4" style={{ color: V.primary }} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium" style={{ color: V.ink }}>{item.label}</p>
                <p className="text-xs" style={{ color: V.muted }}>{item.desc}</p>
              </div>
              <ChevronRight className="h-4 w-4" style={{ color: V.sage }} />
            </button>
          ))}
        </div>
      </section>

      <button onClick={() => { window.location.href = "/api/logout"; }}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-medium"
        style={{ background: "#FEE2E2", color: "#DC2626" }}>
        <LogOut className="h-4 w-4" /> Sair da conta
      </button>
    </div>
  );
}

/* ── Família tab ─────────────────────────────────────────────────────────── */
/* ── MemberRow ────────────────────────────────────────────────────────────── */
const MEMBER_COLOURS = ["#0E3B2E", "#2563EB", "#D97706", "#7C3AED", "#DB2777", "#0891B2", "#059669", "#DC2626"];

function MemberRow({
  member, isFirst, isSelf, confirmDeleteId, setConfirmDeleteId, onEdit, onDelete,
}: {
  member: Member; isFirst: boolean; isSelf: boolean;
  confirmDeleteId: number | null; setConfirmDeleteId: (id: number | null) => void;
  onEdit: () => void; onDelete: () => void;
}) {
  const initial = member.name.charAt(0).toUpperCase();
  const bg = member.colour ?? V.primary;
  const isConfirming = confirmDeleteId === member.id;
  const subtitle = member.school
    ? member.school + (member.grade ? ` · ${member.grade}` : "")
    : member.role === "admin" ? "Administrador" : "Membro";

  return (
    <div className="px-5 py-4" style={{ borderTop: isFirst ? "none" : "1px solid rgba(14,59,46,0.06)" }}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0"
          style={{ background: bg }}>{initial}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: V.ink }}>{member.name}</p>
          <p className="text-xs truncate" style={{ color: V.muted }}>{subtitle}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:opacity-80"
            style={{ background: V.beige }}>
            <Pencil className="h-3.5 w-3.5" style={{ color: V.muted }} />
          </button>
          {!isSelf && (
            <button onClick={() => setConfirmDeleteId(isConfirming ? null : member.id)}
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:opacity-80"
              style={{ background: isConfirming ? "#FEE2E2" : V.beige }}>
              <Trash2 className="h-3.5 w-3.5" style={{ color: isConfirming ? "#DC2626" : V.muted }} />
            </button>
          )}
        </div>
      </div>
      {isConfirming && (
        <div className="mt-3 flex items-center gap-2 pl-13">
          <p className="text-xs flex-1" style={{ color: "#DC2626" }}>Remover {member.name}?</p>
          <button onClick={onDelete}
            className="px-3 py-1.5 rounded-full text-xs font-semibold text-white"
            style={{ background: "#DC2626" }}>Sim</button>
          <button onClick={() => setConfirmDeleteId(null)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold"
            style={{ background: V.beige, color: V.ink }}>Não</button>
        </div>
      )}
    </div>
  );
}

/* ── MemberForm ───────────────────────────────────────────────────────────── */
function MemberForm({
  mode, initialValues, onSave, onCancel, isSaving,
}: {
  mode: "add" | "edit";
  initialValues: { name: string; relationship_type: "adult" | "child"; phone: string; school: string; grade: string; medical_plan: string; colour: string };
  onSave: (v: typeof initialValues) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState(initialValues);
  const isChild = form.relationship_type === "child";
  const set = (patch: Partial<typeof initialValues>) => setForm(f => ({ ...f, ...patch }));

  return (
    <div className="p-5 rounded-3xl space-y-3" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.1)" }}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold" style={{ color: V.ink }}>
          {mode === "add" ? (isChild ? "Adicionar criança" : "Adicionar adulto") : "Editar membro"}
        </p>
        <button onClick={onCancel}><X className="h-4 w-4" style={{ color: V.muted }} /></button>
      </div>

      {mode === "add" && (
        <div className="flex gap-2">
          {(["adult", "child"] as const).map(r => (
            <button key={r} onClick={() => set({ relationship_type: r })}
              className="flex-1 py-2 rounded-xl text-xs font-semibold transition-colors"
              style={{ background: form.relationship_type === r ? V.primary : V.beige, color: form.relationship_type === r ? "white" : V.ink }}>
              {r === "adult" ? "Adulto" : "Criança"}
            </button>
          ))}
        </div>
      )}

      <input value={form.name} onChange={e => set({ name: e.target.value })}
        placeholder="Nome *" className="w-full px-4 py-3 rounded-xl text-sm border-0 outline-none"
        style={{ background: V.beige, color: V.ink }} />

      {!isChild && (
        <input value={form.phone} onChange={e => set({ phone: e.target.value })}
          placeholder="WhatsApp (opcional)" type="tel"
          className="w-full px-4 py-3 rounded-xl text-sm border-0 outline-none"
          style={{ background: V.beige, color: V.ink }} />
      )}

      {isChild && (<>
        <input value={form.school} onChange={e => set({ school: e.target.value })}
          placeholder="Escola (opcional)"
          className="w-full px-4 py-3 rounded-xl text-sm border-0 outline-none"
          style={{ background: V.beige, color: V.ink }} />
        <input value={form.grade} onChange={e => set({ grade: e.target.value })}
          placeholder="Ano / turma (opcional)"
          className="w-full px-4 py-3 rounded-xl text-sm border-0 outline-none"
          style={{ background: V.beige, color: V.ink }} />
      </>)}

      <input value={form.medical_plan} onChange={e => set({ medical_plan: e.target.value })}
        placeholder="Plano de saúde (opcional)"
        className="w-full px-4 py-3 rounded-xl text-sm border-0 outline-none"
        style={{ background: V.beige, color: V.ink }} />

      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs mr-1" style={{ color: V.muted }}>Cor:</p>
        {MEMBER_COLOURS.map(c => (
          <button key={c} onClick={() => set({ colour: c })}
            className="w-7 h-7 rounded-lg transition-transform"
            style={{ background: c, outline: form.colour === c ? `2px solid ${V.ink}` : "none", outlineOffset: "2px", transform: form.colour === c ? "scale(1.15)" : "scale(1)" }} />
        ))}
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={onCancel}
          className="flex-1 py-2.5 rounded-full text-xs font-semibold"
          style={{ background: V.beige, color: V.ink }}>Cancelar</button>
        <button onClick={() => onSave(form)} disabled={!form.name.trim() || isSaving}
          className="flex-1 py-2.5 rounded-full text-xs font-semibold text-white disabled:opacity-50"
          style={{ background: V.primary }}>
          {isSaving ? "…" : mode === "add" ? "Adicionar" : "Salvar"}
        </button>
      </div>
    </div>
  );
}

/* ── FamiliaTab ───────────────────────────────────────────────────────────── */
const EMPTY_FORM = { name: "", relationship_type: "adult" as "adult" | "child", phone: "", school: "", grade: "", medical_plan: "", colour: "" };

function FamiliaTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  const { data: members = [], isLoading } = useListMembers();
  const { data: planStatus } = useGetHouseholdPlanStatus();

  type FormMode = "none" | "add" | "edit";
  const [formMode, setFormMode] = useState<FormMode>("none");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formValues, setFormValues] = useState(EMPTY_FORM);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const [showInvite, setShowInvite] = useState(false);
  const [invitePhone, setInvitePhone] = useState("");

  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeLabel, setUpgradeLabel] = useState("");
  const [upgradeUsed, setUpgradeUsed] = useState<number | undefined>(undefined);
  const [upgradeLimit, setUpgradeLimit] = useState<number | undefined>(undefined);

  const [showConsentForm, setShowConsentForm] = useState(false);
  const [consentPhone, setConsentPhone] = useState("");
  const [consentName, setConsentName] = useState("");

  const { data: diaristContacts = [] } = useListContacts(
    { category: "diarista" },
    { query: { queryKey: getListContactsQueryKey({ category: "diarista" }), refetchInterval: 30_000, refetchOnWindowFocus: true } },
  );

  const prevConsentStatusesRef = useRef<Record<number, string>>({});
  useEffect(() => {
    const prev = prevConsentStatusesRef.current;
    const next: Record<number, string> = {};
    for (const c of diaristContacts) {
      const curr = c.consent_status ?? "pending";
      next[c.id] = curr;
      const prevStatus = prev[c.id];
      if (prevStatus && prevStatus !== curr) {
        if (curr === "consented") {
          toast({ title: "Consentimento confirmado", description: `${c.name} aceitou receber mensagens da Vesta.` });
        } else if (curr === "revoked") {
          toast({ title: "Consentimento recusado", description: `${c.name} recusou o contato.`, variant: "destructive" });
        }
      }
    }
    prevConsentStatusesRef.current = next;
  }, [diaristContacts]);

  const createContactMutation = useCreateContact({
    mutation: {
      onSuccess: async (newContact) => {
        await requestConsentForDiarista.mutateAsync({ id: newContact.id });
        void qc.invalidateQueries({ queryKey: getListContactsQueryKey() });
        setShowConsentForm(false);
        setConsentName("");
        setConsentPhone("");
        toast({ description: "Convite de consentimento enviado via WhatsApp." });
      },
      onError: () => toast({ description: "Erro ao adicionar diarista.", variant: "destructive" }),
    },
  });

  const requestConsentForDiarista = useRequestContactConsent({
    mutation: {
      onError: () => toast({ description: "Erro ao enviar convite de consentimento.", variant: "destructive" }),
    },
  });

  const invalidateMembers = () => qc.invalidateQueries({ queryKey: getListMembersQueryKey() });

  const createMember = useCreateMember({
    mutation: {
      onSuccess: () => { invalidateMembers(); closeForm(); toast({ description: "Membro adicionado." }); },
      onError: (e: unknown) => {
        if (isUpgradeError(e)) {
          const lim = planStatus?.limits;
          const usg = planStatus?.usage;
          const type = formValues.relationship_type;
          const n = type === "child" ? (lim?.children ?? 1) : (lim?.adults ?? 2);
          const used = type === "child" ? (usg?.children ?? n) : (usg?.adults ?? n);
          const label = type === "child" ? `Plano gratuito: máximo de ${n} criança(s).` : `Plano gratuito: máximo de ${n} adulto(s).`;
          setUpgradeLabel(label);
          setUpgradeUsed(used);
          setUpgradeLimit(n);
          setShowUpgrade(true);
        } else {
          toast({ title: "Erro ao adicionar", variant: "destructive" });
        }
      },
    },
  });
  const updateMember = useUpdateMember({ mutation: { onSuccess: () => { invalidateMembers(); closeForm(); toast({ description: "Membro atualizado." }); }, onError: () => toast({ title: "Erro ao atualizar", variant: "destructive" }) } });
  const deleteMember = useDeleteMember({ mutation: { onSuccess: () => { invalidateMembers(); setConfirmDeleteId(null); toast({ description: "Membro removido." }); }, onError: (e: { status?: number }) => toast({ title: e?.status === 403 ? "Não é possível remover sua própria conta" : "Erro ao remover", variant: "destructive" }) } });
  const createInvite = useCreateHouseholdInvite({ mutation: { onSuccess: () => { setShowInvite(false); setInvitePhone(""); toast({ title: "Convite enviado!", description: "O link chegará no WhatsApp deles." }); }, onError: () => toast({ title: "Erro ao enviar convite", variant: "destructive" }) } });

  function openAdd(type: "adult" | "child") {
    setFormMode("add");
    setEditingId(null);
    setFormValues({ ...EMPTY_FORM, relationship_type: type });
  }

  function openEdit(m: Member) {
    setFormMode("edit");
    setEditingId(m.id);
    setFormValues({ name: m.name, relationship_type: m.relationship_type === "child" ? "child" : "adult", phone: m.phone ?? "", school: m.school ?? "", grade: m.grade ?? "", medical_plan: m.medical_plan ?? "", colour: m.colour ?? "" });
  }

  function closeForm() { setFormMode("none"); setEditingId(null); }

  function handleSave(v: typeof EMPTY_FORM) {
    const body = { name: v.name, relationship_type: v.relationship_type, ...(v.colour && { colour: v.colour }), ...(v.relationship_type === "adult" && v.phone ? { phone: v.phone } : {}), ...(v.relationship_type === "child" && v.school ? { school: v.school } : {}), ...(v.relationship_type === "child" && v.grade ? { grade: v.grade } : {}), ...(v.medical_plan ? { medical_plan: v.medical_plan } : {}) };
    if (formMode === "add") createMember.mutate({ data: body });
    else if (editingId) updateMember.mutate({ id: editingId, data: body });
  }

  const adults = members.filter(m => m.relationship_type !== "child");
  const children = members.filter(m => m.relationship_type === "child");
  const isSaving = createMember.isPending || updateMember.isPending;

  const lim = planStatus?.limits;
  const usg = planStatus?.usage;
  const adultsAtLimit = lim?.adults !== null && lim?.adults !== undefined && (usg?.adults ?? 0) >= lim.adults;
  const childrenAtLimit = lim?.children !== null && lim?.children !== undefined && (usg?.children ?? 0) >= lim.children;
  const adultsOneLeft = !adultsAtLimit && lim?.adults !== null && lim?.adults !== undefined && (usg?.adults ?? 0) === lim.adults - 1;
  const childrenOneLeft = !childrenAtLimit && lim?.children !== null && lim?.children !== undefined && (usg?.children ?? 0) === lim.children - 1;

  function openAddGated(type: "adult" | "child") {
    const atLimit = type === "adult" ? adultsAtLimit : childrenAtLimit;
    if (atLimit) {
      const n = type === "adult" ? lim?.adults : lim?.children;
      const used = type === "adult" ? (usg?.adults ?? 0) : (usg?.children ?? 0);
      setUpgradeLabel(type === "adult" ? `Plano gratuito: máximo de ${n ?? 2} adulto(s).` : `Plano gratuito: máximo de ${n ?? 1} criança(s).`);
      setUpgradeUsed(used);
      setUpgradeLimit(n ?? (type === "adult" ? 2 : 1));
      setShowUpgrade(true);
    } else {
      openAdd(type);
      setShowInvite(false);
    }
  }

  return (
    <div className="space-y-6 py-6">

      {showUpgrade && <UpgradePrompt limitLabel={upgradeLabel} used={upgradeUsed} limit={upgradeLimit} onClose={() => { setShowUpgrade(false); setUpgradeUsed(undefined); setUpgradeLimit(undefined); }} />}

      {/* Member form panel */}
      {formMode !== "none" && (
        <MemberForm key={formMode === "edit" ? (editingId ?? "edit") : "add"} mode={formMode} initialValues={formValues} onSave={handleSave} onCancel={closeForm} isSaving={isSaving} />
      )}

      {/* Adults */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: V.muted }}>Adultos</h2>
            {lim?.adults !== null && lim?.adults !== undefined && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: adultsAtLimit ? "#FEE2E2" : V.beige, color: adultsAtLimit ? "#991B1B" : V.muted }}>
                {usg?.adults ?? 0}/{lim.adults}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setShowInvite(!showInvite); if (formMode !== "none") closeForm(); }}
              className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full"
              style={{ background: "#EAF1E5", color: V.primary }}>
              <MessageCircle className="h-3.5 w-3.5" /> Convidar
            </button>
            {adultsAtLimit ? (
              <button
                onClick={() => openAddGated("adult")}
                title={`Limite atingido — plano gratuito: máximo de ${lim?.adults} adultos`}
                className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full"
                style={{ background: V.beige, color: V.muted }}>
                <Lock className="h-3.5 w-3.5" /> Adicionar
              </button>
            ) : (
              <button onClick={() => openAddGated("adult")}
                className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full"
                style={{ background: "#EAF1E5", color: V.primary }}>
                <Plus className="h-3.5 w-3.5" /> Adicionar
              </button>
            )}
          </div>
        </div>

        {showInvite && (
          <div className="mb-4 p-4 rounded-2xl space-y-3"
            style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.1)" }}>
            <p className="text-sm font-semibold" style={{ color: V.ink }}>Convidar parceiro/a</p>
            <p className="text-xs" style={{ color: V.muted }}>O convite chega no WhatsApp deles com um link para entrar na casa.</p>
            <input type="tel" placeholder="+55 11 99999-9999" value={invitePhone}
              onChange={e => setInvitePhone(e.target.value)}
              className="w-full px-4 py-3 rounded-xl text-sm border-0 outline-none"
              style={{ background: V.beige, color: V.ink }} />
            <div className="flex gap-2">
              <button onClick={() => { setShowInvite(false); setInvitePhone(""); }}
                className="flex-1 py-2.5 rounded-full text-xs font-semibold"
                style={{ background: V.beige, color: V.ink }}>Cancelar</button>
              <button onClick={() => createInvite.mutate({ data: { phone: invitePhone } })}
                disabled={!invitePhone.trim() || createInvite.isPending}
                className="flex-1 py-2.5 rounded-full text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: "#25D366" }}>
                {createInvite.isPending ? "…" : "Enviar pelo WhatsApp"}
              </button>
            </div>
          </div>
        )}

        {adultsOneLeft && (
          <div className="mb-3 flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs"
            style={{ background: "#FEFCE8", border: "1px solid #FEF08A" }}>
            <span style={{ color: "#78350F" }}>1 vaga de adulto restante no plano gratuito</span>
            <button
              onClick={() => { setUpgradeUsed(usg?.adults ?? 0); setUpgradeLimit(lim!.adults!); setUpgradeLabel("Adicione adultos sem limite com o Premium."); setShowUpgrade(true); }}
              className="font-semibold ml-3 shrink-0"
              style={{ color: V.primary }}>
              Upgrade →
            </button>
          </div>
        )}

        <div className="rounded-3xl overflow-hidden" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
          {isLoading && <p className="px-5 py-4 text-sm" style={{ color: V.muted }}>Carregando…</p>}
          {!isLoading && adults.length === 0 && (
            <p className="px-5 py-4 text-sm" style={{ color: V.muted }}>Nenhum adulto cadastrado.</p>
          )}
          {adults.map((m, i) => (
            <MemberRow key={m.id} member={m} isFirst={i === 0}
              isSelf={!!user && m.user_id === user.id}
              confirmDeleteId={confirmDeleteId} setConfirmDeleteId={setConfirmDeleteId}
              onEdit={() => { openEdit(m); setShowInvite(false); }}
              onDelete={() => deleteMember.mutate({ id: m.id })} />
          ))}
        </div>
      </section>

      {/* Children */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: V.muted }}>Crianças</h2>
            {lim?.children !== null && lim?.children !== undefined && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: childrenAtLimit ? "#FEE2E2" : V.beige, color: childrenAtLimit ? "#991B1B" : V.muted }}>
                {usg?.children ?? 0}/{lim.children}
              </span>
            )}
          </div>
          {childrenAtLimit ? (
            <button
              onClick={() => openAddGated("child")}
              title={`Limite atingido — plano gratuito: máximo de ${lim?.children} crianças`}
              className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full"
              style={{ background: V.beige, color: V.muted }}>
              <Lock className="h-3.5 w-3.5" /> Adicionar
            </button>
          ) : (
            <button onClick={() => openAddGated("child")}
              className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full"
              style={{ background: "#EAF1E5", color: V.primary }}>
              <Plus className="h-3.5 w-3.5" /> Adicionar
            </button>
          )}
        </div>
        {childrenOneLeft && (
          <div className="mt-3 flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs"
            style={{ background: "#FEFCE8", border: "1px solid #FEF08A" }}>
            <span style={{ color: "#78350F" }}>1 vaga de criança restante no plano gratuito</span>
            <button
              onClick={() => { setUpgradeUsed(usg?.children ?? 0); setUpgradeLimit(lim!.children!); setUpgradeLabel("Adicione crianças sem limite com o Premium."); setShowUpgrade(true); }}
              className="font-semibold ml-3 shrink-0"
              style={{ color: V.primary }}>
              Upgrade →
            </button>
          </div>
        )}
        <div className="rounded-3xl overflow-hidden" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
          {children.length === 0 ? (
            <button onClick={() => openAddGated("child")}
              className="w-full flex items-center gap-4 p-4 hover:opacity-80 transition-opacity">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: V.beige }}>
                {childrenAtLimit
                  ? <Lock className="h-5 w-5" style={{ color: V.muted }} />
                  : <Baby className="h-5 w-5" style={{ color: V.sage }} />}
              </div>
              <div className="text-left">
                <p className="text-sm font-medium" style={{ color: V.ink }}>
                  {childrenAtLimit ? "Limite de crianças atingido" : "Adicionar criança"}
                </p>
                <p className="text-xs" style={{ color: V.muted }}>
                  {childrenAtLimit ? `Plano gratuito: máximo de ${lim?.children} criança(s)` : "Nome, escola e ano"}
                </p>
              </div>
              {childrenAtLimit
                ? <Lock className="h-4 w-4 ml-auto" style={{ color: V.muted }} />
                : <Plus className="h-4 w-4 ml-auto" style={{ color: V.sage }} />}
            </button>
          ) : (
            children.map((m, i) => (
              <MemberRow key={m.id} member={m} isFirst={i === 0}
                isSelf={false}
                confirmDeleteId={confirmDeleteId} setConfirmDeleteId={setConfirmDeleteId}
                onEdit={() => { openEdit(m); setShowInvite(false); }}
                onDelete={() => deleteMember.mutate({ id: m.id })} />
            ))
          )}
        </div>
      </section>

      {/* Diarista consent */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: V.muted }}>Diarista</h2>
          {diaristContacts.length > 0 && !showConsentForm && (
            <button
              onClick={() => setShowConsentForm(true)}
              className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full"
              style={{ background: "#EAF1E5", color: V.primary }}>
              <Plus className="h-3.5 w-3.5" /> Adicionar
            </button>
          )}
        </div>

        {/* Existing diarista contacts — live from API */}
        {diaristContacts.length > 0 && (
          <div className="rounded-3xl overflow-hidden mb-3"
            style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
            {diaristContacts.map((contact, i) => {
              const status = contact.consent_status ?? "pending";
              const colors = CONSENT_COLORS[status] ?? CONSENT_COLORS.not_required;
              const isFirst = i === 0;
              return (
                <div key={contact.id}
                  className="flex items-center gap-3 px-4 py-3"
                  style={{ borderTop: isFirst ? undefined : "1px solid rgba(14,59,46,0.06)" }}>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "#EAF1E5" }}>
                    {status === "consented"
                      ? <CheckCircle className="h-4 w-4" style={{ color: "#059669" }} />
                      : status === "revoked"
                        ? <AlertCircle className="h-4 w-4" style={{ color: "#DC2626" }} />
                        : <Clock className="h-4 w-4" style={{ color: "#D97706" }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: V.ink }}>{contact.name}</p>
                    {contact.phone && (
                      <p className="text-xs truncate" style={{ color: V.muted }}>{contact.phone}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px] font-semibold px-2.5 py-1 rounded-full"
                    style={{ background: colors.bg, color: colors.color }}>
                    {CONSENT_LABELS[status] ?? status}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Add diarista form */}
        {showConsentForm ? (
          <div className="p-5 rounded-3xl space-y-3"
            style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.10)" }}>
            <p className="text-sm font-semibold" style={{ color: V.ink }}>Dados da diarista</p>
            <input type="text" placeholder="Nome completo" value={consentName}
              onChange={(e) => setConsentName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl text-sm border-0 outline-none"
              style={{ background: V.beige, color: V.ink }} />
            <input type="tel" placeholder="WhatsApp (+55 11 99999-9999)" value={consentPhone}
              onChange={(e) => setConsentPhone(e.target.value)}
              className="w-full px-4 py-3 rounded-xl text-sm border-0 outline-none"
              style={{ background: V.beige, color: V.ink }} />
            <div className="p-3 rounded-xl text-xs leading-relaxed"
              style={{ background: "#FEF3C7", color: "#92400E" }}>
              <strong>LGPD:</strong> A diarista receberá uma mensagem pedindo consentimento explícito para contato pela Vesta. Nenhuma mensagem será enviada sem isso.
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setShowConsentForm(false); setConsentName(""); setConsentPhone(""); }}
                className="flex-1 py-2.5 rounded-full text-xs font-semibold"
                style={{ background: V.beige, color: V.ink }}>Cancelar</button>
              <button
                onClick={() => createContactMutation.mutate({
                  data: { name: consentName, phone: consentPhone, category: "diarista" },
                })}
                disabled={!consentName || !consentPhone || createContactMutation.isPending || requestConsentForDiarista.isPending}
                className="flex-1 py-2.5 rounded-full text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: "#25D366" }}>
                {createContactMutation.isPending || requestConsentForDiarista.isPending ? "Enviando…" : "Enviar convite"}
              </button>
            </div>
          </div>
        ) : diaristContacts.length === 0 ? (
          <div className="p-5 rounded-3xl space-y-4"
            style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
            <div className="flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 mt-0.5 shrink-0" style={{ color: V.primary }} />
              <div>
                <p className="text-sm font-semibold mb-1" style={{ color: V.ink }}>
                  Coordenar via WhatsApp
                </p>
                <p className="text-xs leading-relaxed" style={{ color: V.muted }}>
                  A Vesta pode avisar sua diarista sobre compromissos — mas só após o consentimento explícito dela (LGPD).
                </p>
              </div>
            </div>
            <button onClick={() => setShowConsentForm(true)}
              className="w-full py-3 rounded-2xl text-sm font-semibold text-white"
              style={{ background: V.primary }}>
              Adicionar diarista
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

/* ── Regras tab (RulesManagement) ─────────────────────────────────────────── */
const ORIGIN_LABELS: Record<string, string> = {
  system_template:   "Padrão do sistema",
  user_created:      "Criada por você",
  pattern_suggested: "Sugerida por padrão",
};

function RegrasTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeLabel, setUpgradeLabel] = useState("");
  const [upgradeUsed, setUpgradeUsed] = useState<number | undefined>(undefined);
  const [upgradeLimit, setUpgradeLimit] = useState<number | undefined>(undefined);
  const [pendingPattern, setPendingPattern] = useState<PatternObservation | null>(null);
  const [form, setForm] = useState({
    name: "", category: "escola", trigger_desc: "", action_desc: "", approval_level: "one_tap",
  });

  const { data: rules, isLoading } = useListRules();
  const { data: planStatus } = useGetHouseholdPlanStatus();
  const { data: members = [] } = useListMembers();

  const isAdmin = !!user && members.some((m) => m.user_id === user.id && m.role === "admin");

  const detectPatterns = useTriggerPatternDetection({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListPatternsQueryKey() });
        toast({ description: "Análise concluída. Novos padrões detectados." });
      },
      onError: () => {
        toast({ description: "Erro ao analisar padrões.", variant: "destructive" });
      },
    },
  });

  const rulesLimit = planStatus?.limits?.rules ?? null;
  const rulesUsage = planStatus?.usage?.rules ?? 0;
  const rulesAtLimit = rulesLimit !== null && rulesUsage >= rulesLimit;
  const rulesOneLeft = rulesLimit !== null && !rulesAtLimit && rulesUsage === rulesLimit - 1;

  const createRule = useCreateRule({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListRulesQueryKey() });
        setShowCreate(false);
        setPendingPattern(null);
        setForm({ name: "", category: "escola", trigger_desc: "", action_desc: "", approval_level: "one_tap" });
        toast({ description: "Regra criada." });
      },
      onError: (e: unknown) => {
        if (isUpgradeError(e)) {
          setUpgradeLabel(`Plano gratuito: máximo de ${rulesLimit ?? 3} regras inteligentes.`);
          setUpgradeUsed(rulesUsage);
          setUpgradeLimit(rulesLimit ?? 3);
          setShowUpgrade(true);
        } else {
          toast({ description: "Erro ao criar regra.", variant: "destructive" });
        }
      },
    },
  });

  const toggleRule = useToggleRule({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListRulesQueryKey() }) },
  });

  const deleteRule = useDeleteRule({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListRulesQueryKey() });
        toast({ description: "Regra removida." });
      },
    },
  });

  return (
    <div className="space-y-5 py-6">
      {showUpgrade && <UpgradePrompt limitLabel={upgradeLabel} used={upgradeUsed} limit={upgradeLimit} onClose={() => { setShowUpgrade(false); setUpgradeUsed(undefined); setUpgradeLimit(undefined); }} />}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs" style={{ color: V.muted }}>
            Regras ensinam a Vesta a agir automaticamente em situações recorrentes.
          </p>
          {rulesLimit !== null && (
            <p className="text-[10px] mt-0.5 font-semibold"
              style={{ color: rulesAtLimit ? "#991B1B" : V.muted }}>
              {rulesUsage}/{rulesLimit} regras usadas
            </p>
          )}
        </div>
        {rulesAtLimit ? (
          <button
            onClick={() => { setUpgradeLabel(`Plano gratuito: máximo de ${rulesLimit} regras inteligentes.`); setUpgradeUsed(rulesUsage); setUpgradeLimit(rulesLimit ?? 3); setShowUpgrade(true); }}
            title={`Limite atingido — plano gratuito: máximo de ${rulesLimit} regras`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 ml-3"
            style={{ background: V.beige, color: V.muted }}
            data-testid="button-create-rule">
            <Lock className="h-3.5 w-3.5" /> Regra
          </button>
        ) : (
          <button onClick={() => { setPendingPattern(null); setShowCreate(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 ml-3"
            style={{ background: "#EAF1E5", color: V.primary }}
            data-testid="button-create-rule">
            <Plus className="h-3.5 w-3.5" /> Regra
          </button>
        )}
      </div>

      {rulesOneLeft && (
        <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs"
          style={{ background: "#FEFCE8", border: "1px solid #FEF08A" }}>
          <span style={{ color: "#78350F" }}>1 regra restante no plano gratuito</span>
          <button
            onClick={() => { setUpgradeUsed(rulesUsage); setUpgradeLimit(rulesLimit!); setUpgradeLabel("Crie regras ilimitadas com o Premium."); setShowUpgrade(true); }}
            className="font-semibold ml-3 shrink-0"
            style={{ color: V.primary }}>
            Upgrade →
          </button>
        </div>
      )}

      {isAdmin && (
        <button
          onClick={() => detectPatterns.mutate()}
          disabled={detectPatterns.isPending}
          className="flex items-center gap-2 w-full px-4 py-3 rounded-xl text-sm font-medium transition-opacity disabled:opacity-60"
          style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.12)", color: V.primary }}
          data-testid="button-detect-patterns">
          {detectPatterns.isPending ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {detectPatterns.isPending ? "Analisando…" : "Analisar padrões agora"}
        </button>
      )}

      <PatternSuggestions
        onAcceptClick={(pattern, prefill) => {
          setPendingPattern(pattern);
          setForm({ ...prefill, approval_level: "one_tap" });
          setShowCreate(true);
        }}
      />

      {/* Create form */}
      {showCreate && (
        <div className="rounded-2xl p-4 space-y-3 animate-fade-in-up"
          style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.10)" }}>
          <p className="text-sm font-semibold" style={{ color: V.ink }}>Nova regra</p>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Nome da regra"
            className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-rule-name" />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring">
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <input value={form.trigger_desc} onChange={(e) => setForm({ ...form, trigger_desc: e.target.value })}
            placeholder="Quando acontecer… (gatilho)"
            className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-rule-trigger" />
          <input value={form.action_desc} onChange={(e) => setForm({ ...form, action_desc: e.target.value })}
            placeholder="Fazer isso… (ação)"
            className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-rule-action" />
          <select value={form.approval_level} onChange={(e) => setForm({ ...form, approval_level: e.target.value })}
            className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="soft">Automático (silencioso)</option>
            <option value="one_tap">Um toque</option>
            <option value="explicit">Aprovação explícita</option>
          </select>
          <div className="flex gap-2">
            <button onClick={() => { setPendingPattern(null); setShowCreate(false); }}
              className="flex-1 py-2.5 rounded-xl border border-border text-sm"
              style={{ color: V.muted }}>Cancelar</button>
            <button
              onClick={() => createRule.mutate({ data: {
                name: form.name, category: form.category,
                trigger_desc: form.trigger_desc, action_desc: form.action_desc,
                approval_level: form.approval_level as import("@workspace/api-client-react").RuleInputApprovalLevel,
                ...(pendingPattern ? { pattern_id: pendingPattern.id } : {}),
              }})}
              disabled={!form.name || !form.trigger_desc || !form.action_desc || createRule.isPending}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-50"
              style={{ background: V.primary }}
              data-testid="button-submit-rule">
              {createRule.isPending ? "Criando..." : "Criar regra"}
            </button>
          </div>
        </div>
      )}

      {/* Rules list */}
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />)}</div>
      ) : !rules?.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Zap className="w-10 h-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">Nenhuma regra criada</p>
          <p className="text-xs text-muted-foreground/60 mt-1 max-w-[200px]">
            Crie regras para automatizar aprovações recorrentes.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id}
              className={cn("rounded-2xl p-4 space-y-2 group", rule.active ? "" : "opacity-60")}
              style={{ background: V.cream, border: `1px solid ${rule.active ? "rgba(14,59,46,0.12)" : "rgba(14,59,46,0.06)"}` }}
              data-testid={`rule-${rule.id}`}>
              <div className="flex items-start gap-2">
                <Zap className={cn("w-4 h-4 mt-0.5 shrink-0", rule.active ? "" : "text-muted-foreground")}
                  style={rule.active ? { color: V.primary } : undefined} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold" style={{ color: V.ink }}>{rule.name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => toggleRule.mutate({ id: rule.id })}
                        className="p-1 transition-colors hover:opacity-70"
                        style={{ color: V.muted }}
                        data-testid={`toggle-rule-${rule.id}`}>
                        {rule.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => deleteRule.mutate({ id: rule.id })}
                        className="p-1 transition-colors hover:text-red-500 opacity-0 group-hover:opacity-100"
                        style={{ color: V.muted }}
                        data-testid={`delete-rule-${rule.id}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <CategoryBadge category={rule.category} className="mt-1" />
                </div>
              </div>
              <div className="ml-6 space-y-1">
                <p className="text-xs" style={{ color: V.muted }}>
                  <span className="font-medium" style={{ color: V.ink }}>Quando: </span>{rule.trigger_desc}
                </p>
                <p className="text-xs" style={{ color: V.muted }}>
                  <span className="font-medium" style={{ color: V.ink }}>Ação: </span>{rule.action_desc}
                </p>
              </div>
              <div className="ml-6 flex items-center gap-3">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${Math.round(rule.confidence * 100)}%`, background: V.primary }} />
                </div>
                <span className="text-[10px]" style={{ color: V.muted }}>{Math.round(rule.confidence * 100)}%</span>
                <span className="text-[10px]" style={{ color: V.muted }}>{rule.times_triggered} disparos</span>
                <span className="text-[10px] text-emerald-600">{rule.times_approved} aprovados</span>
              </div>
              {rule.origin && (
                <p className="ml-6 text-[10px]" style={{ color: V.muted }}>
                  {ORIGIN_LABELS[rule.origin] ?? rule.origin}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── AuditTrustPreview ────────────────────────────────────────────────────── */
function AuditTrustPreview() {
  const { data: entries = [], isLoading: loading } = useListAuditLog({ limit: 10 });

  const approved  = entries.filter((e) => e.action_type === "approved").length;
  const dismissed = entries.filter((e) => e.action_type === "dismissed").length;
  const auto      = entries.filter((e) => e.action_type === "auto").length;

  const ACTION_TYPE_COLORS: Record<string, string> = {
    approved:  "#059669",
    dismissed: "#9CA3AF",
    auto:      "#6366F1",
  };

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <History className="h-4 w-4" style={{ color: V.primary }} />
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: V.muted }}>
          Histórico de ações
        </h2>
      </div>

      {/* Trust metrics */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { label: "Aprovados",  count: approved,  color: "#059669", bg: "#F0FDF4" },
          { label: "Descartados", count: dismissed, color: "#9CA3AF", bg: V.beige },
          { label: "Auto",       count: auto,      color: "#6366F1", bg: "#EEF2FF" },
        ].map((m) => (
          <div key={m.label} className="rounded-2xl p-3 text-center"
            style={{ background: m.bg, border: "1px solid rgba(14,59,46,0.06)" }}>
            <p className="text-xl font-bold" style={{ color: m.color }}>{m.count}</p>
            <p className="text-[10px] mt-0.5" style={{ color: V.muted }}>{m.label}</p>
          </div>
        ))}
      </div>

      {/* Log entries */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-2xl p-4 text-center text-sm"
          style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)", color: V.muted }}>
          Nenhuma ação registrada ainda.
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
          {entries.map((entry, i) => (
            <div key={entry.id} className="flex items-start gap-3 px-4 py-3"
              style={{ borderTop: i > 0 ? "1px solid rgba(14,59,46,0.06)" : "none" }}>
              <div className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
                style={{ background: ACTION_TYPE_COLORS[entry.action_type] ?? V.sage }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-snug line-clamp-1" style={{ color: V.ink }}>{entry.description}</p>
                {entry.category && <CategoryBadge category={entry.category} className="mt-0.5" />}
              </div>
              <span className="text-[10px] shrink-0 mt-0.5" style={{ color: V.muted }}>
                {formatRelativeTime(entry.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ── PrivacyDashboard ─────────────────────────────────────────────────────── */
type Contact = {
  id: number;
  name: string;
  phone?: string | null;
  consent_status?: string | null;
  role?: string | null;
};

const CONSENT_LABELS: Record<string, string> = {
  consented:    "Consentido",
  pending:      "Pendente",
  revoked:      "Revogado",
  not_required: "Não necessário",
};

const CONSENT_COLORS: Record<string, { bg: string; color: string }> = {
  consented:    { bg: "#DCFCE7", color: "#065F46" },
  pending:      { bg: "#FEF3C7", color: "#92400E" },
  revoked:      { bg: "#FEE2E2", color: "#991B1B" },
  not_required: { bg: V.beige,   color: V.muted },
};

function PrivacyDashboard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: contacts } = useListContacts(undefined, {
    query: { queryKey: getListContactsQueryKey(), refetchInterval: 30_000, refetchOnWindowFocus: true },
  });
  const { data: consentDueContacts = [] } = useGetContactsConsentDue({
    query: { queryKey: getGetContactsConsentDueQueryKey(), refetchInterval: 30_000, refetchOnWindowFocus: true },
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [exportSummary, setExportSummary] = useState<PrivacyExportSummary | null>(null);

  const revokeConsent = useUpdateContact({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListContactsQueryKey() });
        toast({ description: "Consentimento revogado." });
      },
      onError: () => toast({ description: "Erro ao revogar consentimento.", variant: "destructive" }),
    },
  });

  const requestConsent = useRequestContactConsent({
    mutation: {
      onSuccess: (data) => {
        void qc.invalidateQueries({ queryKey: getListContactsQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetContactsConsentDueQueryKey() });
        toast({ description: data.whatsapp_sent ? "Solicitação enviada por WhatsApp." : "Contato atualizado (WhatsApp não configurado)." });
      },
      onError: () => toast({ description: "Erro ao solicitar consentimento.", variant: "destructive" }),
    },
  });

  const deleteAccount = useDeleteAccount({
    mutation: {
      onSuccess: () => {
        toast({ description: "Conta excluída. Redirecionando..." });
        setTimeout(() => { window.location.href = "/"; }, 1500);
      },
      onError: () => toast({ description: "Erro ao excluir conta.", variant: "destructive" }),
    },
  });

  async function handleExportClick() {
    setSummarizing(true);
    try {
      const summary = await getPrivacyExportSummary();
      setExportSummary(summary);
    } catch {
      toast({ description: "Erro ao verificar dados para exportação.", variant: "destructive" });
    } finally {
      setSummarizing(false);
    }
  }

  async function handleConfirmExport() {
    setExporting(true);
    try {
      const data = await exportPrivacyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "vesta-export.json";
      a.click();
      URL.revokeObjectURL(url);
      toast({ description: "Dados exportados com sucesso." });
      setExportSummary(null);
    } catch {
      toast({ description: "Erro ao exportar dados.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  const externalContacts = (contacts ?? []) as Contact[];
  const consentedContacts = externalContacts.filter((c) =>
    c.consent_status === "consented" || c.consent_status === "pending"
  );

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <Shield className="h-4 w-4" style={{ color: V.primary }} />
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: V.muted }}>
          Privacidade e LGPD
        </h2>
      </div>

      {/* Contacts with consent */}
      {consentedContacts.length > 0 && (
        <div className="rounded-2xl overflow-hidden mb-4"
          style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
          <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: V.muted }}>
            Contatos externos ({consentedContacts.length})
          </p>
          {consentedContacts.map((contact, i) => {
            const status = contact.consent_status ?? "not_required";
            const colors = CONSENT_COLORS[status] ?? CONSENT_COLORS.not_required;
            return (
              <div key={contact.id} className="flex items-center gap-3 px-4 py-3"
                style={{ borderTop: i > 0 ? "1px solid rgba(14,59,46,0.06)" : "1px solid rgba(14,59,46,0.06)" }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: "#EAF1E5" }}>
                  <Phone className="h-4 w-4" style={{ color: V.primary }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: V.ink }}>{contact.name}</p>
                  {contact.phone && (
                    <p className="text-xs truncate" style={{ color: V.muted }}>{contact.phone}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ background: colors.bg, color: colors.color }}>
                    {CONSENT_LABELS[status] ?? status}
                  </span>
                  {status === "pending" && (
                    <button
                      onClick={() => requestConsent.mutate({ id: contact.id })}
                      disabled={requestConsent.isPending}
                      className="text-[10px] px-2 py-1 rounded-lg transition-colors disabled:opacity-50"
                      style={{ background: "#EAF1E5", color: V.primary }}>
                      Solicitar
                    </button>
                  )}
                  {status === "consented" && (
                    <button
                      onClick={() => revokeConsent.mutate({ id: contact.id, data: { consent_status: "revoked" } })}
                      disabled={revokeConsent.isPending}
                      className="text-[10px] px-2 py-1 rounded-lg transition-colors disabled:opacity-50"
                      style={{ background: "#FEE2E2", color: "#DC2626" }}>
                      Revogar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {consentedContacts.length === 0 && (
        <div className="rounded-2xl p-4 mb-4 text-center"
          style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
          <p className="text-sm" style={{ color: V.muted }}>Nenhum contato externo cadastrado.</p>
          <p className="text-xs mt-1" style={{ color: V.muted }}>Adicione diaristas na aba Família.</p>
        </div>
      )}

      {/* Consent renewal alerts — overdue (red) */}
      {consentDueContacts.filter((c) => c.consent_check_in_due_at && new Date(c.consent_check_in_due_at) < new Date()).length > 0 && (
        <div className="rounded-2xl overflow-hidden mb-3"
          style={{ background: "#FFF1F2", border: "1px solid #FECDD3" }}>
          <div className="flex items-center gap-2 px-4 pt-3 pb-1">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" style={{ color: "#DC2626" }} />
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#991B1B" }}>
              Consentimento vencido
            </p>
          </div>
          {consentDueContacts
            .filter((c) => c.consent_check_in_due_at && new Date(c.consent_check_in_due_at) < new Date())
            .map((contact) => {
              const dueAt = new Date(contact.consent_check_in_due_at!);
              const daysOverdue = Math.floor((Date.now() - dueAt.getTime()) / (1000 * 60 * 60 * 24));
              return (
                <div key={contact.id} className="flex items-center gap-3 px-4 py-3"
                  style={{ borderTop: "1px solid #FECDD3" }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: "#FEE2E2" }}>
                    <AlertCircle className="h-4 w-4" style={{ color: "#DC2626" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "#991B1B" }}>{contact.name}</p>
                    <p className="text-xs" style={{ color: "#DC2626" }}>
                      {daysOverdue === 0
                        ? "Venceu hoje"
                        : `Vencido há ${daysOverdue} dia${daysOverdue === 1 ? "" : "s"}`}
                    </p>
                  </div>
                  <button
                    onClick={() => requestConsent.mutate({ id: contact.id })}
                    disabled={requestConsent.isPending}
                    className="text-xs px-3 py-1.5 rounded-lg font-semibold shrink-0 disabled:opacity-50"
                    style={{ background: "#DC2626", color: "white" }}>
                    Renovar
                  </button>
                </div>
              );
            })}
          <p className="px-4 py-2 text-[10px]" style={{ color: "#DC2626", borderTop: "1px solid #FECDD3" }}>
            Nenhuma mensagem pode ser enviada até o consentimento ser renovado.
          </p>
        </div>
      )}

      {/* Consent renewal alerts — upcoming (amber) */}
      {consentDueContacts.filter((c) => !c.consent_check_in_due_at || new Date(c.consent_check_in_due_at) >= new Date()).length > 0 && (
        <div className="rounded-2xl overflow-hidden mb-4"
          style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}>
          <div className="flex items-center gap-2 px-4 pt-3 pb-1">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" style={{ color: "#D97706" }} />
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#92400E" }}>
              Renovação em breve
            </p>
          </div>
          {consentDueContacts
            .filter((c) => !c.consent_check_in_due_at || new Date(c.consent_check_in_due_at) >= new Date())
            .map((contact) => {
              const dueAt = contact.consent_check_in_due_at
                ? new Date(contact.consent_check_in_due_at)
                : null;
              const daysUntilDue = dueAt
                ? Math.ceil((dueAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                : null;
              return (
                <div key={contact.id} className="flex items-center gap-3 px-4 py-3"
                  style={{ borderTop: "1px solid #FDE68A" }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: "#FEF3C7" }}>
                    <Clock className="h-4 w-4" style={{ color: "#D97706" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "#92400E" }}>{contact.name}</p>
                    <p className="text-xs" style={{ color: "#B45309" }}>
                      {daysUntilDue !== null
                        ? `Vence em ${daysUntilDue} dia${daysUntilDue === 1 ? "" : "s"}`
                        : "Consentimento vence em breve"}
                    </p>
                  </div>
                  <button
                    onClick={() => requestConsent.mutate({ id: contact.id })}
                    disabled={requestConsent.isPending}
                    className="text-xs px-3 py-1.5 rounded-lg font-semibold shrink-0 disabled:opacity-50"
                    style={{ background: "#D97706", color: "white" }}>
                    Renovar
                  </button>
                </div>
              );
            })}
          <p className="px-4 py-2 text-[10px]" style={{ color: "#B45309", borderTop: "1px solid #FDE68A" }}>
            Uma mensagem será enviada por WhatsApp pedindo nova confirmação.
          </p>
        </div>
      )}

      {/* LGPD data rights */}
      <div className="rounded-2xl overflow-hidden" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
        <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: V.muted }}>
          Seus direitos (LGPD)
        </p>

        {!exportSummary ? (
          <button
            onClick={handleExportClick}
            disabled={summarizing || exporting}
            className="w-full flex items-center gap-4 px-4 py-3 text-left hover:opacity-80 transition-opacity disabled:opacity-50"
            style={{ borderTop: "1px solid rgba(14,59,46,0.06)" }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "#EAF1E5" }}>
              <Download className="h-4 w-4" style={{ color: V.primary }} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium" style={{ color: V.ink }}>
                {summarizing ? "Verificando dados..." : "Baixar meus dados"}
              </p>
              <p className="text-xs" style={{ color: V.muted }}>Export JSON com todos os seus dados</p>
            </div>
            <ChevronRight className="h-4 w-4" style={{ color: V.sage }} />
          </button>
        ) : (
          <div className="px-4 py-3 space-y-3" style={{ borderTop: "1px solid rgba(14,59,46,0.06)" }}>
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4 shrink-0" style={{ color: V.primary }} />
              <p className="text-sm font-semibold" style={{ color: V.ink }}>Confirmar download</p>
            </div>
            <div className="rounded-xl p-3 space-y-1.5" style={{ background: V.beige }}>
              {exportSummary.inbox_items > 0 && (
                <p className="text-xs" style={{ color: V.muted }}>
                  <span className="font-semibold" style={{ color: V.ink }}>{exportSummary.inbox_items}</span> {exportSummary.inbox_items === 1 ? "item na caixa de entrada" : "itens na caixa de entrada"}
                </p>
              )}
              {exportSummary.events > 0 && (
                <p className="text-xs" style={{ color: V.muted }}>
                  <span className="font-semibold" style={{ color: V.ink }}>{exportSummary.events}</span> {exportSummary.events === 1 ? "evento" : "eventos"}
                </p>
              )}
              {exportSummary.tasks > 0 && (
                <p className="text-xs" style={{ color: V.muted }}>
                  <span className="font-semibold" style={{ color: V.ink }}>{exportSummary.tasks}</span> {exportSummary.tasks === 1 ? "tarefa" : "tarefas"}
                </p>
              )}
              {exportSummary.members > 0 && (
                <p className="text-xs" style={{ color: V.muted }}>
                  <span className="font-semibold" style={{ color: V.ink }}>{exportSummary.members}</span> {exportSummary.members === 1 ? "membro" : "membros"}
                </p>
              )}
              {exportSummary.audit_log > 0 && (
                <p className="text-xs" style={{ color: V.muted }}>
                  <span className="font-semibold" style={{ color: V.ink }}>{exportSummary.audit_log}</span> {exportSummary.audit_log === 1 ? "registro de auditoria" : "registros de auditoria"}
                </p>
              )}
              <p className="text-xs pt-1" style={{ color: V.muted, borderTop: "1px solid rgba(14,59,46,0.08)" }}>
                Tamanho estimado: <span className="font-semibold" style={{ color: V.ink }}>~{exportSummary.estimated_size_kb} KB</span>
                {exportSummary.estimated_size_kb > 500 && (
                  <span className="ml-1" style={{ color: "#92400E" }}>— pode demorar alguns segundos</span>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setExportSummary(null)}
                disabled={exporting}
                className="flex-1 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
                style={{ background: V.beige, color: V.ink }}>
                Cancelar
              </button>
              <button
                onClick={handleConfirmExport}
                disabled={exporting}
                className="flex-1 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: V.primary }}>
                {exporting ? "Exportando..." : "Baixar"}
              </button>
            </div>
          </div>
        )}

        <div className="px-4 py-3" style={{ borderTop: "1px solid rgba(14,59,46,0.06)" }}>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full flex items-center gap-4 text-left hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "#FEE2E2" }}>
                <Trash2 className="h-4 w-4" style={{ color: "#DC2626" }} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium" style={{ color: "#DC2626" }}>Excluir todos os dados</p>
                <p className="text-xs" style={{ color: V.muted }}>Remove permanentemente household e histórico</p>
              </div>
              <ChevronRight className="h-4 w-4" style={{ color: V.sage }} />
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-semibold" style={{ color: "#DC2626" }}>
                Tem certeza? Esta ação é irreversível.
              </p>
              <p className="text-xs" style={{ color: V.muted }}>
                Todos os dados da sua casa serão apagados permanentemente.
              </p>
              <div className="flex gap-2 mt-2">
                <button onClick={() => setConfirmDelete(false)}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold"
                  style={{ background: V.beige, color: V.ink }}>
                  Cancelar
                </button>
                <button
                  onClick={() => deleteAccount.mutate()}
                  disabled={deleteAccount.isPending}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50"
                  style={{ background: "#DC2626" }}>
                  {deleteAccount.isPending ? "Excluindo..." : "Excluir tudo"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── Privacidade tab ─────────────────────────────────────────────────────── */
function PrivacidadeTab() {
  return (
    <div className="space-y-6 py-6">
      <AuditTrustPreview />
      <PrivacyDashboard />
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */
export default function CasaPage() {
  const [tab, setTab] = useState<Tab>("inicio");
  const { data: allPatterns } = useListPatterns();
  const patternCount = allPatterns?.filter((p) => p.status === "suggested" || p.status === "threshold_met").length ?? 0;
  return (
    <div className="animate-fade-in-up">
      <div className="sticky top-0 z-10 px-4 pt-4" style={{ background: V.ivory }}>
        <h1 className="text-xl font-bold mb-3" style={{ color: V.ink }}>Casa</h1>
        <TabBar active={tab} onChange={setTab} patternCount={patternCount} />
      </div>
      <div className="px-4 pb-24">
        {tab === "inicio"      && <InicioTab />}
        {tab === "familia"     && <FamiliaTab />}
        {tab === "regras"      && <RegrasTab />}
        {tab === "privacidade" && <PrivacidadeTab />}
      </div>
    </div>
  );
}
