import { useRef, useState } from "react";
import { CheckSquare, Plus, Circle, CheckCircle2, Clock, User, Trash2, ChevronDown, ChevronUp, DollarSign, Paperclip } from "lucide-react";
import {
  useListTasks,
  useCreateTask,
  useCompleteTask,
  useDeleteTask,
  getListTasksQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import CategoryBadge from "@/components/CategoryBadge";
import { CATEGORIES } from "@/lib/categories";
import { formatDate, isPast } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import PaymentSafetyChecklist from "@/components/PaymentSafetyChecklist";

function ComprovanteUpload({ obligationId, alreadyUploaded }: { obligationId: number; alreadyUploaded: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (alreadyUploaded && !ocrNote) {
    return (
      <p className="text-xs text-emerald-700 font-medium flex items-center gap-1">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Comprovante já enviado
      </p>
    );
  }

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const resp = await fetch(`/api/payment-obligations/${obligationId}/comprovante`, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: "Erro ao enviar" }));
        throw new Error((body as { error?: string }).error ?? "Erro ao enviar");
      }
      const data = await resp.json() as { ocr_note?: string };
      setOcrNote(data.ocr_note ?? "Comprovante enviado com sucesso.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar comprovante");
    } finally {
      setUploading(false);
    }
  }

  if (ocrNote) {
    return (
      <div className="rounded-xl px-3 py-2.5 space-y-1" style={{ background: "rgba(5,150,105,0.06)", border: "1px solid rgba(5,150,105,0.15)" }}>
        <p className="text-xs font-semibold text-emerald-700">Comprovante verificado ✓</p>
        <p className="text-xs text-muted-foreground">{ocrNote}</p>
      </div>
    );
  }

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
        data-testid={`comprovante-input-${obligationId}`}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors disabled:opacity-50"
        data-testid={`comprovante-upload-${obligationId}`}
      >
        <Paperclip className="w-3.5 h-3.5" />
        {uploading ? "Enviando…" : "Anexar comprovante"}
      </button>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}

const STATUS_FILTERS = [
  { value: undefined,     label: "Todas" },
  { value: "pending",     label: "Pendentes" },
  { value: "in_progress", label: "Em progresso" },
  { value: "done",        label: "Concluídas" },
];

export default function TarefasPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<import("@workspace/api-client-react").ListTasksStatus | undefined>("pending");
  const [catFilter, setCatFilter] = useState<string | undefined>(undefined);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [form, setForm] = useState({ title: "", due_at: "", category: "", workflow_tags: "" });

  const { data: tasks, isLoading } = useListTasks({
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(catFilter ? { category: catFilter } : {}),
  });

  const createTask = useCreateTask({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
        setShowCreate(false);
        setForm({ title: "", due_at: "", category: "", workflow_tags: "" });
        toast({ description: "Tarefa criada." });
      },
    },
  });

  const complete = useCompleteTask({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
        toast({ description: "Concluída!" });
      },
    },
  });

  const deleteTask = useDeleteTask({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
      },
    },
  });

  return (
    <div className="p-4 space-y-4 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Tarefas</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium"
          data-testid="button-create-task"
        >
          <Plus className="w-4 h-4" />
          Tarefa
        </button>
      </div>

      {/* Status filter */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => setStatusFilter(f.value as import("@workspace/api-client-react").ListTasksStatus | undefined)}
            className={cn(
              "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
              statusFilter === f.value ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground",
            )}
            data-testid={`status-filter-${f.value ?? "all"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Category filter */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <button
          onClick={() => setCatFilter(undefined)}
          className={cn("shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors", !catFilter ? "bg-foreground text-background" : "bg-card border border-border text-muted-foreground")}
        >
          Tudo
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCatFilter(catFilter === c.id ? undefined : c.id)}
            className={cn("shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors", catFilter === c.id ? "bg-foreground text-background" : "bg-card border border-border text-muted-foreground")}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-card border border-border rounded-2xl p-4 space-y-2 animate-fade-in-up">
          <h3 className="text-sm font-semibold">Nova tarefa</h3>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="O que precisa ser feito?"
            className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-task-title"
          />
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="select-task-category"
          >
            <option value="">Categoria (opcional)</option>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <input
            type="datetime-local"
            value={form.due_at}
            onChange={(e) => setForm({ ...form, due_at: e.target.value })}
            className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex gap-2 pt-1">
            <button onClick={() => setShowCreate(false)} className="flex-1 py-2 rounded-xl border border-border text-sm text-muted-foreground">Cancelar</button>
            <button
              onClick={() => createTask.mutate({ data: { title: form.title, category: form.category || undefined, due_at: form.due_at || undefined } })}
              disabled={!form.title.trim() || createTask.isPending}
              className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
              data-testid="button-submit-task"
            >
              {createTask.isPending ? "Criando..." : "Criar"}
            </button>
          </div>
        </div>
      )}

      {/* Task list */}
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}</div>
      ) : !tasks?.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <CheckSquare className="w-10 h-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">Nenhuma tarefa encontrada</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {statusFilter === "pending" ? "Sem tarefas pendentes. Ótimo trabalho!" : "Nenhuma tarefa nesta categoria."}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {tasks.map((task) => {
            const overdue = task.status === "pending" && task.due_at && isPast(task.due_at);
            return (
              <div
                key={task.id}
                className={cn(
                  "bg-card border rounded-xl overflow-hidden",
                  overdue ? "border-amber-300 bg-amber-50" : "border-border",
                )}
                data-testid={`task-item-${task.id}`}
              >
                <div className="flex items-start gap-3 px-3 py-3 group">
                  <button
                    onClick={() => task.status === "pending" && complete.mutate({ id: task.id })}
                    disabled={task.status !== "pending" || complete.isPending}
                    className="mt-0.5 shrink-0 disabled:cursor-default"
                    data-testid={`complete-task-${task.id}`}
                  >
                    {task.status === "done" ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    ) : (
                      <Circle className={cn("w-5 h-5", overdue ? "text-amber-500" : "text-muted-foreground hover:text-primary transition-colors")} />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm font-medium leading-snug", task.status === "done" && "line-through text-muted-foreground")}>{task.title}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {task.category && <CategoryBadge category={task.category} />}
                      {task.due_at && (
                        <span className={cn("flex items-center gap-1 text-xs", overdue ? "text-amber-600 font-medium" : "text-muted-foreground")}>
                          <Clock className="w-3 h-3" />
                          {formatDate(task.due_at)}
                        </span>
                      )}
                      {task.owner_name && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <User className="w-3 h-3" />
                          {task.owner_name}
                        </span>
                      )}
                      {task.payment_status && (
                        <span className="flex items-center gap-1 text-xs text-emerald-700 font-medium">
                          <DollarSign className="w-3 h-3" />
                          {task.payment_status === "paid" ? "Pago" : task.payment_status === "overdue" ? "Vencido" : "Pagamento pendente"}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {task.payment_status && task.status !== "done" && (
                      <button
                        onClick={() => setExpandedId(expandedId === task.id ? null : task.id)}
                        className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        data-testid={`expand-task-${task.id}`}
                        aria-expanded={expandedId === task.id}
                      >
                        {expandedId === task.id
                          ? <ChevronUp className="w-4 h-4" />
                          : <ChevronDown className="w-4 h-4" />
                        }
                      </button>
                    )}
                    <button
                      onClick={() => deleteTask.mutate({ id: task.id })}
                      className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-all"
                      data-testid={`delete-task-${task.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Payment detail — expanded when task has payment_status */}
                {expandedId === task.id && task.payment_status && (
                  <div className="px-3 pb-3 pt-0 border-t border-border/50 space-y-3">
                    <PaymentSafetyChecklist
                      payment={{
                        amount_cents:   task.payment_amount_cents,
                        description:    task.title,
                        due_date:       task.payment_due_date,
                        payment_method: task.payment_method,
                      }}
                    />
                    {/* Comprovante upload — only shown if there's a linked obligation */}
                    {task.payment_obligation_id && (
                      <ComprovanteUpload
                        obligationId={task.payment_obligation_id}
                        alreadyUploaded={task.payment_status === "comprovante_received" || task.payment_status === "paid"}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
