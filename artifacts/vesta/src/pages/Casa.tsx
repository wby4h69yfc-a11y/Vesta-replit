import { useState } from "react";
import { Users, Phone, Plus, Home, Trash2, Edit2 } from "lucide-react";
import {
  useGetHousehold,
  useListMembers,
  useListContacts,
  useCreateContact,
  useDeleteContact,
  getListContactsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import CategoryBadge from "@/components/CategoryBadge";
import { CATEGORIES } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const CONTACT_CATS = [
  { id: "escola",   label: "Escola" },
  { id: "saude",    label: "Saúde" },
  { id: "diarista", label: "Diarista" },
  { id: "portaria", label: "Portaria" },
  { id: "sindico",  label: "Síndico" },
  { id: "familia",  label: "Família" },
  { id: "servicos", label: "Serviços" },
  { id: "social",   label: "Social" },
  { id: "outros",   label: "Outros" },
];

export default function CasaPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [catFilter, setCatFilter] = useState<string | undefined>(undefined);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", category: "escola", notes: "" });

  const { data: household } = useGetHousehold();
  const { data: members } = useListMembers();
  const { data: contacts, isLoading } = useListContacts(catFilter ? { category: catFilter } : {});

  const createContact = useCreateContact({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListContactsQueryKey() });
        setShowCreate(false);
        setForm({ name: "", phone: "", category: "escola", notes: "" });
        toast({ description: "Contato adicionado." });
      },
    },
  });

  const deleteContact = useDeleteContact({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListContactsQueryKey() });
        toast({ description: "Contato removido." });
      },
    },
  });

  return (
    <div className="p-4 space-y-5 animate-fade-in-up">
      <h1 className="text-xl font-bold text-foreground">Casa</h1>

      {/* Household info */}
      {household && (
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Home className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{household.name}</p>
              {household.location && <p className="text-xs text-muted-foreground">{household.location}</p>}
              <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium mt-0.5 inline-block", household.plan === "premium" ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground")}>
                {household.plan === "premium" ? "Premium" : "Gratuito"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Members */}
      {(members?.length ?? 0) > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Membros</h2>
          <div className="flex gap-3 flex-wrap">
            {members?.map((m) => (
              <div key={m.id} className="flex items-center gap-2 bg-card border border-border rounded-xl px-3 py-2" data-testid={`member-${m.id}`}>
                <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary">
                  {m.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-xs font-medium text-foreground">{m.name}</p>
                  <p className="text-[10px] text-muted-foreground">{m.role === "admin" ? "Admin" : m.role === "restricted" ? "Restrito" : "Membro"}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Contacts */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Contatos</h2>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-primary text-primary-foreground rounded-xl text-xs font-medium"
            data-testid="button-add-contact"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar
          </button>
        </div>

        {/* Category filter */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2">
          <button
            onClick={() => setCatFilter(undefined)}
            className={cn("shrink-0 px-3 py-1 rounded-full text-xs font-medium", !catFilter ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground")}
          >
            Todos
          </button>
          {CONTACT_CATS.map((c) => (
            <button
              key={c.id}
              onClick={() => setCatFilter(catFilter === c.id ? undefined : c.id)}
              className={cn("shrink-0 px-3 py-1 rounded-full text-xs font-medium", catFilter === c.id ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground")}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Create contact form */}
        {showCreate && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-2 mb-3 animate-fade-in-up">
            <h3 className="text-sm font-semibold">Novo contato</h3>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Nome"
              className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="input-contact-name"
            />
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="Telefone/WhatsApp"
              type="tel"
              className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="select-contact-category"
            >
              {CONTACT_CATS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Notas (opcional)"
              rows={2}
              className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
            <div className="flex gap-2">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2 rounded-xl border border-border text-sm text-muted-foreground">Cancelar</button>
              <button
                onClick={() => createContact.mutate({ data: { name: form.name, category: form.category, phone: form.phone || undefined, notes: form.notes || undefined } })}
                disabled={!form.name || createContact.isPending}
                className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                data-testid="button-submit-contact"
              >
                {createContact.isPending ? "Salvando..." : "Adicionar"}
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />)}</div>
        ) : !contacts?.length ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="w-10 h-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">Nenhum contato ainda</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Adicione a escola, médico, diarista e mais.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {contacts.map((contact) => (
              <div
                key={contact.id}
                className="flex items-center gap-3 bg-card border border-border rounded-xl px-3 py-2.5 group"
                data-testid={`contact-${contact.id}`}
              >
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">
                  {contact.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{contact.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <CategoryBadge category={contact.category} />
                    {contact.phone && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Phone className="w-3 h-3" />
                        {contact.phone}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => deleteContact.mutate({ id: contact.id })}
                  className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-all"
                  data-testid={`delete-contact-${contact.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
