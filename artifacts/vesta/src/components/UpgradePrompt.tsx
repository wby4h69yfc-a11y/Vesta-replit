import { X, Sparkles } from "lucide-react";
import { useLocation } from "wouter";
import { V } from "@/lib/brand";

interface UpgradePromptProps {
  limitLabel: string;
  onClose: () => void;
  used?: number;
  limit?: number;
}

export default function UpgradePrompt({ limitLabel, onClose, used, limit }: UpgradePromptProps) {
  const [, navigate] = useLocation();
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-lg rounded-t-3xl p-6 space-y-5 animate-fade-in-up"
        style={{ background: V.bg }}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose}
          className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-full"
          style={{ background: V.surfaceMed }}>
          <X className="h-4 w-4" style={{ color: V.fgMuted }} />
        </button>

        <div className="flex items-start gap-4 pr-8">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: V.brandSoft }}>
            <Sparkles className="h-6 w-6" style={{ color: V.brand }} />
          </div>
          <div>
            <p className="text-sm font-bold" style={{ color: V.fg }}>Limite do plano gratuito</p>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: V.fgMuted }}>{limitLabel}</p>
          </div>
        </div>

        {used !== undefined && limit !== undefined && (
          <div className="space-y-1.5 px-1">
            <div className="flex items-center justify-between text-xs" style={{ color: V.fgMuted }}>
              <span><strong style={{ color: V.fg }}>{used}</strong> de {limit} usados</span>
              {limit - used > 0
                ? <span>{limit - used} restante{limit - used !== 1 ? "s" : ""}</span>
                : <span style={{ color: "#DC2626" }}>Limite atingido</span>
              }
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: V.surfaceMed }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, Math.round((used / limit) * 100))}%`,
                  background: used >= limit ? "#DC2626" : V.brand,
                }}
              />
            </div>
          </div>
        )}

        <div className="rounded-2xl p-4 space-y-1.5"
          style={{ background: `linear-gradient(135deg, ${V.surfaceDeep} 0%, #2D1F15 100%)` }}>
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
            style={{ background: V.surfaceMed, color: V.fg }}>
            Agora não
          </button>
          <button onClick={() => { onClose(); navigate("/planos"); }}
            className="flex-1 py-3 rounded-2xl text-sm font-semibold text-white"
            style={{ background: V.brand }}>
            Ver planos →
          </button>
        </div>
      </div>
    </div>
  );
}
