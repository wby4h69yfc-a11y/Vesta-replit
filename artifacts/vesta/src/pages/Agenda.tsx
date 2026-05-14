import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Calendar } from "lucide-react";
import { useListEvents, useCreateEvent, getListEventsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import CategoryBadge from "@/components/CategoryBadge";
import { CATEGORIES } from "@/lib/categories";
import { formatTime, formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const DAYS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS_PT = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];

const CAT_DOT: Record<string, string> = {
  escola:    "bg-blue-500",
  saude:     "bg-emerald-500",
  casa:      "bg-amber-500",
  social:    "bg-rose-500",
  logistica: "bg-violet-500",
  refeicoes: "bg-orange-500",
  servicos:  "bg-slate-400",
  outros:    "bg-stone-400",
};

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export default function AgendaPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());
  const [showCreate, setShowCreate] = useState(false);
  const [catFilter, setCatFilter] = useState<string | undefined>(undefined);

  const [form, setForm] = useState({
    title: "",
    start_at: "",
    end_at: "",
    all_day: false,
    category: "escola",
    notes: "",
  });

  const fromDate = new Date(viewYear, viewMonth, 1).toISOString().slice(0, 10);
  const toDate = new Date(viewYear, viewMonth + 1, 0).toISOString().slice(0, 10);

  const { data: events } = useListEvents({
    from: fromDate,
    to: toDate,
    ...(catFilter ? { category: catFilter } : {}),
  });

  const createEvent = useCreateEvent({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListEventsQueryKey() });
        setShowCreate(false);
        setForm({ title: "", start_at: "", end_at: "", all_day: false, category: "escola", notes: "" });
        toast({ description: "Evento criado." });
      },
    },
  });

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth);

  // Build day → events map
  const dayEventsMap: Record<number, typeof events> = {};
  events?.forEach((ev) => {
    const d = new Date(ev.start_at).getDate();
    if (!dayEventsMap[d]) dayEventsMap[d] = [];
    dayEventsMap[d]?.push(ev);
  });

  const selectedEvents = selectedDay ? (dayEventsMap[selectedDay] ?? []) : [];

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(v => v - 1); }
    else setViewMonth(m => m - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(v => v + 1); }
    else setViewMonth(m => m + 1);
    setSelectedDay(null);
  }

  return (
    <div className="p-4 space-y-4 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Agenda</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium"
          data-testid="button-create-event"
        >
          <Plus className="w-4 h-4" />
          Evento
        </button>
      </div>

      {/* Category filter */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        <button
          onClick={() => setCatFilter(undefined)}
          className={cn("shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors", !catFilter ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground")}
        >
          Todos
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCatFilter(catFilter === c.id ? undefined : c.id)}
            className={cn("shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors", catFilter === c.id ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground")}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Calendar header */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <button onClick={prevMonth} className="p-1 hover:bg-muted rounded-lg" data-testid="prev-month"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-sm font-semibold">{MONTHS_PT[viewMonth]} {viewYear}</span>
          <button onClick={nextMonth} className="p-1 hover:bg-muted rounded-lg" data-testid="next-month"><ChevronRight className="w-4 h-4" /></button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-border">
          {DAYS_PT.map((d) => (
            <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground py-2">{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {Array.from({ length: firstDay }).map((_, i) => (
            <div key={`empty-${i}`} className="h-10" />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
            const isToday = day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
            const isSelected = day === selectedDay;
            const dayEvs = dayEventsMap[day] ?? [];
            return (
              <button
                key={day}
                onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                className={cn(
                  "h-10 flex flex-col items-center justify-start pt-1 text-sm transition-colors relative",
                  isSelected && "bg-primary/10",
                  !isSelected && "hover:bg-muted",
                )}
                data-testid={`day-${day}`}
              >
                <span
                  className={cn(
                    "w-6 h-6 flex items-center justify-center rounded-full text-xs font-medium",
                    isToday && !isSelected && "bg-primary text-primary-foreground",
                    isSelected && "bg-primary text-primary-foreground",
                  )}
                >
                  {day}
                </span>
                {dayEvs.length > 0 && (
                  <div className="flex gap-0.5 mt-0.5">
                    {dayEvs.slice(0, 3).map((ev, idx) => (
                      <span key={idx} className={cn("w-1 h-1 rounded-full", CAT_DOT[ev.category] ?? "bg-muted-foreground")} />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected day events */}
      {selectedDay && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">
            {selectedDay} de {MONTHS_PT[viewMonth]}
          </h2>
          {selectedEvents.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
              Nenhum evento neste dia.
            </div>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map((ev) => (
                <div key={ev.id} className="flex items-start gap-3 bg-card border border-border rounded-xl p-3" data-testid={`event-${ev.id}`}>
                  <div className={cn("w-1 self-stretch rounded-full", CAT_DOT[ev.category] ?? "bg-muted")} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{ev.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {!ev.all_day && <span className="text-xs text-muted-foreground">{formatTime(ev.start_at)}{ev.end_at ? ` – ${formatTime(ev.end_at)}` : ""}</span>}
                      {ev.all_day && <span className="text-xs text-muted-foreground">Dia todo</span>}
                      <CategoryBadge category={ev.category} />
                    </div>
                    {ev.notes && <p className="text-xs text-muted-foreground mt-1">{ev.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Create event form */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setShowCreate(false)}>
          <div className="bg-card w-full max-w-lg mx-auto rounded-t-3xl p-5 space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">Novo evento</h3>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Título do evento"
              className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="input-event-title"
            />
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="select-event-category"
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <input
              type="datetime-local"
              value={form.start_at}
              onChange={(e) => setForm({ ...form, start_at: e.target.value })}
              className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="input-event-start"
            />
            <input
              type="datetime-local"
              value={form.end_at}
              onChange={(e) => setForm({ ...form, end_at: e.target.value })}
              className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Término (opcional)"
            />
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Notas..."
              rows={2}
              className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2.5 rounded-xl border border-border text-sm text-muted-foreground">Cancelar</button>
              <button
                onClick={() => createEvent.mutate({ data: { title: form.title, start_at: form.start_at, category: form.category as import("@workspace/api-client-react").CalendarEventInputCategory, end_at: form.end_at || undefined, notes: form.notes || undefined } })}
                disabled={!form.title || !form.start_at || createEvent.isPending}
                className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                data-testid="button-submit-event"
              >
                {createEvent.isPending ? "Salvando..." : "Criar evento"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
