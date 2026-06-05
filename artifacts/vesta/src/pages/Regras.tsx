import { useState } from "react";
import { Zap, Plus, Pause, Play, Trash2, Lock, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";
import {
  useListRules,
  useCreateRule,
  useToggleRule,
  useDeleteRule,
  useGetHouseholdPlanStatus,
  useListRuleTemplates,
  useActivateRuleTemplate,
  getListRulesQueryKey,
  getListRuleTemplatesQueryKey,
  type PatternObservation,
  type RuleTemplate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import CategoryBadge from "@/components/CategoryBadge";
import { CATEGORIES } from "@/lib/categories";
import { cn, isUpgradeError } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import UpgradePrompt from "@/components/UpgradePrompt";
import PatternSuggestions from "@/components/PatternSuggestions";
import { V } from "@/lib/brand";

const ORIGIN_LABELS: Record<string, string> = {
  system_template:    "Padrão do sistema",
  user_created:       "Criada por você",
  pattern_suggested:  "Sugerida por padrão",
};

const CATEGORY_META: Record<string, { label: string; emoji: string; bg: string; fg: string }> = {
  escola:    { label: "Escola",    emoji: "🏫", bg: "#EAF1E5", fg: "#166534" },
  saude:     { label: "Saúde",     emoji: "🏥", bg: "#FEF3C7", fg: "#854D0E" },
  diarista:  { label: "Diarista",  emoji: "🧹", bg: "#EDE9FE", fg: "#5B21B6" },
  casa:      { label: "Casa",      emoji: "🏠", bg: "#FEF9C3", fg: "#713F12" },
  social:    { label: "Social",    emoji: "👥", bg: "#FCE7F3", fg: "#9D174D" },
  logistica: { label: "Logística", emoji: "📦", bg: "#ECFEFF", fg: "#164E63" },
  outros:    { label: "Outros",    emoji: "⚡",  bg: V.ivory,   fg: V.muted  },
};

const APPROVAL_LABELS: Record<string, string> = {
  soft:     "Automático",
  one_tap:  "Um toque",
  explicit: "Manual",
};

const CATEGORY_ORDER = ["escola", "saude", "diarista", "casa"];

/* ── TemplateCard ── */
function TemplateCard({
  template,
  rulesAtLimit,
  onLimitHit,
}: {
  template: RuleTemplate;
  rulesAtLimit: boolean;
  onLimitHit: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const cat = CATEGORY_META[template.category] ?? CATEGORY_META.outros;

  const activate = useActivateRuleTemplate({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListRulesQueryKey() });
        void qc.invalidateQueries({ queryKey: getListRuleTemplatesQueryKey() });
        toast({ description: `"${template.name}" ativada ✓` });
      },
      onError: (e: unknown) => {
        if (isUpgradeError(e)) {
          onLimitHit();
        } else {
          toast({ description: "Erro ao ativar modelo.", variant: "destructive" });
        }
      },
    },
  });

  const approvalLabel = APPROVAL_LABELS[template.action_config?.approval_level ?? "one_tap"] ?? "Um toque";

  return (
    <div
      className="rounded-2xl p-4 space-y-2.5 flex flex-col"
      style={{
        background: template.activated ? "#F0FDF4" : V.cream,
        border: `1px solid ${template.activated ? "rgba(16,185,129,0.25)" : "rgba(14,59,46,0.10)"}`,
        opacity: template.activated ? 0.9 : 1,
      }}
      data-testid={`template-card-${template.slug}`}
    >
      {/* Header: category chip + approval level */}
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
          style={{ background: cat.bg, color: cat.fg }}
        >
          {cat.emoji} {cat.label}
        </span>
        <span className="text-[10px]" style={{ color: V.muted }}>{approvalLabel}</span>
      </div>

      {/* Name + description */}
      <div>
        <p className="text-sm font-semibold leading-snug" style={{ color: V.ink }}>{template.name}</p>
        <p className="text-xs leading-relaxed mt-1" style={{ color: V.muted }}>{template.description}</p>
      </div>

      {/* CTA */}
      {template.activated ? (
        <div className="flex items-center gap-1.5 mt-auto pt-1">
          <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "#059669" }} />
          <span className="text-xs font-semibold" style={{ color: "#059669" }}>Ativa</span>
        </div>
      ) : (
        <button
          onClick={() => {
            if (rulesAtLimit) { onLimitHit(); return; }
            activate.mutate({ id: template.id });
          }}
          disabled={activate.isPending}
          className="mt-auto pt-1 w-full py-2 rounded-xl text-xs font-semibold transition-opacity disabled:opacity-50"
          style={{ background: V.primary, color: "white" }}
          data-testid={`activate-template-${template.slug}`}
        >
          {activate.isPending ? "Ativando…" : "Ativar"}
        </button>
      )}
    </div>
  );
}

/* ── SuggestedRulesSection ── */
function SuggestedRulesSection({
  rulesAtLimit,
  onLimitHit,
}: {
  rulesAtLimit: boolean;
  onLimitHit: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const { data: templates = [], isLoading } = useListRuleTemplates();

  const inactiveCount = templates.filter((t) => !t.activated).length;

  // Group by category in defined order
  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    meta: CATEGORY_META[cat] ?? CATEGORY_META.outros,
    items: templates.filter((t) => t.category === cat),
  })).filter((g) => g.items.length > 0);

  if (isLoading || templates.length === 0) return null;

  return (
    <section data-testid="suggested-rules-section">
      {/* Section header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between mb-3"
      >
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4" style={{ color: V.primary }} />
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: V.muted }}>
            Regras sugeridas
          </h2>
          {inactiveCount > 0 && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: V.primary, color: "white" }}
            >
              {inactiveCount}
            </span>
          )}
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4" style={{ color: V.muted }} />
          : <ChevronDown className="w-4 h-4" style={{ color: V.muted }} />
        }
      </button>

      {expanded && (
        <div className="space-y-4">
          {grouped.map(({ cat, meta, items }) => (
            <div key={cat}>
              <p
                className="text-[10px] font-bold uppercase tracking-widest mb-2 px-1"
                style={{ color: meta.fg }}
              >
                {meta.emoji} {meta.label}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {items.map((t) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    rulesAtLimit={rulesAtLimit}
                    onLimitHit={onLimitHit}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ── Main page ── */
export default function RegrasPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeLabel, setUpgradeLabel] = useState("");
  const [pendingPattern, setPendingPattern] = useState<PatternObservation | null>(null);
  const [form, setForm] = useState({
    name: "",
    category: "escola",
    trigger_desc: "",
    action_desc: "",
    approval_level: "one_tap",
  });

  const { data: rules, isLoading } = useListRules();
  const { data: planStatus } = useGetHouseholdPlanStatus();

  const rulesLimit = planStatus?.limits?.rules ?? null;
  const rulesUsage = planStatus?.usage?.rules ?? 0;
  const rulesAtLimit = rulesLimit !== null && rulesUsage >= rulesLimit;

  function showUpgradePrompt() {
    setUpgradeLabel(`Plano gratuito: máximo de ${rulesLimit ?? 3} regras inteligentes.`);
    setShowUpgrade(true);
  }

  const createRule = useCreateRule({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListRulesQueryKey() });
        setShowCreate(false);
        setPendingPattern(null);
        setForm({ name: "", category: "escola", trigger_desc: "", action_desc: "", approval_level: "one_tap" });
        toast({ description: "Regra criada." });
      },
      onError: (e: unknown) => {
        if (isUpgradeError(e)) {
          showUpgradePrompt();
        } else {
          toast({ description: "Erro ao criar regra.", variant: "destructive" });
        }
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

  return (
    <div className="p-4 space-y-5 animate-fade-in-up">
      {showUpgrade && <UpgradePrompt limitLabel={upgradeLabel} onClose={() => setShowUpgrade(false)} />}

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Regras inteligentes</h1>
        {rulesAtLimit ? (
          <button
            onClick={showUpgradePrompt}
            title={`Limite atingido — plano gratuito: máximo de ${rulesLimit} regras`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium"
            style={{ background: "#EEE6D6", color: "#5F6B61" }}
            data-testid="button-create-rule"
          >
            <Lock className="w-4 h-4" />
            Regra
          </button>
        ) : (
          <button
            onClick={() => { setPendingPattern(null); setShowCreate(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium"
            data-testid="button-create-rule"
          >
            <Plus className="w-4 h-4" />
            Regra
          </button>
        )}
      </div>

      {/* Pre-built template library — shown above custom rules */}
      <SuggestedRulesSection
        rulesAtLimit={rulesAtLimit}
        onLimitHit={showUpgradePrompt}
      />

      <PatternSuggestions
        onAcceptClick={(pattern, prefill) => {
          setPendingPattern(pattern);
          setForm({ ...prefill, approval_level: "one_tap" });
          setShowCreate(true);
        }}
      />

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
            <button onClick={() => { setPendingPattern(null); setShowCreate(false); }} className="flex-1 py-2.5 rounded-xl border border-border text-sm text-muted-foreground">Cancelar</button>
            <button
              onClick={() => createRule.mutate({ data: { name: form.name, category: form.category, trigger_desc: form.trigger_desc, action_desc: form.action_desc, approval_level: form.approval_level as import("@workspace/api-client-react").RuleInputApprovalLevel, ...(pendingPattern ? { pattern_id: pendingPattern.id } : {}) } })}
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
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Zap className="w-10 h-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">Nenhuma regra ativa ainda</p>
          <p className="text-xs text-muted-foreground/60 mt-1 max-w-[220px]">Ative uma regra sugerida acima ou crie a sua própria.</p>
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
                <span className="text-[10px] text-muted-foreground">{rule.origin ? (ORIGIN_LABELS[rule.origin as keyof typeof ORIGIN_LABELS] ?? rule.origin) : ""}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
