import { useState } from "react";
import { Check, X, ChevronDown, ChevronUp, Layers, AlertTriangle, Star } from "lucide-react";
import {
  useApproveAction,
  useDismissAction,
  useApproveCascadeAll,
  useDismissCascadeAll,
  useListContacts,
  getListContactsQueryKey,
  getListActionsQueryKey,
  getListActionCascadesQueryKey,
  getListInboxItemsQueryKey,
  type ActionCascadeWithActions,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import CategoryBadge from "@/components/CategoryBadge";
import { useToast } from "@/hooks/use-toast";
import { V } from "@/lib/brand";

const TYPE_ICONS: Record<string, string> = {
  event:    "📅",
  task:     "✅",
  reminder: "🔔",
  payment:  "💰",
  fyi:      "ℹ️",
};

function statusColor(status: string) {
  if (status === "approved")  return { bg: "#DCFCE7", fg: "#166534" };
  if (status === "dismissed") return { bg: V.ivory, fg: V.muted };
  return { bg: V.brandSoft, fg: V.brandDeep };
}

type SubItemProps = {
  action: ActionCascadeWithActions["actions"][number];
  cascadeId: number;
  onMutate: () => void;
  selectedProviderId?: number | null;
};

function SubItem({ action, onMutate, index, selectedProviderId }: SubItemProps & { index: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getListActionsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListActionCascadesQueryKey() });
    void qc.invalidateQueries({ queryKey: getListInboxItemsQueryKey() });
    onMutate();
  };

  const approve = useApproveAction({
    mutation: {
      onSuccess: () => { toast({ description: "Aprovado." }); invalidate(); },
      onError: () => toast({ description: "Erro ao aprovar.", variant: "destructive" }),
    },
  });

  const dismiss = useDismissAction({
    mutation: {
      onSuccess: () => { toast({ description: "Dispensado." }); invalidate(); },
      onError: () => toast({ description: "Erro ao dispensar.", variant: "destructive" }),
    },
  });

  const isPending = action.status === "pending";
  const icon = TYPE_ICONS[action.type] ?? "•";
  const sc = statusColor(action.status);

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-xl transition-opacity",
        !isPending && "opacity-60",
      )}
      style={{ background: V.ivory }}
    >
      <span className="text-xs font-bold w-5 shrink-0 text-center" style={{ color: V.muted }}>{index}.</span>
      <span className="text-base shrink-0 leading-none">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug truncate" style={{ color: V.ink }}>{action.title}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <CategoryBadge category={action.category} />
          {!isPending && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
              style={{ background: sc.bg, color: sc.fg }}
            >
              {action.status === "approved" ? "Aprovado" : "Dispensado"}
            </span>
          )}
        </div>
      </div>
      {isPending && (
        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => dismiss.mutate({ id: action.id })}
            disabled={dismiss.isPending || approve.isPending}
            className="w-7 h-7 flex items-center justify-center rounded-lg border transition-colors hover:bg-red-50 disabled:opacity-50"
            style={{ borderColor: V.border }}
            title="Dispensar"
          >
            <X className="w-3.5 h-3.5" style={{ color: V.muted }} />
          </button>
          <button
            onClick={() => approve.mutate({ id: action.id, data: { provider_contact_id: selectedProviderId ?? null } })}
            disabled={approve.isPending || dismiss.isPending}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-green-50 disabled:opacity-50"
            style={{ background: V.brandSoft }}
            title="Aprovar"
          >
            <Check className="w-3.5 h-3.5" style={{ color: V.brand }} />
          </button>
        </div>
      )}
    </div>
  );
}

export default function CascadeCard({ cascade }: { cascade: ActionCascadeWithActions }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showDismissConfirm, setShowDismissConfirm] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<number | null>(null);

  const pendingActions  = cascade.actions.filter((a) => a.status === "pending");
  const resolvedActions = cascade.actions.filter((a) => a.status !== "pending");
  const allResolved     = pendingActions.length === 0;
  const hasServicos = cascade.actions.some((a) => a.category === "servicos");

  // Map keywords in cascade description/titles to a specific service_category
  const SERVICE_CATEGORY_KEYWORDS: Record<string, string> = {
    diarista:       "diarista",
    faxina:         "diarista",
    eletricista:    "eletricista",
    elétrica:       "eletricista",
    encanador:      "encanador",
    encanamento:    "encanador",
    pintor:         "pintor",
    pintura:        "pintor",
    jardineiro:     "jardineiro",
    jardim:         "jardineiro",
    "ar condicionado": "ar_condicionado",
    "ar-condicionado": "ar_condicionado",
    babá:           "babá",
    baba:           "babá",
    cuidador:       "cuidador",
  };
  const cascadeText = [
    cascade.trigger_description,
    ...cascade.actions.map((a) => a.title),
  ].join(" ").toLowerCase();
  const detectedCategory = Object.entries(SERVICE_CATEGORY_KEYWORDS).find(
    ([kw]) => cascadeText.includes(kw),
  )?.[1] ?? null;

  const providerQueryParams = detectedCategory
    ? { service_category: detectedCategory, reliability_status: "preferred,backup" }
    : { reliability_status: "preferred,backup" };

  const { data: preferredProviders } = useListContacts(
    providerQueryParams,
    {
      query: {
        queryKey: getListContactsQueryKey(providerQueryParams),
        enabled: hasServicos,
        staleTime: 60_000,
      },
    },
  );

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getListActionsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListActionCascadesQueryKey() });
    void qc.invalidateQueries({ queryKey: getListInboxItemsQueryKey() });
  };

  const approveAll = useApproveCascadeAll({
    mutation: {
      onSuccess: (data) => {
        toast({ description: `${data.approved ?? 0} ações aprovadas.` });
        invalidate();
      },
      onError: () => toast({ description: "Erro ao aprovar tudo.", variant: "destructive" }),
    },
  });

  const dismissAll = useDismissCascadeAll({
    mutation: {
      onSuccess: (data) => {
        toast({ description: `${data.dismissed ?? 0} ações dispensadas.` });
        setShowDismissConfirm(false);
        invalidate();
      },
      onError: () => toast({ description: "Erro ao dispensar tudo.", variant: "destructive" }),
    },
  });

  const isBusy = approveAll.isPending || dismissAll.isPending;

  // Fully resolved → compact summary row
  if (allResolved) {
    const approved = resolvedActions.filter((a) => a.status === "approved").length;
    return (
      <div
        className="rounded-2xl px-4 py-3 flex items-center gap-2.5 opacity-70"
        style={{ background: V.ivory, border: `1px solid ${V.border}` }}
      >
        <Layers className="w-4 h-4 shrink-0" style={{ color: V.sage }} />
        <p className="text-sm flex-1" style={{ color: V.muted }}>
          <span className="font-medium" style={{ color: V.ink }}>{cascade.trigger_description}</span>
          {" — "}
          {approved}/{cascade.actions.length} resolvidos
        </p>
        <span
          className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
          style={{ background: "#DCFCE7", color: "#166534" }}
        >
          Concluído
        </span>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: V.cream, border: `1px solid ${V.border}` }}
      data-testid={`cascade-card-${cascade.id}`}
    >
      {/* Header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-start gap-2.5 px-4 pt-3.5 pb-3 text-left"
      >
        <Layers className="w-4 h-4 mt-0.5 shrink-0" style={{ color: V.brand }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-snug" style={{ color: V.ink }}>
            {cascade.trigger_description}
          </p>
          <p className="text-xs mt-0.5" style={{ color: V.muted }}>
            {pendingActions.length} de {cascade.actions.length} pendente
            {pendingActions.length !== 1 ? "s" : ""}
          </p>
        </div>
        <span
          className="shrink-0 text-xs font-bold px-2 py-0.5 rounded-full"
          style={{ background: V.brandSoft, color: V.brandDeep }}
        >
          {cascade.actions.length} ações
        </span>
        {collapsed
          ? <ChevronDown className="w-4 h-4 shrink-0" style={{ color: V.muted }} />
          : <ChevronUp   className="w-4 h-4 shrink-0" style={{ color: V.muted }} />
        }
      </button>

      {/* Preferred / backup provider reminder — servicos cascade */}
      {!collapsed && hasServicos && preferredProviders && preferredProviders.length > 0 && (
        <div className="mx-3 mb-2 space-y-1.5">
          {preferredProviders.slice(0, 2).map((p) => {
            const isSelected = selectedProviderId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedProviderId(isSelected ? null : p.id)}
                className="w-full text-left px-3 py-2 rounded-xl flex items-center gap-2 transition-all"
                style={{
                  background: isSelected ? "#DCFCE7" : "#F0FDF4",
                  border: isSelected ? "1.5px solid #16A34A" : "1px solid #BBF7D0",
                }}
              >
                <Star
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: isSelected ? "#15803D" : "#16A34A", fill: isSelected ? "#15803D" : "#16A34A" }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate" style={{ color: "#166534" }}>
                    {p.name}
                    {p.household_rating ? ` ${"⭐".repeat(Math.min(5, p.household_rating))}` : ""}
                  </p>
                  <p className="text-[10px] leading-tight" style={{ color: "#166534", opacity: 0.75 }}>
                    {p.reliability_status === "preferred" ? "Preferido" : "Backup"}
                    {p.service_category ? ` · ${p.service_category}` : ""}
                    {p.last_price_range ? ` · ${p.last_price_range}` : ""}
                  </p>
                </div>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 transition-colors"
                  style={{
                    background: isSelected ? "#15803D" : "#DCFCE7",
                    color: isSelected ? "#fff" : "#166534",
                  }}
                >
                  {isSelected ? "✓ Selecionado" : "Chamar de novo?"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Concierge offer — servicos/backup-care cascade */}
      {!collapsed && hasServicos && (
        <div
          className="mx-3 mb-2 px-3 py-2 rounded-xl flex items-center gap-2"
          style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
          <p className="text-xs leading-snug" style={{ color: "#92400E" }}>
            <span className="font-semibold">Piloto resolve</span> — R$29 e um profissional cuida de tudo por você.
          </p>
        </div>
      )}

      {/* Sub-items */}
      {!collapsed && (
        <div className="px-3 space-y-1.5 pb-3">
          {cascade.actions.map((action, i) => (
            <SubItem
              key={action.id}
              action={action}
              cascadeId={cascade.id}
              index={i + 1}
              onMutate={() => {}}
              selectedProviderId={selectedProviderId}
            />
          ))}
        </div>
      )}

      {/* Footer actions */}
      {!collapsed && pendingActions.length > 0 && (
        <>
          {showDismissConfirm ? (
            <div
              className="border-t px-4 py-3 flex flex-col gap-2"
              style={{ borderColor: V.border }}
            >
              <p className="text-xs text-center" style={{ color: V.muted }}>
                Dispensar todas as {pendingActions.length} ações pendentes?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDismissConfirm(false)}
                  disabled={isBusy}
                  className="flex-1 py-2 rounded-xl border text-sm"
                  style={{ borderColor: V.border, color: V.muted }}
                >
                  Cancelar
                </button>
                <button
                  onClick={() => dismissAll.mutate({ id: cascade.id })}
                  disabled={isBusy}
                  className="flex-1 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
                  style={{ background: "#FEE2E2", color: "#991B1B" }}
                >
                  {dismissAll.isPending ? "Dispensando..." : "Confirmar"}
                </button>
              </div>
            </div>
          ) : (
            <div
              className="border-t flex"
              style={{ borderColor: V.border }}
            >
              <button
                onClick={() => setShowDismissConfirm(true)}
                disabled={isBusy}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm transition-colors hover:bg-red-50 disabled:opacity-50"
                style={{ color: V.muted }}
                data-testid={`cascade-dismiss-all-${cascade.id}`}
              >
                <X className="h-4 w-4" />
                Dispensar tudo
              </button>
              <div className="w-px" style={{ background: V.border }} />
              <button
                onClick={() => approveAll.mutate({ id: cascade.id, data: { provider_contact_id: selectedProviderId ?? null } })}
                disabled={isBusy}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-semibold transition-colors hover:opacity-90 disabled:opacity-50"
                style={{ color: V.brand }}
                data-testid={`cascade-approve-all-${cascade.id}`}
              >
                <Check className="h-4 w-4" />
                {approveAll.isPending ? "Aprovando..." : "Confirmar tudo"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
