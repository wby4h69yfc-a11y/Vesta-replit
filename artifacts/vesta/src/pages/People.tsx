import { Users, Phone, ShieldCheck, Plus } from "lucide-react";
import { useListMembers, useListContacts } from "@workspace/api-client-react";
import CategoryBadge from "@/components/CategoryBadge";

import { V } from "@/lib/brand";

const ROLE_LABELS: Record<string, string> = {
  admin:      "Administradora",
  member:     "Membro",
  restricted: "Restrito",
};

export default function PeoplePage() {
  const { data: members, isLoading: loadingMembers } = useListMembers();
  const { data: contacts, isLoading: loadingContacts } = useListContacts({});

  return (
    <div className="px-4 py-6 space-y-7 animate-fade-in-up">
      <div>
        <h1 className="font-serif text-3xl font-semibold" style={{ color: V.ink }}>Pessoas</h1>
        <p className="text-sm mt-1" style={{ color: V.muted }}>Membros da família e contatos da casa.</p>
      </div>

      {/* Family members */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: V.muted }}>Família</h2>
        {loadingMembers ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 rounded-3xl animate-pulse" style={{ background: V.cream }} />)}</div>
        ) : (
          <div className="space-y-2.5">
            {members?.map((m) => (
              <div key={m.id} className="flex items-center gap-4 rounded-3xl px-5 py-4"
                style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}
                data-testid={`member-${m.id}`}>
                <div className="w-11 h-11 rounded-full flex items-center justify-center text-base font-bold text-white shrink-0"
                  style={{ background: V.primary }}>
                  {m.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: V.ink }}>{m.name}</p>
                  <p className="text-xs mt-0.5" style={{ color: V.muted }}>{ROLE_LABELS[m.role] ?? m.role}</p>
                </div>
                {m.role === "admin" && (
                  <ShieldCheck className="h-4 w-4 shrink-0" style={{ color: V.primary }} />
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Contacts */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: V.muted }}>Contatos da casa</h2>
          <button className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-white"
            style={{ background: V.primary }}>
            <Plus className="h-3.5 w-3.5" />
            Adicionar
          </button>
        </div>

        {loadingContacts ? (
          <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-14 rounded-3xl animate-pulse" style={{ background: V.cream }} />)}</div>
        ) : !contacts?.length ? (
          <div className="rounded-3xl p-10 text-center" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
            <Users className="h-10 w-10 mx-auto mb-3 opacity-30" style={{ color: V.primary }} />
            <p className="text-sm font-medium" style={{ color: V.ink }}>Nenhum contato ainda</p>
            <p className="text-xs mt-1" style={{ color: V.muted }}>Adicione escola, médico, diarista e mais.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {contacts.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-3xl px-5 py-3.5"
                style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}
                data-testid={`contact-${c.id}`}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                  style={{ background: "#EAF1E5", color: V.primary }}>
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: V.ink }}>{c.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <CategoryBadge category={c.category} />
                    {c.phone && (
                      <span className="flex items-center gap-1 text-xs" style={{ color: V.muted }}>
                        <Phone className="h-3 w-3" />{c.phone}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
