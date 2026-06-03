import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Home, MessageCircle, ArrowRight, Loader2, ChevronLeft, CheckCircle2, ChevronDown, X, Search } from "lucide-react";
import { V } from "@/lib/brand";

type Screen = "phone" | "otp" | "success";

const ERROR_MESSAGES: Record<string, string> = {
  google_denied: "Acesso ao Google cancelado.",
  google_failed: "Falha ao entrar com Google. Tente novamente.",
  apple_denied: "Acesso à Apple cancelado.",
  apple_failed: "Falha ao entrar com Apple. Tente novamente.",
  apple_not_configured: "Login com Apple ainda não está disponível.",
  invalid_state: "Sessão expirada. Tente novamente.",
};

interface Country {
  dial: string;
  flag: string;
  name: string;
}

const COUNTRIES: Country[] = [
  { dial: "+55", flag: "🇧🇷", name: "Brasil" },
  { dial: "+351", flag: "🇵🇹", name: "Portugal" },
  { dial: "+1", flag: "🇺🇸", name: "EUA / Canadá" },
  { dial: "+54", flag: "🇦🇷", name: "Argentina" },
  { dial: "+52", flag: "🇲🇽", name: "México" },
  { dial: "+57", flag: "🇨🇴", name: "Colômbia" },
  { dial: "+56", flag: "🇨🇱", name: "Chile" },
  { dial: "+51", flag: "🇵🇪", name: "Peru" },
  { dial: "+598", flag: "🇺🇾", name: "Uruguai" },
  { dial: "+595", flag: "🇵🇾", name: "Paraguai" },
  { dial: "+591", flag: "🇧🇴", name: "Bolívia" },
  { dial: "+58", flag: "🇻🇪", name: "Venezuela" },
  { dial: "+593", flag: "🇪🇨", name: "Equador" },
  { dial: "+44", flag: "🇬🇧", name: "Reino Unido" },
  { dial: "+49", flag: "🇩🇪", name: "Alemanha" },
  { dial: "+34", flag: "🇪🇸", name: "Espanha" },
  { dial: "+33", flag: "🇫🇷", name: "França" },
  { dial: "+39", flag: "🇮🇹", name: "Itália" },
  { dial: "+61", flag: "🇦🇺", name: "Austrália" },
  { dial: "+81", flag: "🇯🇵", name: "Japão" },
  { dial: "+86", flag: "🇨🇳", name: "China" },
  { dial: "+91", flag: "🇮🇳", name: "Índia" },
  { dial: "+244", flag: "🇦🇴", name: "Angola" },
  { dial: "+258", flag: "🇲🇿", name: "Moçambique" },
  { dial: "+27", flag: "🇿🇦", name: "África do Sul" },
  { dial: "+972", flag: "🇮🇱", name: "Israel" },
];

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

function GoogleIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98l-.09.06c-.22.14-2.18 1.27-2.16 3.8.03 3.02 2.65 4.03 2.68 4.04l-.07.28zM13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
    </svg>
  );
}

export default function LoginPage() {
  const [screen, setScreen] = useState<Screen>("phone");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState<Country>(COUNTRIES[0]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [otp, setOtp] = useState<string[]>(Array(6).fill(""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errParam = params.get("error");
    if (errParam) {
      setError(ERROR_MESSAGES[errParam] ?? "Erro ao entrar. Tente novamente.");
      window.history.replaceState({}, "", window.location.pathname);
    }

    fetch("/api/auth/social/available", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { apple?: boolean }) => { setAppleAvailable(!!d.apple); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  function formatLocalPhone(raw: string) {
    if (country.dial !== "+55") return raw;
    const digits = raw.replace(/\D/g, "");
    if (digits.length <= 2) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
  }

  function handlePhoneChange(raw: string) {
    const maxDigits = country.dial === "+55" ? 11 : 15;
    const digits = raw.replace(/\D/g, "").slice(0, maxDigits);
    setPhone(digits);
    setError(null);
  }

  function fullPhone() {
    return `${country.dial}${phone}`;
  }

  async function sendOtp() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: fullPhone() }),
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
        body: JSON.stringify({ phone: fullPhone(), code }),
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

  const minPhoneLength = country.dial === "+55" ? 10 : 5;
  const otpComplete = otp.every((c) => c !== "");

  const filteredCountries = COUNTRIES.filter(c =>
    c.name.toLowerCase().includes(pickerSearch.toLowerCase()) ||
    c.dial.includes(pickerSearch)
  );

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
          <div className="w-full space-y-5">
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
              {/* Country picker trigger */}
              <button
                type="button"
                onClick={() => { setPickerOpen(true); setPickerSearch(""); }}
                className="flex items-center gap-1.5 shrink-0 hover:opacity-70 transition-opacity"
              >
                <span className="text-base leading-none">{country.flag}</span>
                <span className="text-sm font-semibold" style={{ color: V.ink }}>{country.dial}</span>
                <ChevronDown className="h-3 w-3" style={{ color: V.muted }} />
              </button>
              <div className="w-px h-5 rounded-full" style={{ background: V.beige }} />
              <input
                type="tel"
                inputMode="numeric"
                placeholder={country.dial === "+55" ? "(11) 99999-9999" : "Número local"}
                value={formatLocalPhone(phone)}
                onChange={(e) => handlePhoneChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && phone.length >= minPhoneLength) void sendOtp(); }}
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
              disabled={phone.length < minPhoneLength || loading}
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

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px" style={{ background: V.beige }} />
              <span className="text-xs" style={{ color: V.muted }}>ou continue com</span>
              <div className="flex-1 h-px" style={{ background: V.beige }} />
            </div>

            {/* Social sign-in buttons */}
            <div className="space-y-3">
              <a
                href="/api/auth/google"
                className="w-full flex items-center justify-center gap-3 py-3.5 rounded-full text-sm font-semibold border transition-opacity hover:opacity-80"
                style={{ background: V.cream, borderColor: V.beige, color: V.ink }}
              >
                <GoogleIcon />
                Entrar com Google
              </a>

              {appleAvailable && (
                <a
                  href="/api/auth/apple"
                  className="w-full flex items-center justify-center gap-3 py-3.5 rounded-full text-sm font-semibold transition-opacity hover:opacity-80"
                  style={{ background: V.ink, color: "#FFFFFF" }}
                >
                  <AppleIcon />
                  Entrar com Apple
                </a>
              )}
            </div>

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
                  {country.flag} {country.dial} {formatLocalPhone(phone)}
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

      {/* ── COUNTRY PICKER MODAL ── */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          onClick={() => setPickerOpen(false)}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-lg rounded-t-3xl overflow-hidden flex flex-col"
            style={{ background: V.cream, maxHeight: "72vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 pt-5 pb-3 shrink-0" style={{ borderBottom: `1px solid ${V.beige}` }}>
              <div className="flex items-center justify-between mb-3">
                <p className="font-semibold text-sm" style={{ color: V.ink }}>Selecionar país</p>
                <button
                  onClick={() => setPickerOpen(false)}
                  className="w-7 h-7 flex items-center justify-center rounded-full"
                  style={{ background: V.beige }}
                >
                  <X className="h-4 w-4" style={{ color: V.muted }} />
                </button>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: V.beige }}>
                <Search className="h-4 w-4 shrink-0" style={{ color: V.muted }} />
                <input
                  type="text"
                  placeholder="Pesquisar país ou código..."
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  className="flex-1 bg-transparent text-sm outline-none"
                  style={{ color: V.ink }}
                  autoFocus
                />
              </div>
            </div>

            {/* Country list */}
            <div className="overflow-y-auto flex-1">
              {filteredCountries.length === 0 ? (
                <p className="px-5 py-6 text-sm text-center" style={{ color: V.muted }}>
                  Nenhum país encontrado.
                </p>
              ) : (
                filteredCountries.map((c) => {
                  const selected = c.dial === country.dial && c.flag === country.flag;
                  return (
                    <button
                      key={`${c.dial}-${c.flag}`}
                      onClick={() => {
                        setCountry(c);
                        setPhone("");
                        setPickerOpen(false);
                        setPickerSearch("");
                      }}
                      className="w-full flex items-center gap-3 px-5 py-3.5 text-left transition-opacity hover:opacity-80"
                      style={{
                        borderBottom: `1px solid ${V.beige}66`,
                        background: selected ? "#EAF1E5" : "transparent",
                      }}
                    >
                      <span className="text-xl leading-none">{c.flag}</span>
                      <span className="text-sm flex-1" style={{ color: V.ink }}>{c.name}</span>
                      <span className="text-sm font-medium" style={{ color: selected ? V.primary : V.muted }}>
                        {c.dial}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
