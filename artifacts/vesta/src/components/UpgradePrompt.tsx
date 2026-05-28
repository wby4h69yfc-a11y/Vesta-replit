import { X, Sparkles } from "lucide-react";
import { useLocation } from "wouter";

const V = { primary: "#0E3B2E", cream: "#FFFDF6", beige: "#EEE6D6", ink: "#12231C", muted: "#5F6B61" };

interface UpgradePromptProps {
  limitLabel: string;
  onClose: () => void;
}

export default function UpgradePrompt({ limitLabel, onClose }: UpgradePromptProps) {
  const [, navigate] = useLocation();
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-lg rounded-t-3xl p-6 space-y-5 animate-fade-in-up"
        style={{ background: V.cream }}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose}
          className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-full"
          style={{ background: V.beige }}>
          <X className="h-4 w-4" style={{ color: V.muted }} />
        </button>

        <div className="flex items-start gap-4 pr-8">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: "#EAF1E5" }}>
            <Sparkles className="h-6 w-6" style={{ color: V.primary }} />
          </div>
          <div>
            <p className="text-sm font-bold" style={{ color: V.ink }}>Limite do plano gratuito</p>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: V.muted }}>{limitLabel}</p>
          </div>
        </div>

        <div className="rounded-2xl p-4 space-y-1.5"
          style={{ background: "linear-gradient(135deg, #0E3B2E 0%, #1A5C45 100%)" }}>
          <p className="text-white font-semibold text-sm">Upgrade para Premium</p>
          <p className="text-white/70 text-xs">Membros ilimitados, regras ilimitadas e muito mais.</p>
          <p className="text-white font-bold text-base mt-1">
            R$24,90<span className="font-normal text-white/70 text-xs">/mês</span>
            <span className="text-white/60 text-xs ml-2">ou R$199/ano (economize 34%)</span>
          </p>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-3 rounded-2xl text-sm font-semibold"
            style={{ background: V.beige, color: V.ink }}>
            Agora não
          </button>
          <button onClick={() => { onClose(); navigate("/planos"); }}
            className="flex-1 py-3 rounded-2xl text-sm font-semibold text-white"
            style={{ background: V.primary }}>
            Ver planos →
          </button>
        </div>
      </div>
    </div>
  );
}
