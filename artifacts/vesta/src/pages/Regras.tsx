import { useState } from "react";
import { Zap, Plus, TrendingUp, Pause, Play, Trash2, ToggleLeft } from "lucide-react";
import {
  useListRules,
  useCreateRule,
  useToggleRule,
  useDeleteRule,
  useListPatterns,
  useAcceptPattern,
  useDismissPattern,
  getListRulesQueryKey,
  getListPatternsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import CategoryBadge from "@/components/CategoryBadge";
import { CATEGORIES } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const ORIGIN_LABELS: Record<string, string> = {
  system_template:    "Padrão do sistema",
  user_created:       "Criada por você",
  pattern_suggested:  "Sugerida por padrão",
};

export default function RegrasPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    category: "escola",
    trigger_desc: "",
    action_desc: "",
    approval_level: "one_tap",
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
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListRulesQueryKey() }),
    },
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
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListPatternsQueryKey() }),
    },
  });

  return (
    <div className="p-4 space-y-5 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Regras inteligentes</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium"
          data-testid="button-create-rule"
        >
          <Plus className="w-4 h-4" />
          Regra
        </button>
      </div>

      {/* Pattern suggestions */}
      {(patterns?.length ?? 0) > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Padrões detectados</h2>
          <div className="space-y-2">
            {patterns?.map((p) => (
              <div key={p.id} className="bg-card border border-primary/20 rounded-2xl p-4 space-y-2" data-testid={`pattern-${p.id}`}>
                <div className="flex items-start gap-2">
                  <TrendingUp className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <p className="text-sm text-foreground flex-1">
                    Notei que <span className="font-medium">{p.description}</span> aconteceu {p.occurrences} {p.occurrences === 1 ? "vez" : "vezes"}.
                  </p>
                </div>
                {p.evidence && (
                  <p className="text-xs text-muted-foreground pl-6">{p.evidence}</p>
                )}
                <div className="flex gap-2 pl-6">
                  <button
                    onClick={() => dismissPattern.mutate({ id: p.id })}
                    className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-border"
                    data-testid={`dismiss-pattern-${p.id}`}
                  >
                    Ignorar
                  </button>
                  <button
                    onClick={() => acceptPattern.mutate({ id: p.id })}
                    className="text-xs text-primary font-medium px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20"
                    data-testid={`accept-pattern-${p.id}`}
                  >
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
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3 animate-fade-in-up">
          <h3 className="text-sm font-semibold">Nova regra</h3>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Nome da regra"
            className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-rule-name"
          />
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <input
            value={form.trigger_desc}
            onChange={(e) => setForm({ ...form, trigger_desc: e.target.value })}
            placeholder="Quando acontecer... (gatilho)"
            className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-rule-trigger"
          />
          <input
            value={form.action_desc}
            onChange={(e) => setForm({ ...form, action_desc: e.target.value })}
            placeholder="Fazer isso... (ação)"
            className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-rule-action"
          />
          <select
            value={form.approval_level}
            onChange={(e) => setForm({ ...form, approval_level: e.target.value })}
            className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="soft">Automático (silencioso)</option>
            <option value="one_tap">Um toque</option>
            <option value="explicit">Aprovação explícita</option>
          </select>
          <div className="flex gap-2">
            <button onClick={() => setShowCreate(false)} className="flex-1 py-2.5 rounded-xl border border-border text-sm text-muted-foreground">Cancelar</button>
            <button
              onClick={() => createRule.mutate({ data: { name: form.name, category: form.category, trigger_desc: form.trigger_desc, action_desc: form.action_desc, approval_level: form.approval_level } })}
              disabled={!form.name || !form.trigger_desc || !form.action_desc || createRule.isPending}
              className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
              data-testid="button-submit-rule"
            >
              {createRule.isPending ? "Criando..." : "Criar regra"}
            </button>
          </div>
        </div>
      )}

      {/* Rules list */}
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />)}</div>
      ) : !rules?.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Zap className="w-10 h-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">Nenhuma regra criada</p>
          <p className="text-xs text-muted-foreground/60 mt-1 max-w-[200px]">Crie regras para automatizar aprovações recorrentes.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className={cn("bg-card border rounded-2xl p-4 space-y-2 group", rule.active ? "border-border" : "border-border opacity-60")} data-testid={`rule-${rule.id}`}>
              <div className="flex items-start gap-2">
                <Zap className={cn("w-4 h-4 mt-0.5 shrink-0", rule.active ? "text-primary" : "text-muted-foreground")} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">{rule.name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => toggleRule.mutate({ id: rule.id })}
                        className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                        data-testid={`toggle-rule-${rule.id}`}
                      >
                        {rule.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => deleteRule.mutate({ id: rule.id })}
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                        data-testid={`delete-rule-${rule.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <CategoryBadge category={rule.category} className="mt-1" />
                </div>
              </div>

              <div className="ml-6 space-y-1">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/60">Quando: </span>{rule.trigger_desc}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/60">Ação: </span>{rule.action_desc}
                </p>
              </div>

              {/* Confidence + stats */}
              <div className="ml-6 flex items-center gap-3">
                <div className="flex-1">
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${Math.round(rule.confidence * 100)}%` }}
                    />
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground">{Math.round(rule.confidence * 100)}%</span>
                <span className="text-[10px] text-muted-foreground">{rule.times_triggered} disparos</span>
                <span className="text-[10px] text-emerald-600">{rule.times_approved} aprovados</span>
              </div>

              <div className="ml-6">
                <span className="text-[10px] text-muted-foreground">{ORIGIN_LABELS[rule.origin] ?? rule.origin}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
