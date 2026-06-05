import { useState } from "react";
import { Users, ChevronDown, ChevronUp, Check, X, AlertTriangle, Info } from "lucide-react";
import {
  useApproveAction,
  useDismissAction,
  useApproveCascadeAll,
  useDismissCascadeAll,
  getListActionsQueryKey,
  getListActionCascadesQueryKey,
  getListInboxItemsQueryKey,
  type ActionCascadeWithActions,
  type SuggestedAction,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { V } from "@/lib/brand";

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: getListActionsQueryKey() });
  void qc.invalidateQueries({ queryKey: getListActionCascadesQueryKey() });
  void qc.invalidateQueries({ queryKey: getListInboxItemsQueryKey() });
}

function TriageActionRow({ action, onDone }: { action: SuggestedAction; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const approve = useApproveAction({
    mutation: {
      onSuccess: () => { invalidateAll(qc); toast({ description: "Aprovado." }); onDone(); },
      onError:   () => toast({ description: "Erro ao aprovar.", variant: "destructive" }),
    },
  });
  const dismiss = useDismissAction({
    mutation: {
      onSuccess: () => { invalidateAll(qc); toast({ description: "Ignorado." }); onDone(); },
      onError:   () => toast({ description: "Erro ao ignorar.", variant: "destructive" }),
    },
  });

  const isLoading = approve.isPending || dismiss.isPending;

  return (
    <div className="flex items-center gap-2 py-2" style={{ borderBottom: "1px solid rgba(14,59,46,0.07)" }}>
      <p className="flex-1 text-sm leading-snug" style={{ color: V.ink }}>{action.title}</p>
      <button
        onClick={() => dismiss.mutate({ id: action.id })}
        disabled={isLoading}
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-red-50 disabled:opacity-40"
        style={{ color: V.muted }}
        aria-label="Ignorar"
      >
        <X className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => approve.mutate({ id: action.id, data: {} })}
        disabled={isLoading}
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-green-50 disabled:opacity-40"
        style={{ color: V.primary }}
        aria-label="Aprovar"
      >
        <Check className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default function ParentGroupTriageCard({ cascade }: { cascade: ActionCascadeWithActions }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(true);
  const [done, setDone] = useState<Set<number>>(new Set());

  const markDone = (id: number) => setDone((prev) => new Set([...prev, id]));

  const approveAll = useApproveCascadeAll({
    mutation: {
      onSuccess: () => {
        invalidateAll(qc);
        toast({ description: "Todos aprovados." });
      },
    },
  });
  const dismissAll = useDismissCascadeAll({
    mutation: {
      onSuccess: () => {
        invalidateAll(qc);
        toast({ description: "Todos ignorados." });
      },
    },
  });

  const actions = (cascade.actions ?? []).filter((a) => !done.has(a.id) && a.status === "pending");
  const actionRequired = actions.filter((a) => a.approval_level === "explicit" || a.approval_level === "one_tap");
  const fyiItems       = actions.filter((a) => a.approval_level === "soft");

  if (actions.length === 0) return null;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.12)" }}
      data-testid={`cascade-triage-${cascade.id}`}
    >
      {/* Header */}
      <button
        className="w-full flex items-start gap-3 px-4 pt-3 pb-3 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: "#EAF1E5" }}>
          <Users className="w-3.5 h-3.5" style={{ color: V.primary }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: V.sage }}>
            Grupo de pais
          </p>
          <p className="text-sm font-semibold leading-snug" style={{ color: V.ink }}>
            {cascade.trigger_description}
          </p>
          <p className="text-xs mt-0.5" style={{ color: V.muted }}>
            {actionRequired.length} para aprovar{fyiItems.length > 0 ? ` · ${fyiItems.length} aviso${fyiItems.length !== 1 ? "s" : ""}` : ""}
          </p>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 mt-1 shrink-0" style={{ color: V.muted }} />
          : <ChevronDown className="w-4 h-4 mt-1 shrink-0" style={{ color: V.muted }} />
        }
      </button>

      {/* Expanded body */}
      {expanded && (
        <>
          {actionRequired.length > 0 && (
            <div className="px-4 pb-1 pt-1">
              <div className="flex items-center gap-1.5 mb-1">
                <AlertTriangle className="w-3 h-3" style={{ color: "#B45309" }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#B45309" }}>
                  Ação necessária
                </span>
              </div>
              {actionRequired.map((a) => (
                <TriageActionRow key={a.id} action={a} onDone={() => markDone(a.id)} />
              ))}
            </div>
          )}

          {fyiItems.length > 0 && (
            <div className="px-4 pb-1 pt-1">
              <div className="flex items-center gap-1.5 mb-1">
                <Info className="w-3 h-3" style={{ color: V.sage }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: V.muted }}>
                  Só para saber
                </span>
              </div>
              {fyiItems.map((a) => (
                <TriageActionRow key={a.id} action={a} onDone={() => markDone(a.id)} />
              ))}
            </div>
          )}

          {/* Bulk actions */}
          <div className="flex border-t mt-1" style={{ borderColor: "rgba(14,59,46,0.08)" }}>
            <button
              onClick={() => dismissAll.mutate({ id: cascade.id })}
              disabled={dismissAll.isPending || approveAll.isPending}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs transition-colors hover:bg-red-50 disabled:opacity-50",
              )}
              style={{ color: V.muted }}
            >
              <X className="w-3.5 h-3.5" />
              Ignorar tudo
            </button>
            <div className="w-px" style={{ background: "rgba(14,59,46,0.08)" }} />
            <button
              onClick={() => approveAll.mutate({ id: cascade.id })}
              disabled={approveAll.isPending || dismissAll.isPending}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors hover:bg-green-50 disabled:opacity-50"
              style={{ color: V.primary }}
            >
              <Check className="w-3.5 h-3.5" />
              Aprovar tudo
            </button>
          </div>
        </>
      )}
    </div>
  );
}
