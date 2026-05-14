import { useState } from "react";
import { Plus, MessageCircle, Mail, Camera, PenLine, RefreshCw } from "lucide-react";
import {
  useListInboxItems,
  useListActions,
  useCreateInboxItem,
  useClassifyInboxItem,
  getListInboxItemsQueryKey,
  getListActionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import ApprovalCard from "@/components/ApprovalCard";
import CategoryBadge from "@/components/CategoryBadge";
import { formatRelativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

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
  { value: undefined,         label: "Todos" },
  { value: "ready_for_review", label: "Para revisar" },
  { value: "approved",         label: "Aprovados" },
  { value: "dismissed",        label: "Descartados" },
];

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

  const pendingItemIds = new Set(pendingActions?.map((a) => a.inbox_item_id) ?? []);

  return (
    <div className="p-4 space-y-4 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Para processar</h1>
        <button
          onClick={() => setShowCompose(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors"
          data-testid="button-compose"
        >
          <Plus className="w-4 h-4" />
          Nova
        </button>
      </div>

      {/* Compose form */}
      {showCompose && (
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3 animate-fade-in-up">
          <h3 className="text-sm font-semibold">Adicionar mensagem manualmente</h3>
          <input
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            placeholder="Nome do remetente (opcional)"
            className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-sender"
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Cole aqui a mensagem..."
            rows={4}
            className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            data-testid="input-content"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setShowCompose(false)}
              className="flex-1 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
            <button
              onClick={() =>
                createItem.mutate({
                  data: { raw_content: newContent, source: "manual", sender_name: senderName || undefined },
                })
              }
              disabled={!newContent.trim() || createItem.isPending}
              className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
              data-testid="button-submit-compose"
            >
              {createItem.isPending ? "Enviando..." : "Adicionar"}
            </button>
          </div>
        </div>
      )}

      {/* Pending actions (approval cards) */}
      {filter === "ready_for_review" && (pendingActions?.length ?? 0) > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Aguardando aprovação ({pendingActions?.length})
          </h2>
          <div className="space-y-2">
            {pendingActions?.map((action) => (
              <ApprovalCard key={action.id} action={action} />
            ))}
          </div>
        </section>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => setFilter(f.value as import("@workspace/api-client-react").ListInboxItemsStatus | undefined)}
            className={cn(
              "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
              filter === f.value
                ? "bg-primary text-primary-foreground"
                : "bg-card border border-border text-muted-foreground hover:text-foreground",
            )}
            data-testid={`filter-${f.value ?? "all"}`}
          >
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
              <div
                key={item.id}
                className={cn(
                  "bg-card border rounded-2xl p-3 space-y-2",
                  hasPending ? "border-primary/30" : "border-border",
                )}
                data-testid={`inbox-item-${item.id}`}
              >
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
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                        item.status === "ready_for_review" && "bg-primary/10 text-primary",
                        item.status === "approved" && "bg-emerald-100 text-emerald-700",
                        item.status === "dismissed" && "bg-muted text-muted-foreground",
                        item.status === "received" && "bg-blue-100 text-blue-700",
                      )}
                    >
                      {STATUS_LABELS[item.status] ?? item.status}
                    </span>
                  </div>
                </div>

                {item.status === "received" && (
                  <button
                    onClick={() => classify.mutate({ id: item.id })}
                    disabled={classify.isPending}
                    className="flex items-center gap-1.5 text-xs text-primary font-medium py-1"
                    data-testid={`classify-${item.id}`}
                  >
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
