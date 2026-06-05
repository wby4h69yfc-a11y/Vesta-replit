import { useState } from "react";
import { Check, X, Edit2, AlertTriangle, DollarSign, Banknote, CalendarClock } from "lucide-react";
import { useApproveAction, useDismissAction, useEditAction, getListActionsQueryKey, getListInboxItemsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import CategoryBadge from "@/components/CategoryBadge";
import { formatDateTime } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import PaymentSafetyChecklist from "@/components/PaymentSafetyChecklist";

type PaymentData = {
  amount_cents?: number | null;
  recipient?: string | null;
  due_date?: string | null;
  payment_method?: string | null;
};

type Action = {
  id: number;
  title: string;
  type: string;
  category: string;
  datetime?: string | null;
  suggested_owner?: string | null;
  approval_level: string;
  confidence: number;
  status: string;
  notes?: string | null;
  cascade_check_needed?: boolean;
  workflow_tags?: string[];
  payment_data?: PaymentData | null;
};

export default function ApprovalCard({ action, compact = false }: { action: Action; compact?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState(action.title);
  const [editNotes, setEditNotes] = useState(action.notes ?? "");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListActionsQueryKey() });
    qc.invalidateQueries({ queryKey: getListInboxItemsQueryKey() });
  };

  const approve = useApproveAction({
    mutation: {
      onSuccess: () => { invalidate(); toast({ description: "Aprovado." }); },
    },
  });

  const dismiss = useDismissAction({
    mutation: {
      onSuccess: () => { invalidate(); toast({ description: "Descartado." }); },
    },
  });

  const edit = useEditAction({
    mutation: {
      onSuccess: () => { invalidate(); toast({ description: "Salvo e aprovado." }); },
    },
  });

  if (action.status !== "pending") return null;

  const isPayment = action.workflow_tags?.includes("payment_admin");

  if (action.approval_level === "soft") {
    return (
      <div className="flex items-start gap-3 px-4 py-3 bg-card rounded-xl border border-border animate-fade-in-up" data-testid={`action-card-${action.id}`}>
        <div className="flex-1 min-w-0">
          <CategoryBadge category={action.category} />
          <p className="mt-1 text-sm text-foreground font-medium leading-snug">{action.title}</p>
          {action.datetime && (
            <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(action.datetime)}</p>
          )}
        </div>
        <button
          onClick={() => dismiss.mutate({ id: action.id })}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors py-1 px-2 rounded"
          data-testid={`dismiss-soft-${action.id}`}
        >
          Desfazer
        </button>
      </div>
    );
  }

  if (action.approval_level === "one_tap") {
    return (
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm animate-fade-in-up" data-testid={`action-card-${action.id}`}>
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <CategoryBadge category={action.category} />
              {isPayment && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                  <DollarSign className="w-3 h-3" />R$
                </span>
              )}
              {action.cascade_check_needed && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
                  <AlertTriangle className="w-3 h-3" />Verificar
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground shrink-0">{Math.round(action.confidence * 100)}%</span>
          </div>
          <p className="text-[15px] font-semibold leading-snug text-foreground">{action.title}</p>
          {action.datetime && (
            <p className="text-xs text-muted-foreground mt-1">{formatDateTime(action.datetime)}</p>
          )}
          {action.suggested_owner && (
            <p className="text-xs text-muted-foreground mt-0.5">Responsável: {action.suggested_owner}</p>
          )}
        </div>

        <div className="flex border-t border-border">
          <button
            onClick={() => dismiss.mutate({ id: action.id })}
            disabled={dismiss.isPending}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
            data-testid={`dismiss-${action.id}`}
          >
            <X className="w-4 h-4" />
            Descartar
          </button>
          <div className="w-px bg-border" />
          <button
            onClick={() => approve.mutate({ id: action.id, data: {} })}
            disabled={approve.isPending}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-semibold text-primary hover:bg-primary/5 transition-colors"
            data-testid={`approve-${action.id}`}
          >
            <Check className="w-4 h-4" />
            Aprovar
          </button>
        </div>
      </div>
    );
  }

  // explicit
  return (
    <div className="bg-card border-2 border-primary/20 rounded-2xl overflow-hidden shadow-sm animate-fade-in-up" data-testid={`action-card-${action.id}`}>
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <CategoryBadge category={action.category} />
            {isPayment && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                <DollarSign className="w-3 h-3" />R$
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground">{Math.round(action.confidence * 100)}%</span>
        </div>

        {editMode ? (
          <div className="space-y-2">
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid={`edit-title-${action.id}`}
            />
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Notas..."
              rows={2}
              className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>
        ) : (
          <>
            <p className="text-[15px] font-semibold leading-snug text-foreground">{action.title}</p>
            {action.datetime && (
              <p className="text-xs text-muted-foreground mt-1">{formatDateTime(action.datetime)}</p>
            )}
            {action.notes && (
              <p className="text-xs text-muted-foreground mt-1 italic">{action.notes}</p>
            )}
          </>
        )}

        {/* Payment section for payment_admin actions */}
        {isPayment && action.payment_data && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4" style={{ color: "#059669" }} />
              <span className="text-xs font-bold uppercase tracking-wide text-emerald-700">Pagamento</span>
            </div>
            <div className="rounded-xl px-3 py-2.5 space-y-1.5" style={{ background: "rgba(5,150,105,0.06)", border: "1px solid rgba(5,150,105,0.15)" }}>
              {action.payment_data.amount_cents && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Valor</span>
                  <span className="text-sm font-bold text-emerald-700">
                    R$&nbsp;{(action.payment_data.amount_cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              )}
              {action.payment_data.recipient && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Para</span>
                  <span className="text-sm font-medium text-foreground">{action.payment_data.recipient}</span>
                </div>
              )}
              {action.payment_data.due_date && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <CalendarClock className="w-3 h-3" />Vencimento
                  </span>
                  <span className="text-sm font-medium text-foreground">
                    {action.payment_data.due_date.split("-").reverse().join("/")}
                  </span>
                </div>
              )}
              {action.payment_data.payment_method && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Banknote className="w-3 h-3" />Método
                  </span>
                  <span className="text-sm font-medium text-foreground capitalize">{action.payment_data.payment_method}</span>
                </div>
              )}
            </div>
            <PaymentSafetyChecklist
              payment={{
                recipient:      action.payment_data.recipient,
                amount_cents:   action.payment_data.amount_cents,
                description:    action.title,
                due_date:       action.payment_data.due_date,
                payment_method: action.payment_data.payment_method,
              }}
            />
          </div>
        )}
      </div>

      <div className="flex border-t border-border">
        <button
          onClick={() => dismiss.mutate({ id: action.id })}
          disabled={dismiss.isPending}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
          data-testid={`dismiss-explicit-${action.id}`}
        >
          <X className="w-4 h-4" />
          Descartar
        </button>
        <div className="w-px bg-border" />
        <button
          onClick={() => {
            if (editMode) {
              edit.mutate({ id: action.id, data: { title: editTitle, notes: editNotes } });
            } else {
              setEditMode(true);
            }
          }}
          disabled={edit.isPending}
          className="flex items-center justify-center gap-1.5 py-3 px-4 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          data-testid={`edit-${action.id}`}
        >
          <Edit2 className="w-4 h-4" />
          {editMode ? "Salvar" : "Editar"}
        </button>
        <div className="w-px bg-border" />
        <button
          onClick={() => approve.mutate({ id: action.id, data: {} })}
          disabled={approve.isPending || editMode}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-semibold text-primary hover:bg-primary/5 transition-colors disabled:opacity-40"
          data-testid={`approve-explicit-${action.id}`}
        >
          <Check className="w-4 h-4" />
          Aprovar
        </button>
      </div>
    </div>
  );
}
