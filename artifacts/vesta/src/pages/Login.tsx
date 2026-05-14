import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Home, MessageCircle, ArrowRight, Loader2, ChevronLeft, CheckCircle2 } from "lucide-react";

const V = {
  primary: "#0E3B2E",
  sage: "#6F856F",
  ivory: "#F7F4EA",
  cream: "#FFFDF6",
  ink: "#12231C",
  muted: "#5F6B61",
  beige: "#EEE6D6",
  whatsapp: "#25D366",
};

type Screen = "phone" | "otp" | "success";

interface OtpInputProps {
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}

function OtpInput({ value, onChange, disabled }: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  function handleChange(i: number, char: string) {
    const c = char.replace(/\D/g, "").slice(-1);
    const next = [...value];
    next[i] = c;
    onChange(next);
    if (c && i < 5) refs.current[i + 1]?.focus();
  }

  function handleKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !value[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
    if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
  }

  function handlePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!text) return;
    e.preventDefault();
    const next = Array(6).fill("");
    text.split("").forEach((c, i) => { next[i] = c; });
    onChange(next);
    refs.current[Math.min(text.length, 5)]?.focus();
  }

  return (
    <div className="flex gap-2 justify-center" onPaste={handlePaste}>
      {Array(6).fill(0).map((_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] ?? ""}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          disabled={disabled}
          className="w-11 h-14 text-center text-xl font-bold rounded-2xl border-2 outline-none transition-all"
          style={{
            background: V.cream,
            color: V.ink,
            borderColor: value[i] ? V.primary : V.beige,
          }}
        />
      ))}
    </div>
  );
}

export default function LoginPage() {
  const [screen, setScreen] = useState<Screen>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState<string[]>(Array(6).fill(""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Countdown for resend
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  function formatPhoneDisplay(raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length <= 2) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
  }

  function handlePhoneChange(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 11);
    setPhone(digits);
    setError(null);
  }

  async function sendOtp() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json() as { sent?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Falha ao enviar");
      setScreen("otp");
      setResendCooldown(30);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    const code = otp.join("");
    if (code.length < 6) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Código inválido");
      setScreen("success");
      setTimeout(() => { window.location.replace("/app"); }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
      setOtp(Array(6).fill(""));
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (resendCooldown > 0) return;
    setOtp(Array(6).fill(""));
    setError(null);
    await sendOtp();
  }

  const otpComplete = otp.every((c) => c !== "");

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-12"
      style={{ background: V.ivory }}
    >
      <div className="w-full max-w-sm flex flex-col items-center gap-8">

        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm"
            style={{ background: V.primary }}
          >
            <Home className="h-7 w-7 text-white" strokeWidth={1.5} />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: V.ink }}>vesta</h1>
            <p className="text-sm mt-0.5" style={{ color: V.muted }}>O sistema operacional da sua família</p>
          </div>
        </div>

        {/* ── PHONE SCREEN ── */}
        {screen === "phone" && (
          <div className="w-full space-y-6">
            <div className="text-center space-y-1">
              <div className="flex items-center justify-center gap-2 mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: V.whatsapp }}>
                  <MessageCircle className="h-5 w-5 text-white" />
                </div>
              </div>
              <h2 className="font-serif text-2xl font-semibold" style={{ color: V.ink }}>
                Entre com WhatsApp
              </h2>
              <p className="text-sm" style={{ color: V.muted }}>
                Enviaremos um código de verificação para o seu número.
              </p>
            </div>

            {/* Phone input */}
            <div
              className="flex items-center gap-3 px-4 py-4 rounded-2xl"
              style={{ background: V.cream }}
            >
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-base">🇧🇷</span>
                <span className="text-sm font-semibold" style={{ color: V.ink }}>+55</span>
              </div>
              <div className="w-px h-5 rounded-full" style={{ background: V.beige }} />
              <input
                type="tel"
                inputMode="numeric"
                placeholder="(11) 99999-9999"
                value={formatPhoneDisplay(phone)}
                onChange={(e) => handlePhoneChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && phone.length >= 10) void sendOtp(); }}
                className="flex-1 bg-transparent text-base outline-none"
                style={{ color: V.ink }}
                autoFocus
              />
            </div>

            {error && (
              <p className="text-sm text-center" style={{ color: "#B91C1C" }}>{error}</p>
            )}

            <button
              onClick={sendOtp}
              disabled={phone.length < 10 || loading}
              className="w-full py-4 rounded-full text-base font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40 transition-opacity hover:opacity-90"
              style={{ background: V.whatsapp }}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <MessageCircle className="h-4 w-4" />
                  Enviar código pelo WhatsApp
                </>
              )}
            </button>

            <p className="text-center text-xs leading-relaxed" style={{ color: V.muted }}>
              Ao entrar você concorda com nossos{" "}
              <span className="underline" style={{ color: V.sage }}>Termos de Uso</span>{" "}
              e{" "}
              <span className="underline" style={{ color: V.sage }}>Política de Privacidade</span>.
            </p>
          </div>
        )}

        {/* ── OTP SCREEN ── */}
        {screen === "otp" && (
          <div className="w-full space-y-6">
            <button
              onClick={() => { setScreen("phone"); setError(null); setOtp(Array(6).fill("")); }}
              className="flex items-center gap-1 text-sm"
              style={{ color: V.muted }}
            >
              <ChevronLeft className="h-4 w-4" /> Voltar
            </button>

            <div className="text-center space-y-2">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto"
                style={{ background: "#D1FAE5" }}
              >
                <MessageCircle className="h-7 w-7" style={{ color: "#065F46" }} />
              </div>
              <h2 className="font-serif text-2xl font-semibold" style={{ color: V.ink }}>
                Verifique o WhatsApp
              </h2>
              <p className="text-sm" style={{ color: V.muted }}>
                Enviamos um código de 6 dígitos para{" "}
                <span className="font-semibold" style={{ color: V.ink }}>
                  +55 {formatPhoneDisplay(phone)}
                </span>
              </p>
            </div>

            <OtpInput value={otp} onChange={setOtp} disabled={loading} />

            {error && (
              <p className="text-sm text-center" style={{ color: "#B91C1C" }}>{error}</p>
            )}

            <button
              onClick={verifyOtp}
              disabled={!otpComplete || loading}
              className="w-full py-4 rounded-full text-base font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40 transition-opacity hover:opacity-90"
              style={{ background: V.primary }}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Entrar <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>

            <p className="text-center text-sm" style={{ color: V.muted }}>
              Não recebeu?{" "}
              {resendCooldown > 0 ? (
                <span>Reenviar em {resendCooldown}s</span>
              ) : (
                <button
                  onClick={resend}
                  className="font-semibold underline"
                  style={{ color: V.primary }}
                >
                  Reenviar código
                </button>
              )}
            </p>
          </div>
        )}

        {/* ── SUCCESS SCREEN ── */}
        {screen === "success" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background: "#D1FAE5" }}
            >
              <CheckCircle2 className="h-8 w-8" style={{ color: "#065F46" }} />
            </div>
            <p className="text-lg font-semibold" style={{ color: V.ink }}>Entrou com sucesso!</p>
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: V.muted }} />
          </div>
        )}
      </div>
    </div>
  );
}
