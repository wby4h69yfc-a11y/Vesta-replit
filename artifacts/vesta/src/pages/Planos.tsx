import { Check, Sparkles } from "lucide-react";
import { useLocation } from "wouter";

const FREE_FEATURES = [
  "2 adultos + 1 criança",
  "3 regras inteligentes",
  "Briefing diário por WhatsApp",
  "Caixa de entrada",
  "Agenda integrada",
];

const PREMIUM_FEATURES = [
  "Adultos e crianças ilimitados",
  "Regras ilimitadas",
  "Briefing prioritário",
  "Caixa de entrada avançada",
  "Agenda + Google Calendar",
  "Histórico completo",
  "Suporte prioritário",
];

export default function PlanosPage() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen p-6 space-y-6" style={{ background: "#F7F4EA" }}>
      <div className="flex items-center gap-3 mb-2">
        <button onClick={() => navigate(-1 as never)}
          className="text-sm font-medium px-3 py-1.5 rounded-xl"
          style={{ background: "#EEE6D6", color: "#5F6B61" }}>
          ← Voltar
        </button>
      </div>

      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold" style={{ color: "#12231C" }}>Escolha seu plano</h1>
        <p className="text-sm" style={{ color: "#5F6B61" }}>Cancele quando quiser, sem compromisso.</p>
      </div>

      {/* Free plan */}
      <div className="rounded-3xl p-5 space-y-4" style={{ background: "#FFFDF6", border: "1px solid rgba(14,59,46,0.12)" }}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#5F6B61" }}>Gratuito</p>
          <p className="text-3xl font-bold mt-1" style={{ color: "#12231C" }}>R$0<span className="text-base font-normal text-[#5F6B61]">/mês</span></p>
        </div>
        <ul className="space-y-2">
          {FREE_FEATURES.map(f => (
            <li key={f} className="flex items-center gap-2 text-sm" style={{ color: "#12231C" }}>
              <Check className="h-4 w-4 shrink-0" style={{ color: "#5F6B61" }} />
              {f}
            </li>
          ))}
        </ul>
        <button disabled
          className="w-full py-3 rounded-2xl text-sm font-semibold opacity-50"
          style={{ background: "#EEE6D6", color: "#5F6B61" }}>
          Plano atual
        </button>
      </div>

      {/* Premium plan */}
      <div className="rounded-3xl p-5 space-y-4" style={{ background: "linear-gradient(135deg, #0E3B2E 0%, #1A5C45 100%)" }}>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-white/80" />
              <p className="text-xs font-semibold uppercase tracking-widest text-white/80">Premium</p>
            </div>
            <p className="text-3xl font-bold mt-1 text-white">
              R$24,90<span className="text-base font-normal text-white/70">/mês</span>
            </p>
            <p className="text-xs text-white/60 mt-0.5">ou R$199/ano — economize 34%</p>
          </div>
        </div>
        <ul className="space-y-2">
          {PREMIUM_FEATURES.map(f => (
            <li key={f} className="flex items-center gap-2 text-sm text-white">
              <Check className="h-4 w-4 shrink-0 text-white/80" />
              {f}
            </li>
          ))}
        </ul>
        <button
          onClick={() => alert("Em breve! O checkout via Stripe chegará em uma próxima versão.")}
          className="w-full py-3 rounded-2xl text-sm font-semibold text-[#0E3B2E]"
          style={{ background: "#FFFDF6" }}>
          Assinar Premium →
        </button>
      </div>
    </div>
  );
}
