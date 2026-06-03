import { useState, useEffect } from "react";
import { Plus, MessageCircle, Mail, Camera, PenLine, RefreshCw, Brain, CheckCircle2, X } from "lucide-react";
import {
  useListInboxItems,
  useListActions,
  useCreateInboxItem,
  useClassifyInboxItem,
  useListMemoryStaging,
  useConfirmMemoryStaging,
  useDismissMemoryStaging,
  getListInboxItemsQueryKey,
  getListActionsQueryKey,
  getListMemoryStagingQueryKey,
  type SuggestedAction,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import ApprovalCard from "@/components/ApprovalCard";
import CategoryBadge from "@/components/CategoryBadge";
import { formatRelativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

import { V } from "@/lib/brand";

const SOURCE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  whatsapp: ({ className }) => <MessageCircle className={cn(className, "text-emerald-600")} />,
  email:    ({ className }) => <Mail className={cn(className, "text-blue-500")} />,
  photo:    ({ className }) => <Camera className={cn(className, "text-purple-500")} />,
  manual:   ({ className }) => <PenLine className={cn(className, "text-muted-foreground")} />,
};

const STATUS_LABELS: Record<string, string> = {
  received:         "Recebido",
  classifying:      "Classificando...",
  ready_for_review: "Para revisar",
  approved:         "Aprovado",
  dismissed:        "Descartado",
  failed:           "Falhou",
  manual_review:    "Revisão manual",
};

const FILTERS = [
  { value: undefined,          label: "Todos" },
  { value: "ready_for_review", label: "Para revisar" },
  { value: "approved",         label: "Aprovados" },
  { value: "dismissed",        label: "Descartados" },
];

/* ── MemoryConfirmationCard ────────────────────────────────────────────────── */
const TABLE_LABELS: Record<string, string> = {
  household_places:      "Lugar",
  household_routines:    "Rotina",
  household_preferences: "Preferência",
};

const TABLE_ICONS: Record<string, string> = {
  household_places:      "📍",
  household_routines:    "🔄",
  household_preferences: "⚙️",
};

function MemoryConfirmationSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: items = [], isLoading } = useListMemoryStaging();

  const confirm = useConfirmMemoryStaging({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListMemoryStagingQueryKey() });
        toast({ description: "Confirmado e salvo na memória." });
      },
      onError: () => toast({ description: "Erro ao confirmar. Tente novamente.", variant: "destructive" }),
    },
  });

  const dismiss = useDismissMemoryStaging({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListMemoryStagingQueryKey() });
        toast({ description: "Ignorado." });
      },
      onError: () => toast({ description: "Erro ao ignorar. Tente novamente.", variant: "destructive" }),
    },
  });

  if (isLoading || items.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <Brain className="h-4 w-4" style={{ color: V.primary }} />
        <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: V.muted }}>
          Vesta aprendeu ({items.length})
        </h2>
      </div>
      <div className="space-y-2">
        {items.map((item) => {
          const icon = TABLE_ICONS[item.target_table] ?? "🧠";
          const label = TABLE_LABELS[item.target_table] ?? "Memória";
          const record = item.proposed_record;
          const name = (record.name as string | undefined) ?? (record.preference_key as string | undefined);

          return (
            <div key={item.id}
              className="rounded-2xl overflow-hidden"
              style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.12)" }}>
              <div className="px-4 pt-4 pb-3">
                <div className="flex items-start gap-2.5 mb-2">
                  <span className="text-lg shrink-0 leading-none">{icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                        style={{ background: "#EAF1E5", color: V.primary }}>
                        {label}
                      </span>
                      {name && (
                        <span className="text-xs font-semibold truncate" style={{ color: V.ink }}>{name}</span>
                      )}
                    </div>
                    <p className="text-sm leading-snug" style={{ color: V.ink }}>
                      {item.context_summary}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex border-t" style={{ borderColor: "rgba(14,59,46,0.08)" }}>
                <button
                  onClick={() => dismiss.mutate({ id: item.id })}
                  disabled={dismiss.isPending || confirm.isPending}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm transition-colors hover:bg-red-50 disabled:opacity-50"
                  style={{ color: V.muted }}>
                  <X className="h-4 w-4" />
                  Ignorar
                </button>
                <div className="w-px" style={{ background: "rgba(14,59,46,0.08)" }} />
                <button
                  onClick={() => confirm.mutate({ id: item.id })}
                  disabled={confirm.isPending || dismiss.isPending}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-semibold transition-colors hover:bg-green-50 disabled:opacity-50"
                  style={{ color: V.primary }}>
                  <CheckCircle2 className="h-4 w-4" />
                  Confirmar
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ── AppEscalationCard wrapper ─────────────────────────────────────────────── */
function AppEscalationSection({ actions }: { actions: SuggestedAction[] }) {
  if (actions.length === 0) return null;

  const explicit = actions.filter((a) => a.approval_level === "explicit");
  const oneTap   = actions.filter((a) => a.approval_level !== "explicit" && a.approval_level !== "soft");
  const soft     = actions.filter((a) => a.approval_level === "soft");

  return (
    <section>
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Aguardando aprovação ({actions.length})
      </h2>

      {explicit.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 mb-2 px-1">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
              Confirmação necessária
            </span>
          </div>
          <div className="space-y-2">
            {explicit.map((a) => <ApprovalCard key={a.id} action={a} />)}
          </div>
        </div>
      )}

      {oneTap.length > 0 && (
        <div className="space-y-2 mb-3">
          {oneTap.map((a) => <ApprovalCard key={a.id} action={a} />)}
        </div>
      )}

      {soft.length > 0 && (
        <div className="space-y-1">
          {soft.map((a) => <ApprovalCard key={a.id} action={a} />)}
        </div>
      )}
    </section>
  );
}

/* ── Main ──────────────────────────────────────────────────────────────────── */
export default function InboxPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<import("@workspace/api-client-react").ListInboxItemsStatus | undefined>("ready_for_review");
  const [showCompose, setShowCompose] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [senderName, setSenderName] = useState("");

  const { data: items, isLoading } = useListInboxItems(
    filter ? { status: filter } : {},
  );
  const { data: pendingActions } = useListActions({ status: "pending" });

  const createItem = useCreateInboxItem({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInboxItemsQueryKey() });
        setShowCompose(false);
        setNewContent("");
        setSenderName("");
        toast({ description: "Mensagem adicionada." });
      },
    },
  });

  const classify = useClassifyInboxItem({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInboxItemsQueryKey() });
        qc.invalidateQueries({ queryKey: getListActionsQueryKey() });
        toast({ description: "Classificado!" });
      },
    },
  });

  useEffect(() => {
    if (!showCompose) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowCompose(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showCompose]);

  const pendingItemIds = new Set(pendingActions?.map((a) => a.inbox_item_id) ?? []);

  return (
    <div className="p-4 space-y-4 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Para processar</h1>
        <button
          onClick={() => setShowCompose(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors"
          data-testid="button-compose">
          <Plus className="w-4 h-4" />
          Nova
        </button>
      </div>

      {/* Compose form */}
      {showCompose && (
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3 animate-fade-in-up">
          <h3 className="text-sm font-semibold">Adicionar mensagem manualmente</h3>
          <input value={senderName} onChange={(e) => setSenderName(e.target.value)}
            placeholder="Nome do remetente (opcional)"
            className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-sender" />
          <textarea value={newContent} onChange={(e) => setNewContent(e.target.value)}
            placeholder="Cole aqui a mensagem..." rows={4}
            className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            data-testid="input-content" />
          <div className="flex gap-2">
            <button onClick={() => setShowCompose(false)}
              className="flex-1 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground">
              Cancelar
            </button>
            <button
              onClick={() => createItem.mutate({ data: { raw_content: newContent, source: "manual", sender_name: senderName || undefined } })}
              disabled={!newContent.trim() || createItem.isPending}
              className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
              data-testid="button-submit-compose">
              {createItem.isPending ? "Enviando..." : "Adicionar"}
            </button>
          </div>
        </div>
      )}

      {/* Memory confirmations — Vesta learned something, needs sign-off */}
      <MemoryConfirmationSection />

      {/* Escalation section — pending actions grouped by approval level */}
      {filter === "ready_for_review" && (pendingActions?.length ?? 0) > 0 && (
        <AppEscalationSection actions={pendingActions ?? []} />
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        {FILTERS.map((f) => (
          <button key={f.label}
            onClick={() => setFilter(f.value as import("@workspace/api-client-react").ListInboxItemsStatus | undefined)}
            className={cn(
              "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
              filter === f.value
                ? "bg-primary text-primary-foreground"
                : "bg-card border border-border text-muted-foreground hover:text-foreground",
            )}
            data-testid={`filter-${f.value ?? "all"}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Items list */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : !items?.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <MessageCircle className="w-10 h-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">Nenhum item aqui</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {filter === "ready_for_review" ? "Tudo em dia. Inbox zero!" : "Sem itens nesta categoria."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const SourceIcon = SOURCE_ICONS[item.source] ?? SOURCE_ICONS.manual;
            const hasPending = pendingItemIds.has(item.id);
            return (
              <div key={item.id}
                className={cn("bg-card border rounded-2xl p-3 space-y-2", hasPending ? "border-primary/30" : "border-border")}
                data-testid={`inbox-item-${item.id}`}>
                <div className="flex items-start gap-2.5">
                  <SourceIcon className="w-4 h-4 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    {item.sender_name && (
                      <span className="text-xs font-semibold text-foreground">{item.sender_name} · </span>
                    )}
                    <p className="text-sm text-foreground leading-snug line-clamp-2">{item.raw_content}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[10px] text-muted-foreground">{formatRelativeTime(item.created_at)}</span>
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                      item.status === "ready_for_review" && "bg-primary/10 text-primary",
                      item.status === "approved" && "bg-emerald-100 text-emerald-700",
                      item.status === "dismissed" && "bg-muted text-muted-foreground",
                      item.status === "received" && "bg-blue-100 text-blue-700",
                    )}>
                      {STATUS_LABELS[item.status] ?? item.status}
                    </span>
                  </div>
                </div>

                {item.status === "received" && (
                  <button onClick={() => classify.mutate({ id: item.id })} disabled={classify.isPending}
                    className="flex items-center gap-1.5 text-xs text-primary font-medium py-1"
                    data-testid={`classify-${item.id}`}>
                    <RefreshCw className={cn("w-3 h-3", classify.isPending && "animate-spin")} />
                    Classificar agora
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
