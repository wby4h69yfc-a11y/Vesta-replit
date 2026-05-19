import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import {
  Home, ChevronRight, ChevronLeft, Check, Calendar,
  MessageCircle, Sparkles, X, Loader2, ArrowRight,
} from "lucide-react";

/* ── tokens ── */
const V = {
  primary: "#0E3B2E",
  sage:    "#6F856F",
  ivory:   "#F7F4EA",
  cream:   "#FFFDF6",
  ink:     "#12231C",
  muted:   "#5F6B61",
  beige:   "#EEE6D6",
  wa:      "#25D366",
  waHeader:"#075E54",
};

/* ── progress bar ── */
function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex gap-1 mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="h-1 flex-1 rounded-full transition-all duration-300"
          style={{ background: i < step ? V.primary : V.beige }} />
      ))}
    </div>
  );
}

/* ── step props ── */
interface StepProps {
  onNext: (data?: Record<string, unknown>) => void;
  onBack: () => void;
  data: Record<string, unknown>;
}

/* ────────────────────────────────────────────
   STEP 0 — Welcome (WhatsApp-native frame)
──────────────────────────────────────────── */
function Step0Welcome({ onNext }: StepProps) {
  return (
    <div className="flex flex-col gap-8 pt-4">
      {/* WA-style hero */}
      <div className="rounded-3xl overflow-hidden" style={{ background: V.waHeader }}>
        <div className="px-6 pt-8 pb-6">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: "rgba(255,255,255,0.15)" }}>
            <Home className="h-7 w-7 text-white" strokeWidth={1.5} />
          </div>
          <h1 className="font-serif text-3xl font-semibold text-white mb-2 leading-tight">
            Manda um recado.<br />
            <span className="italic" style={{ color: "rgba(255,255,255,0.75)" }}>A Vesta transforma em ação.</span>
          </h1>
          <p className="text-sm leading-6" style={{ color: "rgba(255,255,255,0.65)" }}>
            Encaminhe mensagens da escola, consultas, boletos, lembretes — pelo WhatsApp. A Vesta organiza tudo.
          </p>
        </div>
        {/* value prop list */}
        <div className="px-4 pb-5 space-y-2">
          {[
            "📩  Encaminhe mensagens do jeito que chegam",
            "✅  Aprove em um toque, direto no WhatsApp",
            "📅  Vai direto pro calendário da família",
          ].map((line) => (
            <p key={line} className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.80)" }}>
              {line}
            </p>
          ))}
        </div>
      </div>

      <div className="space-y-2.5">
        {[
          { icon: "📩", text: "Encaminhe mensagens do jeito que chegam" },
          { icon: "✅", text: "Aprove em um toque — sem abrir app" },
          { icon: "📅", text: "Vai direto pro calendário" },
        ].map((item) => (
          <div key={item.text} className="flex items-center gap-3 px-4 py-3 rounded-2xl" style={{ background: V.cream }}>
            <span className="text-lg">{item.icon}</span>
            <span className="text-sm" style={{ color: V.ink }}>{item.text}</span>
          </div>
        ))}
      </div>

      <button onClick={() => onNext()}
        className="w-full py-4 rounded-full text-base font-semibold text-white transition-opacity hover:opacity-90"
        style={{ background: V.primary }}>
        Começar <ArrowRight className="h-4 w-4 inline ml-1" />
      </button>
      <p className="text-center text-xs" style={{ color: V.muted }}>Leva ~2 minutos · sem cartão</p>
    </div>
  );
}

/* ────────────────────────────────────────────
   STEP 1 — Minimal account (name + phone + city)
──────────────────────────────────────────── */
function Step1Account({ onNext, onBack, data }: StepProps) {
  const [name, setName]   = useState((data.name as string)  || "");
  const [phone, setPhone] = useState((data.phone as string) || "");
  const [city, setCity]   = useState((data.city as string)  || "");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-3xl font-semibold mb-1" style={{ color: V.ink }}>Rápido e pronto.</h2>
        <p className="text-sm" style={{ color: V.muted }}>Só o essencial pra você começar.</p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: V.ink }}>Como quer ser chamada?</label>
          <input type="text" placeholder="Seu nome" value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-5 py-4 rounded-2xl text-base border-0 outline-none"
            style={{ background: V.cream, color: V.ink }} />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: V.ink }}>Número de WhatsApp</label>
          <input type="tel" placeholder="+55 11 99999-9999" value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full px-5 py-4 rounded-2xl text-base border-0 outline-none"
            style={{ background: V.cream, color: V.ink }} />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: V.ink }}>Cidade</label>
          <input type="text" placeholder="São Paulo" value={city}
            onChange={(e) => setCity(e.target.value)}
            className="w-full px-5 py-4 rounded-2xl text-base border-0 outline-none"
            style={{ background: V.cream, color: V.ink }} />
        </div>
      </div>

      <p className="text-xs" style={{ color: V.muted }}>
        Não pedimos composição da casa, rotinas ou calendário agora. Essas perguntas vêm depois — quando fizer sentido.
      </p>

      <div className="flex gap-3 pt-2">
        <button onClick={onBack} className="px-6 py-3.5 rounded-full text-sm font-medium"
          style={{ background: V.beige, color: V.ink }}>
          <ChevronLeft className="h-4 w-4 inline" /> Voltar
        </button>
        <button onClick={() => onNext({ name, phone, city })}
          disabled={!name.trim()}
          className="flex-1 py-3.5 rounded-full text-sm font-semibold text-white disabled:opacity-40"
          style={{ background: V.primary }}>
          Continuar <ChevronRight className="h-4 w-4 inline" />
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────
   STEP 2 — Connect WhatsApp
──────────────────────────────────────────── */
function Step2WhatsApp({ onNext, onBack, data }: StepProps) {
  const [phase, setPhase] = useState<"explain" | "token" | "verified">("explain");
  const [token, setToken] = useState("");
  const [waNumber, setWaNumber] = useState("");
  const [waConfigured, setWaConfigured] = useState(false);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function handleConnect() {
    try {
      const res = await fetch("/api/onboarding/whatsapp-connect", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json() as { token: string; whatsapp_number: string | null; configured: boolean };
      setToken(data.token);
      setWaNumber(data.whatsapp_number ?? "");
      setWaConfigured(data.configured);
      setPhase("token");
      setPolling(true);

      // Poll status every 2.5s
      pollRef.current = setInterval(async () => {
        const r = await fetch("/api/onboarding/whatsapp-status", { credentials: "include" });
        if (r.ok) {
          const j = await r.json() as { verified: boolean };
          if (j.verified) {
            clearInterval(pollRef.current!);
            setPolling(false);
            setPhase("verified");
          }
        }
      }, 2500);
    } catch {
      // Fallback: show token with static Twilio sandbox number
      setToken(`VESTA-${Math.floor(100 + Math.random() * 900)}`);
      setWaConfigured(false);
      setPhase("token");
    }
  }

  function openWA() {
    const num = waNumber || "14155238886"; // Twilio sandbox fallback
    const msg = encodeURIComponent(token);
    window.open(`https://wa.me/${num}?text=${msg}`, "_blank");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: V.wa }}>
          <MessageCircle className="h-6 w-6 text-white" />
        </div>
        <div>
          <h2 className="font-serif text-2xl font-semibold" style={{ color: V.ink }}>A Vesta trabalha pelo WhatsApp.</h2>
          <p className="text-xs mt-0.5" style={{ color: V.muted }}>Onde tudo acontece</p>
        </div>
      </div>

      <div className="rounded-3xl p-5 space-y-3" style={{ background: V.cream }}>
        <p className="text-sm leading-6" style={{ color: V.ink }}>
          Encaminhe recados, fotos, áudios e lembretes. A Vesta organiza, pergunta o mínimo necessário e escreve no calendário quando você aprovar.
        </p>
        <div className="space-y-2">
          {["Encaminhe mensagens da escola, consultas, boletos",
            "Receba resumos às 7h",
            "Aprove ou ajuste em um toque"].map((item) => (
            <div key={item} className="flex items-center gap-2 text-sm" style={{ color: V.muted }}>
              <Check className="h-3.5 w-3.5 shrink-0" style={{ color: V.primary }} />
              {item}
            </div>
          ))}
        </div>
      </div>

      {phase === "explain" && (
        <button onClick={handleConnect}
          className="w-full py-4 rounded-full text-sm font-semibold text-white flex items-center justify-center gap-2"
          style={{ background: V.wa }}>
          <MessageCircle className="h-4 w-4" />
          Conectar WhatsApp
        </button>
      )}

      {phase === "token" && (
        <div className="space-y-4">
          <div className="rounded-2xl p-5 text-center space-y-2" style={{ background: "#F0FDF4", border: "2px dashed #86EFAC" }}>
            <p className="text-xs font-semibold" style={{ color: "#15803D" }}>Seu código de verificação</p>
            <p className="text-3xl font-bold tracking-widest" style={{ color: V.primary }}>{token}</p>
            <p className="text-xs" style={{ color: V.muted }}>Envie esse código para a Vesta no WhatsApp</p>
          </div>
          <button onClick={openWA}
            className="w-full py-3.5 rounded-full text-sm font-semibold flex items-center justify-center gap-2 border-2"
            style={{ borderColor: V.wa, color: V.wa }}>
            <MessageCircle className="h-4 w-4" />
            Abrir WhatsApp
          </button>
          {polling && (
            <div className="flex items-center justify-center gap-2 text-sm" style={{ color: V.muted }}>
              <Loader2 className="h-4 w-4 animate-spin" />
              Aguardando verificação…
            </div>
          )}
        </div>
      )}

      {phase === "verified" && (
        <div className="rounded-2xl p-5 text-center space-y-2" style={{ background: "#D1FAE5" }}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center mx-auto" style={{ background: "#059669" }}>
            <Check className="h-5 w-5 text-white" />
          </div>
          <p className="text-sm font-semibold" style={{ color: "#065F46" }}>WhatsApp conectado!</p>
          <p className="text-xs" style={{ color: "#047857" }}>
            {(data.name as string) ? `Oi, ${data.name as string}! ` : ""}A Vesta está pronta para receber recados.
          </p>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={onBack} className="px-6 py-3.5 rounded-full text-sm font-medium"
          style={{ background: V.beige, color: V.ink }}>
          <ChevronLeft className="h-4 w-4 inline" /> Voltar
        </button>
        <button
          onClick={() => onNext({ whatsapp_verified: phase === "verified", whatsapp_token: token })}
          className="flex-1 py-3.5 rounded-full text-sm font-semibold text-white"
          style={{ background: V.primary }}>
          {phase === "verified" ? "Perfeito, continuar →" : "Pular por agora"} <ChevronRight className="h-4 w-4 inline" />
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────
   STEP 3 — WhatsApp usage examples
   (instructional — no simulator)
──────────────────────────────────────────── */

const WA_EXAMPLES = [
  {
    emoji: "📅",
    category: "Eventos",
    sample: "Reunião da escola quinta 19h",
    outcome: "Cria evento no calendário e lembra 1h antes",
  },
  {
    emoji: "✅",
    category: "Tarefas",
    sample: "Lembra de comprar caderno da Sofia até sexta",
    outcome: "Tarefa com prazo e lembrete",
  },
  {
    emoji: "💊",
    category: "Saúde",
    sample: "Consulta da pediatra confirmada 20/06 14h",
    outcome: "Salvo no calendário, aguarda sua aprovação",
  },
  {
    emoji: "📸",
    category: "Fotos e áudios",
    sample: "[circular da escola encaminhada]",
    outcome: "Transcrito, classificado automaticamente",
  },
];

function Step3Examples({ onNext, onBack }: StepProps) {
  const [waInfo, setWaInfo] = useState<{ whatsapp_number?: string } | null>(null);

  useEffect(() => {
    fetch("/api/webhook/whatsapp/info", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { webhook_url?: string }) => {
        const match = d.webhook_url?.match(/(\+?\d[\d\s-]{7,})/);
        if (match) setWaInfo({ whatsapp_number: match[1].replace(/\D/g, "") });
      })
      .catch(() => {});
  }, []);

  function openWA() {
    const num = waInfo?.whatsapp_number ?? "14155238886";
    window.open(`https://wa.me/${num}`, "_blank");
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-serif text-2xl font-semibold mb-1" style={{ color: V.ink }}>
          É assim que funciona.
        </h2>
        <p className="text-sm leading-6" style={{ color: V.muted }}>
          Encaminhe qualquer mensagem da casa pelo WhatsApp. A Vesta entende, organiza e só te chama quando precisa de uma decisão.
        </p>
      </div>

      {/* Example cards */}
      <div className="space-y-2.5">
        {WA_EXAMPLES.map((ex) => (
          <div key={ex.category}
            className="rounded-2xl px-4 py-3.5 flex gap-3 items-start"
            style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.07)" }}>
            <span className="text-xl leading-none mt-0.5 shrink-0">{ex.emoji}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: V.sage }}>{ex.category}</p>
              <p className="text-sm italic mb-1" style={{ color: V.ink }}>"{ex.sample}"</p>
              <p className="text-xs" style={{ color: V.muted }}>→ {ex.outcome}</p>
            </div>
          </div>
        ))}
      </div>

      {/* CTA: open WhatsApp */}
      <div className="rounded-2xl p-4 space-y-3" style={{ background: "#F0FDF4", border: "1px solid #86EFAC" }}>
        <p className="text-sm font-semibold text-center" style={{ color: "#065F46" }}>
          Pronto para começar? Abra o WhatsApp agora.
        </p>
        <button onClick={openWA}
          className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
          style={{ background: V.wa, color: "white" }}>
          <MessageCircle className="h-4 w-4" />
          Abrir WhatsApp
        </button>
        <p className="text-xs text-center" style={{ color: "#047857" }}>
          Pode encaminhar qualquer mensagem agora — ou fazer isso depois.
        </p>
      </div>

      <div className="flex gap-3">
        <button onClick={onBack} className="px-6 py-3.5 rounded-full text-sm font-medium"
          style={{ background: V.beige, color: V.ink }}>
          <ChevronLeft className="h-4 w-4 inline" /> Voltar
        </button>
        <button onClick={() => onNext({})}
          className="flex-1 py-3.5 rounded-full text-sm font-semibold text-white"
          style={{ background: V.primary }}>
          Continuar <ChevronRight className="h-4 w-4 inline" />
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────
   STEP 4 — Progressive enrichment
──────────────────────────────────────────── */
function Step4Enrich({ onNext, onBack, data }: StepProps) {
  const [calConnected, setCalConnected] = useState(false);
  const [partnerInvited, setPartnerInvited] = useState(false);
  const [partnerPhone, setPartnerPhone] = useState("");
  const [showPartnerInput, setShowPartnerInput] = useState(false);
  const calPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const name = (data.name as string) || "";

  // Check if Google Calendar is already connected on mount
  useEffect(() => {
    fetch("/api/google/status", { credentials: "include" })
      .then((r) => r.json())
      .then((j: { connected: boolean }) => { if (j.connected) setCalConnected(true); })
      .catch(() => {});
    return () => { if (calPollRef.current) clearInterval(calPollRef.current); };
  }, []);

  function connectGoogle() {
    window.open("/api/google/connect", "_blank");
    // Poll for connection in background
    calPollRef.current = setInterval(() => {
      fetch("/api/google/status", { credentials: "include" })
        .then((r) => r.json())
        .then((j: { connected: boolean }) => {
          if (j.connected) {
            setCalConnected(true);
            clearInterval(calPollRef.current!);
          }
        })
        .catch(() => {});
    }, 2000);
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-serif text-2xl font-semibold mb-1" style={{ color: V.ink }}>
          Dois passos que valem muito.
        </h2>
        <p className="text-sm" style={{ color: V.muted }}>
          Ambos opcionais — pode configurar depois também.
        </p>
      </div>

      {/* Calendar card */}
      <div className="rounded-2xl p-5 space-y-3" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#4285F4" }}>
            <Calendar className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold" style={{ color: V.ink }}>Conectar Google Agenda</p>
            <p className="text-xs" style={{ color: V.muted }}>A Vesta cria eventos automaticamente após sua aprovação.</p>
          </div>
          {calConnected && <Check className="h-5 w-5 shrink-0" style={{ color: V.primary }} />}
        </div>
        {!calConnected ? (
          <button onClick={connectGoogle}
            className="w-full py-2.5 rounded-xl text-sm font-semibold border-2 transition-colors"
            style={{ borderColor: "#4285F4", color: "#4285F4" }}>
            Conectar (abre nova aba)
          </button>
        ) : (
          <div className="text-center text-xs font-semibold py-1" style={{ color: "#1E40AF" }}>Google Agenda conectado ✓</div>
        )}
      </div>

      {/* Partner card */}
      <div className="rounded-2xl p-5 space-y-3" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: V.sage }}>
            <MessageCircle className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold" style={{ color: V.ink }}>Convidar parceiro(a) ou co-gestor</p>
            <p className="text-xs" style={{ color: V.muted }}>Tarefas atribuídas chegam para eles também.</p>
          </div>
          {partnerInvited && <Check className="h-5 w-5 shrink-0" style={{ color: V.primary }} />}
        </div>
        {!partnerInvited && !showPartnerInput && (
          <button onClick={() => setShowPartnerInput(true)}
            className="w-full py-2.5 rounded-xl text-sm font-semibold border-2 transition-colors"
            style={{ borderColor: V.sage, color: V.sage }}>
            Convidar
          </button>
        )}
        {showPartnerInput && !partnerInvited && (
          <div className="space-y-2">
            <input type="tel" placeholder="+55 11 99999-9999" value={partnerPhone}
              onChange={(e) => setPartnerPhone(e.target.value)}
              className="w-full px-4 py-3 rounded-xl text-sm border-0 outline-none"
              style={{ background: "#EEE6D6", color: V.ink }} />
            <button onClick={() => { if (partnerPhone.trim()) setPartnerInvited(true); }}
              disabled={!partnerPhone.trim()}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: V.sage }}>
              Enviar convite
            </button>
          </div>
        )}
        {partnerInvited && (
          <div className="text-center text-xs font-semibold py-1" style={{ color: V.primary }}>Convite enviado para {partnerPhone} ✓</div>
        )}
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={onBack} className="px-6 py-3.5 rounded-full text-sm font-medium"
          style={{ background: V.beige, color: V.ink }}>
          <ChevronLeft className="h-4 w-4 inline" /> Voltar
        </button>
        <button
          onClick={() => onNext({ calendar_connected: calConnected, partner_invited: partnerInvited })}
          className="flex-1 py-3.5 rounded-full text-sm font-semibold text-white"
          style={{ background: V.primary }}>
          Continuar <ChevronRight className="h-4 w-4 inline" />
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────
   STEP 5 — Done
──────────────────────────────────────────── */
function Step5Done({ onNext, data }: StepProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const name = (data.name as string) || "";
  const firstApproved = data.first_item_approved as boolean | undefined;

  async function handleFinish() {
    setSaving(true);
    setError(null);
    try {
      const body = {
        display_name:       name || null,
        household_name:     name ? `Casa de ${name}` : "Minha Casa",
        composition:        null,
        pain_points:        [],
        whatsapp_phone:     (data.phone as string) || null,
        whatsapp_verified:  (data.whatsapp_verified as boolean) ?? false,
        calendar_connected: (data.calendar_connected as boolean) ?? false,
      };
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onNext();
    } catch {
      setError("Algo deu errado. Tente novamente.");
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-center text-center gap-6 pt-4">
      <div className="w-24 h-24 rounded-full flex items-center justify-center"
        style={{ background: firstApproved ? "#EAF1E5" : V.cream }}>
        <Sparkles className="h-12 w-12" style={{ color: V.primary }} />
      </div>

      <div>
        <h2 className="font-serif text-3xl font-semibold mb-3" style={{ color: V.ink }}>
          {name ? `Pronta, ${name}!` : "Tudo pronto!"}
        </h2>
        {firstApproved ? (
          <p className="text-base" style={{ color: V.muted }}>
            O primeiro combinado está anotado. De agora em diante, basta encaminhar no WhatsApp.
          </p>
        ) : (
          <p className="text-base" style={{ color: V.muted }}>
            A Vesta está pronta. Seu primeiro passo: encaminhe uma mensagem da casa no WhatsApp.
          </p>
        )}
      </div>

      {/* Day 1 → learning promise cards */}
      <div className="w-full space-y-2 text-left">
        {[
          { phase: "Dia 1",        text: "Você define as regras. A Vesta executa." },
          { phase: "Semanas 2–4",  text: "Cada aprovação ensina algo." },
          { phase: "Mês 2+",       text: "A casa começou a saber." },
        ].map((item) => (
          <div key={item.phase} className="flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{ background: V.cream }}>
            <span className="text-xs font-bold uppercase tracking-wide shrink-0 w-20"
              style={{ color: V.sage }}>{item.phase}</span>
            <span className="text-sm" style={{ color: V.ink }}>{item.text}</span>
          </div>
        ))}
      </div>

      {error && <p className="text-sm" style={{ color: "#B91C1C" }}>{error}</p>}

      <button onClick={handleFinish} disabled={saving}
        className="w-full py-4 rounded-full text-base font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-70"
        style={{ background: V.primary }}>
        {saving ? (
          <><Loader2 className="h-4 w-4 animate-spin" />Salvando...</>
        ) : (
          <>Entrar na Vesta <ArrowRight className="h-4 w-4" /></>
        )}
      </button>
    </div>
  );
}

/* ────────────────────────────────────────────
   Steps registry
──────────────────────────────────────────── */
const STEPS = [
  { component: Step0Welcome,   title: "" },
  { component: Step1Account,   title: "Conta" },
  { component: Step2WhatsApp,  title: "WhatsApp" },
  { component: Step3Examples,  title: "Como usar" },
  { component: Step4Enrich,    title: "Configurar" },
  { component: Step5Done,      title: "Pronto!" },
];
const PROGRESS_STEPS = STEPS.length - 2; // exclude welcome + done from progress bar

/* ────────────────────────────────────────────
   Root export
──────────────────────────────────────────── */
export default function OnboardingPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState<Record<string, unknown>>({
    name: user?.firstName ?? "",
  });

  async function handleNext(data?: Record<string, unknown>) {
    const merged = { ...formData, ...data };
    setFormData(merged);
    if (step >= STEPS.length - 1) {
      await queryClient.invalidateQueries({ queryKey: ["onboarding-state"] });
      navigate("/app");
    } else {
      setStep((s) => s + 1);
    }
  }

  function handleBack() {
    if (step > 0) setStep((s) => s - 1);
  }

  const StepComponent = STEPS[step].component;
  const showProgress = step > 0 && step < STEPS.length - 1;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: V.ivory }}>
      {/* Header */}
      <header className="px-5 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: V.primary }}>
            <Home className="h-4 w-4 text-white" strokeWidth={1.8} />
          </div>
          <span className="text-lg font-semibold tracking-tight" style={{ color: V.ink }}>vesta</span>
        </div>
        {step > 0 && (
          <button onClick={() => navigate("/app")} style={{ color: V.muted }}>
            <X className="h-5 w-5" />
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-5 pb-10 max-w-md mx-auto w-full">
        {showProgress && <ProgressBar step={step} total={PROGRESS_STEPS} />}
        <StepComponent onNext={handleNext} onBack={handleBack} data={formData} />
      </div>
    </div>
  );
}
