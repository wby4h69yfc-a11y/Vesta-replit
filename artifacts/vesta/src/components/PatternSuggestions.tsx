import { useState } from "react";
import { TrendingUp, Clock, User, Home, AlertCircle, Sun, Sparkles } from "lucide-react";
import {
  useListPatterns,
  useDismissPattern,
  useAcceptPattern,
  getListPatternsQueryKey,
  type PatternObservation,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const V = {
  primary: "#0E3B2E",
  cream:   "#FFFDF6",
  beige:   "#EEE6D6",
  ink:     "#12231C",
  muted:   "#5F6B61",
};

const ACTIONABLE_STATUSES = new Set(["suggested", "threshold_met"]);

function PatternIcon({ type }: { type: string }) {
  const cls = "w-4 h-4 mt-0.5 shrink-0";
  const col = { color: V.primary };
  switch (type) {
    case "temporal":  return <Clock        className={cls} style={col} />;
    case "sender":    return <User         className={cls} style={col} />;
    case "ownership": return <Home         className={cls} style={col} />;
    case "absence":   return <AlertCircle  className={cls} style={col} />;
    case "seasonal":  return <Sun          className={cls} style={col} />;
    default:          return <TrendingUp   className={cls} style={col} />;
  }
}

export interface PrefillRule {
  name: string;
  category: string;
  trigger_desc: string;
  action_desc: string;
}

interface PatternSuggestionsProps {
  onAcceptClick?: (pattern: PatternObservation, prefill: PrefillRule) => void;
}

function PatternSkeleton() {
  return (
    <div className="rounded-2xl p-4 space-y-3 animate-pulse" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
      <div className="flex items-start gap-2">
        <div className="w-4 h-4 mt-0.5 rounded-full bg-muted shrink-0" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 rounded bg-muted w-3/4" />
          <div className="h-3 rounded bg-muted w-1/2" />
        </div>
      </div>
      <div className="pl-6 flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full bg-muted" />
        <div className="h-3 w-20 rounded bg-muted" />
      </div>
    </div>
  );
}

export default function PatternSuggestions({ onAcceptClick }: PatternSuggestionsProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: allPatterns, isLoading } = useListPatterns();
  const [dismissingIds, setDismissingIds] = useState<number[]>([]);
  const [acceptingIds, setAcceptingIds] = useState<number[]>([]);

  const patterns = allPatterns?.filter(
    (p) => ACTIONABLE_STATUSES.has(p.status) && !dismissingIds.includes(p.id),
  ) ?? [];

  const dismissPattern = useDismissPattern({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListPatternsQueryKey() });
      },
      onError: (_err, variables) => {
        setDismissingIds((prev) => prev.filter((id) => id !== variables.id));
        toast({ description: "Erro ao ignorar padrão.", variant: "destructive" });
      },
    },
  });

  const acceptPattern = useAcceptPattern({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListPatternsQueryKey() });
      },
      onError: (_err, variables) => {
        setAcceptingIds((prev) => prev.filter((id) => id !== variables.id));
        toast({ description: "Erro ao aceitar padrão.", variant: "destructive" });
      },
    },
  });

  function handleDismiss(id: number) {
    setDismissingIds((prev) => [...prev, id]);
    setTimeout(() => dismissPattern.mutate({ id }), 220);
  }

  function categoryFromType(type: string): string {
    switch (type) {
      case "temporal":  return "escola";
      case "sender":    return "escola";
      case "sequence":  return "escola";
      case "ownership": return "casa";
      case "absence":   return "escola";
      case "seasonal":  return "escola";
      default:          return "outros";
    }
  }

  function handleAccept(pattern: PatternObservation) {
    const prefill: PrefillRule = {
      name: pattern.description,
      category: categoryFromType(pattern.type),
      trigger_desc: pattern.description,
      action_desc: "",
    };
    setAcceptingIds((prev) => [...prev, pattern.id]);
    acceptPattern.mutate({ id: pattern.id });
    onAcceptClick?.(pattern, prefill);
  }

  return (
    <section data-testid="pattern-suggestions-section">
      <h2 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: V.muted }}>
        Padrões detectados
      </h2>

      {isLoading ? (
        <div className="space-y-2">
          <PatternSkeleton />
          <PatternSkeleton />
        </div>
      ) : patterns.length === 0 ? (
        <div
          className="rounded-2xl p-4 flex items-start gap-3"
          style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}
          data-testid="pattern-empty-state"
        >
          <Sparkles className="w-4 h-4 mt-0.5 shrink-0 opacity-40" style={{ color: V.primary }} />
          <p className="text-xs leading-relaxed" style={{ color: V.muted }}>
            Ainda não detectei padrões suficientes. À medida que você usa o WhatsApp, vou aprender suas rotinas e sugerir regras automáticas.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {patterns.map((p) => {
            const isDismissing = dismissingIds.includes(p.id);
            return (
              <div
                key={p.id}
                className="rounded-2xl p-4 space-y-2"
                style={{
                  background: V.cream,
                  border: "1px solid rgba(14,59,46,0.12)",
                  opacity: isDismissing ? 0 : 1,
                  transform: isDismissing ? "scale(0.97)" : "scale(1)",
                  transition: "opacity 220ms ease, transform 220ms ease",
                }}
                data-testid={`pattern-${p.id}`}
              >
                <div className="flex items-start gap-2">
                  <PatternIcon type={p.type} />
                  <p className="text-sm flex-1" style={{ color: V.ink }}>
                    Notei que <span className="font-medium">{p.description}</span> aconteceu{" "}
                    {p.occurrences} {p.occurrences === 1 ? "vez" : "vezes"}.
                  </p>
                </div>

                {p.evidence && (
                  <p className="text-xs pl-6" style={{ color: V.muted }}>{p.evidence}</p>
                )}

                <div className="pl-6 flex items-center gap-2">
                  <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: V.beige }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.round(p.confidence * 100)}%`, background: V.primary }}
                    />
                  </div>
                  <span className="text-[10px] shrink-0" style={{ color: V.muted }}>
                    {Math.round(p.confidence * 100)}% de confiança
                  </span>
                </div>

                <div className="flex gap-2 pl-6">
                  <button
                    onClick={() => handleDismiss(p.id)}
                    disabled={isDismissing || dismissPattern.isPending}
                    className="text-xs px-3 py-1.5 rounded-lg border disabled:opacity-50 transition-opacity"
                    style={{ color: V.muted, borderColor: "rgba(14,59,46,0.15)" }}
                    data-testid={`dismiss-pattern-${p.id}`}
                  >
                    Ignorar
                  </button>
                  <button
                    onClick={() => handleAccept(p)}
                    disabled={isDismissing || acceptingIds.includes(p.id)}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50 transition-opacity"
                    style={{ background: "#EAF1E5", color: V.primary }}
                    data-testid={`accept-pattern-${p.id}`}
                  >
                    Criar regra
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
