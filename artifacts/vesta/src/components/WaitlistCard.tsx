import { School, ChevronRight, Bell, Check, User } from "lucide-react";
import { Link } from "wouter";
import {
  useListCrecheWaitlists,
  useUpdateCrecheWaitlist,
  getListCrecheWaitlistsQueryKey,
  type CrecheWaitlist,
  type CrecheWaitlistDocItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { V } from "@/lib/brand";

const STATUS_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  waiting:   { bg: "#FEF9C3", fg: "#854D0E", label: "Na espera" },
  called:    { bg: "#DCFCE7", fg: "#166534", label: "Chamada! 🎉" },
  enrolled:  { bg: "#EAF1E5", fg: V.primary, label: "Matriculada" },
  cancelled: { bg: V.ivory,   fg: V.muted,   label: "Cancelada" },
};

function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 11;
  const circ = 2 * Math.PI * r;
  const pct = total === 0 ? 0 : Math.min(1, done / total);
  const dashOffset = circ * (1 - pct);
  const dim = r * 2 + 6;
  const cx = r + 3;
  return (
    <svg width={dim} height={dim} className="shrink-0" aria-label={`${done} de ${total} documentos`}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(14,59,46,0.10)" strokeWidth={2.5} />
      <circle
        cx={cx} cy={cx} r={r}
        fill="none"
        stroke={pct >= 1 ? "#059669" : V.primary}
        strokeWidth={2.5}
        strokeDasharray={circ}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cx})`}
      />
      <text
        x={cx} y={cx + 1}
        textAnchor="middle" dominantBaseline="middle"
        fontSize={7} fill={V.ink} fontWeight={700}
      >
        {done}/{total}
      </text>
    </svg>
  );
}

function WaitlistRow({ entry }: { entry: CrecheWaitlist }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateCrecheWaitlist({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListCrecheWaitlistsQueryKey() });
      },
      onError: () => toast({ description: "Erro ao atualizar.", variant: "destructive" }),
    },
  });

  const s = STATUS_COLORS[entry.status] ?? STATUS_COLORS.waiting;
  const checklist: CrecheWaitlistDocItem[] = Array.isArray(entry.document_checklist)
    ? entry.document_checklist
    : [];
  const docsDone  = checklist.filter((d) => d.done).length;
  const docsTotal = checklist.length;

  function toggleDoc(idx: number) {
    const newList = checklist.map((item, i) =>
      i === idx ? { ...item, done: !item.done } : item,
    );
    update.mutate({ id: entry.id, data: { document_checklist: newList } });
  }

  function markFollowUp() {
    const next = new Date();
    next.setDate(next.getDate() + 30);
    update.mutate({ id: entry.id, data: { next_followup_at: next.toISOString() } });
    toast({ description: "Próximo follow-up em 30 dias." });
  }

  return (
    <div
      className="py-3"
      style={{ borderBottom: "1px solid rgba(14,59,46,0.07)" }}
      data-testid={`waitlist-row-${entry.id}`}
    >
      {/* Top row: ring + name + status + action */}
      <div className="flex items-center gap-3">
        {docsTotal > 0 && <ProgressRing done={docsDone} total={docsTotal} />}

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-snug truncate" style={{ color: V.ink }}>
            {entry.creche_name}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {entry.child_name && (
              <span className="flex items-center gap-1 text-xs" style={{ color: V.muted }}>
                <User className="w-2.5 h-2.5" />
                {entry.child_name}
              </span>
            )}
            {entry.next_followup_at && (
              <span className="text-xs" style={{ color: V.muted }}>
                Contato: {new Date(entry.next_followup_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
              </span>
            )}
            {!entry.next_followup_at && entry.estimated_call_date && (
              <span className="text-xs" style={{ color: V.muted }}>
                Previsão: {entry.estimated_call_date.split("-").reverse().join("/")}
              </span>
            )}
          </div>
        </div>

        <span
          className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full"
          style={{ background: s.bg, color: s.fg }}
        >
          {s.label}
        </span>

        {entry.status === "waiting" && (
          <button
            onClick={markFollowUp}
            disabled={update.isPending}
            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-opacity disabled:opacity-50"
            style={{ background: "#EAF1E5", color: V.primary }}
            title="Marcar follow-up feito (reagenda para 30 dias)"
          >
            <Bell className="w-3 h-3" />
            Follow-up
          </button>
        )}

        {entry.status === "called" && (
          <button
            onClick={() => update.mutate({ id: entry.id, data: { status: "enrolled" } })}
            disabled={update.isPending}
            className="shrink-0 px-2 py-1 rounded-lg text-[11px] font-semibold transition-opacity disabled:opacity-50"
            style={{ background: V.primary, color: "white" }}
          >
            Matricular ✓
          </button>
        )}
      </div>

      {/* Document checklist */}
      {docsTotal > 0 && (
        <div className="mt-2 ml-0 space-y-1 pl-1">
          {checklist.map((item, idx) => (
            <button
              key={idx}
              onClick={() => toggleDoc(idx)}
              disabled={update.isPending}
              className="flex items-center gap-2 w-full text-left disabled:opacity-50"
            >
              <div
                className="w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0"
                style={{
                  borderColor: item.done ? "#059669" : "rgba(14,59,46,0.25)",
                  background:  item.done ? "#DCFCE7" : "transparent",
                }}
              >
                {item.done && <Check className="w-2.5 h-2.5" style={{ color: "#059669" }} />}
              </div>
              <span
                className="text-xs leading-tight"
                style={{
                  color:          item.done ? V.muted : V.ink,
                  textDecoration: item.done ? "line-through" : "none",
                }}
              >
                {item.doc}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WaitlistCard() {
  const { data: all = [], isLoading } = useListCrecheWaitlists({});

  const active = all.filter((w) => w.status === "waiting" || w.status === "called");
  if (isLoading || active.length === 0) return null;

  const hasCalled = active.some((w) => w.status === "called");

  return (
    <section data-testid="waitlist-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <School className="w-4 h-4" style={{ color: hasCalled ? "#059669" : V.sage }} />
          <h2
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: hasCalled ? "#059669" : V.muted }}
          >
            {hasCalled ? "Creche chamou! 🎉" : "Lista de espera"}
          </h2>
        </div>
        <Link href="/casa" className="flex items-center gap-0.5 text-xs" style={{ color: V.primary }}>
          Ver tudo
          <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      <div
        className="rounded-3xl overflow-hidden"
        style={{
          background: hasCalled ? "#F0FDF4" : V.cream,
          border: `1px solid ${hasCalled ? "rgba(16,185,129,0.25)" : "rgba(14,59,46,0.10)"}`,
        }}
      >
        <div className="px-4 pt-1 pb-2">
          {active.map((entry) => (
            <WaitlistRow key={entry.id} entry={entry} />
          ))}
        </div>
      </div>
    </section>
  );
}
