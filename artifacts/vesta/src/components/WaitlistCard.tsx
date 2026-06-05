import { School, ChevronRight, Bell } from "lucide-react";
import { Link } from "wouter";
import {
  useListCrecheWaitlists,
  useUpdateCrecheWaitlist,
  getListCrecheWaitlistsQueryKey,
  type CrecheWaitlist,
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

function WaitlistRow({ entry }: { entry: CrecheWaitlist }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateCrecheWaitlist({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListCrecheWaitlistsQueryKey() });
        toast({ description: "Status atualizado." });
      },
    },
  });

  const s = STATUS_COLORS[entry.status] ?? STATUS_COLORS.waiting;

  return (
    <div
      className="flex items-center gap-3 py-3"
      style={{ borderBottom: "1px solid rgba(14,59,46,0.07)" }}
      data-testid={`waitlist-row-${entry.id}`}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-snug truncate" style={{ color: V.ink }}>
          {entry.creche_name}
        </p>
        {entry.estimated_call_date && (
          <p className="text-xs mt-0.5" style={{ color: V.muted }}>
            Previsão: {entry.estimated_call_date.split("-").reverse().join("/")}
          </p>
        )}
      </div>

      <span
        className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full"
        style={{ background: s.bg, color: s.fg }}
      >
        {s.label}
      </span>

      {entry.status === "waiting" && (
        <button
          onClick={() => update.mutate({ id: entry.id, data: { next_followup_at: new Date().toISOString() } })}
          disabled={update.isPending}
          className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-opacity disabled:opacity-50"
          style={{ background: "#EAF1E5", color: V.primary }}
          title="Marcar follow-up feito"
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
        style={{ background: hasCalled ? "#F0FDF4" : V.cream, border: `1px solid ${hasCalled ? "rgba(16,185,129,0.25)" : "rgba(14,59,46,0.10)"}` }}
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
