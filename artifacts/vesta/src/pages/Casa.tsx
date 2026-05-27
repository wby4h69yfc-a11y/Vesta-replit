import { useState, useEffect } from "react";
import {
  Users, ShieldCheck, ChevronRight, Plus, Trash2,
  Home, Baby, Heart, Lock, Bell, Key, HelpCircle, LogOut,
  Sparkles, CheckCircle, Clock, AlertCircle, X,
  CalendarDays, Mail, RefreshCw, Unlink, ExternalLink,
  MessageCircle, Copy, Check, Zap, TrendingUp, Pause, Play,
  CheckCircle2, History, Download, Shield, Phone,
  Wifi, WifiOff,
} from "lucide-react";
import {
  useGetHousehold,
  useListRules, useCreateRule, useToggleRule, useDeleteRule,
  useListPatterns, useAcceptPattern, useDismissPattern,
  useListContacts, useUpdateContact, useRequestContactConsent,
  useListAuditLog,
  useDeleteAccount,
  exportPrivacyData,
  getListRulesQueryKey, getListPatternsQueryKey, getListContactsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import CategoryBadge from "@/components/CategoryBadge";
import { CATEGORIES } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils";

const V = {
  primary: "#0E3B2E",
  deep:    "#08251E",
  sage:    "#6F856F",
  ivory:   "#F7F4EA",
  cream:   "#FFFDF6",
  beige:   "#EEE6D6",
  ink:     "#12231C",
  muted:   "#5F6B61",
};

type Tab = "inicio" | "familia" | "regras" | "privacidade";

/* ── TabBar ──────────────────────────────────────────────────────────────── */
function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
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
          className="flex-1 py-3 text-xs font-semibold transition-colors"
          style={{
            color: active === t.id ? V.primary : V.muted,
            borderBottom: active === t.id ? `2px solid ${V.primary}` : "2px solid transparent",
          }}>
          {t.label}
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

/* ── Família tab (members + diarista consent) ─────────────────────────────── */
function FamiliaTab() {
  const [showInvite, setShowInvite] = useState(false);
  const [phone, setPhone] = useState("");
  const [consentStep, setConsentStep] = useState<"idle" | "form" | "pending" | "consented">("idle");
  const [consentPhone, setConsentPhone] = useState("");
  const [consentName, setConsentName] = useState("");

  return (
    <div className="space-y-6 py-6">
      {/* Adults */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: V.muted }}>Membros</h2>
          <button onClick={() => setShowInvite(!showInvite)}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full"
            style={{ background: "#EAF1E5", color: V.primary }}>
            <Plus className="h-3.5 w-3.5" /> Convidar
          </button>
        </div>

        {showInvite && (
          <div className="mb-4 p-4 rounded-2xl space-y-3"
            style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.1)" }}>
            <p className="text-sm font-semibold" style={{ color: V.ink }}>Convidar parceiro/a</p>
            <p className="text-xs" style={{ color: V.muted }}>O convite chega no WhatsApp deles.</p>
            <input type="tel" placeholder="+55 11 99999-9999" value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-4 py-3 rounded-xl text-sm border-0 outline-none"
              style={{ background: V.beige, color: V.ink }} />
            <div className="flex gap-2">
              <button onClick={() => setShowInvite(false)}
                className="flex-1 py-2.5 rounded-full text-xs font-semibold"
                style={{ background: V.beige, color: V.ink }}>Cancelar</button>
              <button className="flex-1 py-2.5 rounded-full text-xs font-semibold text-white"
                style={{ background: "#25D366" }}>Enviar pelo WhatsApp</button>
            </div>
          </div>
        )}

        <div className="rounded-3xl overflow-hidden" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
          <div className="flex items-center gap-4 px-5 py-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm"
              style={{ background: V.primary }}>V</div>
            <div className="flex-1">
              <p className="text-sm font-semibold" style={{ color: V.ink }}>Você</p>
              <p className="text-xs" style={{ color: V.muted }}>Administrador</p>
            </div>
          </div>
          <div className="flex items-center gap-4 px-5 py-4 opacity-50 cursor-not-allowed"
            style={{ borderTop: "1px solid rgba(14,59,46,0.06)" }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center border-2 border-dashed"
              style={{ borderColor: V.sage }}>
              <Users className="h-4 w-4" style={{ color: V.sage }} />
            </div>
            <div>
              <p className="text-sm" style={{ color: V.muted }}>Aguardando parceiro/a</p>
              <p className="text-xs" style={{ color: V.muted }}>Convite não enviado ainda</p>
            </div>
          </div>
        </div>
      </section>

      {/* Children */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: V.muted }}>Crianças</h2>
        <button className="w-full flex items-center gap-4 p-4 rounded-3xl border-2 border-dashed hover:opacity-80 transition-opacity"
          style={{ borderColor: V.beige }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: V.beige }}>
            <Baby className="h-5 w-5" style={{ color: V.sage }} />
          </div>
          <div className="text-left">
            <p className="text-sm font-medium" style={{ color: V.ink }}>Adicionar criança</p>
            <p className="text-xs" style={{ color: V.muted }}>Nome, escola e ano</p>
          </div>
          <Plus className="h-4 w-4 ml-auto" style={{ color: V.sage }} />
        </button>
      </section>

      {/* Diarista consent */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: V.muted }}>Diarista</h2>

        {consentStep === "idle" && (
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
            <button onClick={() => setConsentStep("form")}
              className="w-full py-3 rounded-2xl text-sm font-semibold text-white"
              style={{ background: V.primary }}>
              Adicionar diarista
            </button>
          </div>
        )}

        {consentStep === "form" && (
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
              <button onClick={() => setConsentStep("idle")}
                className="flex-1 py-2.5 rounded-full text-xs font-semibold"
                style={{ background: V.beige, color: V.ink }}>Cancelar</button>
              <button onClick={() => setConsentStep("pending")}
                disabled={!consentName || !consentPhone}
                className="flex-1 py-2.5 rounded-full text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: "#25D366" }}>Enviar convite</button>
            </div>
          </div>
        )}

        {consentStep === "pending" && (
          <div className="p-5 rounded-3xl space-y-3"
            style={{ background: "#FEF3C7", border: "1px solid rgba(245,158,11,0.2)" }}>
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 shrink-0" style={{ color: "#D97706" }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: "#92400E" }}>Aguardando consentimento</p>
                <p className="text-xs mt-0.5" style={{ color: "#B45309" }}>
                  {consentName} ainda não respondeu ao convite.
                </p>
              </div>
            </div>
            <button onClick={() => setConsentStep("idle")}
              className="text-xs" style={{ color: V.muted }}>Cancelar convite</button>
          </div>
        )}

        {consentStep === "consented" && (
          <div className="p-5 rounded-3xl space-y-2"
            style={{ background: "#F0FDF4", border: "1px solid #BBF7D0" }}>
            <div className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 shrink-0" style={{ color: "#059669" }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: "#065F46" }}>Consentimento confirmado</p>
                <p className="text-xs mt-0.5" style={{ color: "#047857" }}>
                  {consentName} aceitou receber mensagens da Vesta.
                </p>
              </div>
            </div>
          </div>
        )}
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
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "", category: "escola", trigger_desc: "", action_desc: "", approval_level: "one_tap",
  });

  const { data: rules, isLoading } = useListRules();
  const { data: patterns } = useListPatterns({ status: "suggested" });

  const createRule = useCreateRule({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListRulesQueryKey() });
        setShowCreate(false);
        setForm({ name: "", category: "escola", trigger_desc: "", action_desc: "", approval_level: "one_tap" });
        toast({ description: "Regra criada." });
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

  const acceptPattern = useAcceptPattern({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListPatternsQueryKey() });
        qc.invalidateQueries({ queryKey: getListRulesQueryKey() });
        toast({ description: "Regra criada a partir do padrão!" });
      },
    },
  });

  const dismissPattern = useDismissPattern({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListPatternsQueryKey() }) },
  });

  return (
    <div className="space-y-5 py-6">
      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: V.muted }}>
          Regras ensinam a Vesta a agir automaticamente em situações recorrentes.
        </p>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 ml-3"
          style={{ background: "#EAF1E5", color: V.primary }}
          data-testid="button-create-rule">
          <Plus className="h-3.5 w-3.5" /> Regra
        </button>
      </div>

      {/* Pattern suggestions */}
      {(patterns?.length ?? 0) > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: V.muted }}>
            Padrões detectados
          </h2>
          <div className="space-y-2">
            {patterns?.map((p) => (
              <div key={p.id}
                className="rounded-2xl p-4 space-y-2"
                style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.12)" }}
                data-testid={`pattern-${p.id}`}>
                <div className="flex items-start gap-2">
                  <TrendingUp className="w-4 h-4 shrink-0 mt-0.5" style={{ color: V.primary }} />
                  <p className="text-sm flex-1" style={{ color: V.ink }}>
                    Notei que <span className="font-medium">{p.description}</span> aconteceu {p.occurrences} {p.occurrences === 1 ? "vez" : "vezes"}.
                  </p>
                </div>
                {p.evidence && <p className="text-xs pl-6" style={{ color: V.muted }}>{p.evidence}</p>}
                <div className="flex gap-2 pl-6">
                  <button onClick={() => dismissPattern.mutate({ id: p.id })}
                    className="text-xs px-3 py-1.5 rounded-lg border border-border"
                    style={{ color: V.muted }}
                    data-testid={`dismiss-pattern-${p.id}`}>
                    Ignorar
                  </button>
                  <button onClick={() => acceptPattern.mutate({ id: p.id })}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium"
                    style={{ background: "#EAF1E5", color: V.primary }}
                    data-testid={`accept-pattern-${p.id}`}>
                    Criar regra
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

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
            <button onClick={() => setShowCreate(false)}
              className="flex-1 py-2.5 rounded-xl border border-border text-sm"
              style={{ color: V.muted }}>Cancelar</button>
            <button
              onClick={() => createRule.mutate({ data: {
                name: form.name, category: form.category,
                trigger_desc: form.trigger_desc, action_desc: form.action_desc,
                approval_level: form.approval_level as import("@workspace/api-client-react").RuleInputApprovalLevel,
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
  const { data: contacts } = useListContacts();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);

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

  async function handleExport() {
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

      {/* LGPD data rights */}
      <div className="rounded-2xl overflow-hidden" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
        <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: V.muted }}>
          Seus direitos (LGPD)
        </p>

        <button
          onClick={handleExport}
          disabled={exporting}
          className="w-full flex items-center gap-4 px-4 py-3 text-left hover:opacity-80 transition-opacity disabled:opacity-50"
          style={{ borderTop: "1px solid rgba(14,59,46,0.06)" }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "#EAF1E5" }}>
            <Download className="h-4 w-4" style={{ color: V.primary }} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium" style={{ color: V.ink }}>
              {exporting ? "Exportando..." : "Baixar meus dados"}
            </p>
            <p className="text-xs" style={{ color: V.muted }}>Export JSON com todos os seus dados</p>
          </div>
          <ChevronRight className="h-4 w-4" style={{ color: V.sage }} />
        </button>

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
  return (
    <div className="animate-fade-in-up">
      <div className="sticky top-0 z-10 px-4 pt-4" style={{ background: V.ivory }}>
        <h1 className="text-xl font-bold mb-3" style={{ color: V.ink }}>Casa</h1>
        <TabBar active={tab} onChange={setTab} />
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
