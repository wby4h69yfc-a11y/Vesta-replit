import { useState } from "react";
import { TrendingUp, Clock, User, Home, AlertCircle, Sun } from "lucide-react";
import {
  useListPatterns,
  useDismissPattern,
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

function PatternIcon({ type }: { type: string }) {
  const cls = "w-4 h-4 mt-0.5 shrink-0";
  const col = { color: V.primary };
  switch (type) {
    case "temporal":  return <Clock         className={cls} style={col} />;
    case "sender":    return <User          className={cls} style={col} />;
    case "ownership": return <Home          className={cls} style={col} />;
    case "absence":   return <AlertCircle  className={cls} style={col} />;
    case "seasonal":  return <Sun           className={cls} style={col} />;
    default:          return <TrendingUp    className={cls} style={col} />;
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

export default function PatternSuggestions({ onAcceptClick }: PatternSuggestionsProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: patterns } = useListPatterns({ status: "suggested" });
  const [dismissingIds, setDismissingIds] = useState<number[]>([]);

  const dismissPattern = useDismissPattern({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListPatternsQueryKey() });
      },
      onError: () => {
        toast({ description: "Erro ao ignorar padrão.", variant: "destructive" });
      },
    },
  });

  function handleDismiss(id: number) {
    setDismissingIds((prev) => [...prev, id]);
    setTimeout(() => dismissPattern.mutate({ id }), 220);
  }

  function handleAccept(pattern: PatternObservation) {
    const prefill: PrefillRule = {
      name: pattern.description,
      category: "outros",
      trigger_desc: pattern.description,
      action_desc: "",
    };
    onAcceptClick?.(pattern, prefill);
  }

  if (!patterns?.length) return null;

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: V.muted }}>
        Padrões detectados
      </h2>
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
                  disabled={isDismissing}
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
    </section>
  );
}
