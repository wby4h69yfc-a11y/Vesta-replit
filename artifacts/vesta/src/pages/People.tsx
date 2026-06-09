import { useState } from "react";
import { Users, Phone, ShieldCheck, Plus, Star, AlertTriangle, ChevronRight, X, Send } from "lucide-react";
import {
  useListMembers,
  useListContacts,
  useRateContact,
  useRequestContactRating,
  useUpdateContact,
} from "@workspace/api-client-react";
import CategoryBadge from "@/components/CategoryBadge";
import { V } from "@/lib/brand";
import type { Contact } from "@workspace/api-client-react";

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  admin:      "Administradora",
  member:     "Membro",
  restricted: "Restrito",
};

const SERVICE_CATEGORY_LABELS: Record<string, string> = {
  diarista:              "Diarista",
  eletricista:           "Eletricista",
  encanador:             "Encanador",
  pintor:                "Pintor",
  jardineiro:            "Jardineiro",
  ar_condicionado:       "Ar-condicionado",
  dedetizadora:          "Dedetizadora",
  piscineiro:            "Piscineiro",
  marido_de_aluguel:     "Marido de aluguel",
  mudanca:               "Mudança",
  tecnico_eletrodomestico: "Técnico",
  outro:                 "Outros serviços",
};

// ── Reliability badge ─────────────────────────────────────────────────────────

function ReliabilityBadge({ status }: { status: string | null | undefined }) {
  const s = status ?? "untested";
  const config: Record<string, { label: string; bg: string; color: string; icon: string }> = {
    preferred: { label: "Preferido", bg: "#D1FAE5", color: "#065F46", icon: "⭐" },
    backup:    { label: "Backup",    bg: "#FEF3C7", color: "#92400E", icon: "🔄" },
    avoid:     { label: "Evitar",    bg: "#FEE2E2", color: "#991B1B", icon: "⚠️" },
    untested:  { label: "Não testado", bg: "#F3F4F6", color: "#6B7280", icon: "⚪" },
  };
  const c = config[s] ?? config.untested;
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: c.bg, color: c.color }}>
      <span>{c.icon}</span>
      {c.label}
    </span>
  );
}

// ── Star rating display ───────────────────────────────────────────────────────

function StarRating({ rating, max = 5 }: { rating: number | null | undefined; max?: number }) {
  if (!rating) return null;
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <Star key={i}
          className="h-3 w-3"
          fill={i < rating ? "#F59E0B" : "none"}
          style={{ color: i < rating ? "#F59E0B" : "#D1D5DB" }}
        />
      ))}
    </span>
  );
}

// ── Format date ───────────────────────────────────────────────────────────────

function formatDate(d: string | null | undefined): string | null {
  if (!d) return null;
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Provider detail drawer ────────────────────────────────────────────────────

type RatingKw = "bom" | "ok" | "ruim" | "no_show";

interface DrawerProps {
  contact: Contact;
  onClose: () => void;
  onRefetch: () => void;
}

function ProviderDrawer({ contact, onClose, onRefetch }: DrawerProps) {
  const [notes, setNotes] = useState(contact.reliability_notes ?? "");
  const [priceRange, setPriceRange] = useState(contact.last_price_range ?? "");
  const [editingNotes, setEditingNotes] = useState(false);
  const [ratingDone, setRatingDone] = useState(false);

  const { mutate: rate, isPending: rating } = useRateContact();
  const { mutate: requestRating, isPending: sending } = useRequestContactRating();
  const { mutate: patch } = useUpdateContact();

  function handleRate(kw: RatingKw) {
    rate(
      { id: contact.id, data: { rating: kw } },
      {
        onSuccess: () => {
          setRatingDone(true);
          onRefetch();
        },
      },
    );
  }

  function handleSaveNotes() {
    patch(
      { id: contact.id, data: { reliability_notes: notes, last_price_range: priceRange || undefined } },
      { onSuccess: () => { setEditingNotes(false); onRefetch(); } },
    );
  }

  function handleSetStatus(status: "preferred" | "backup" | "avoid" | "untested") {
    patch(
      { id: contact.id, data: { reliability_status: status } },
      { onSuccess: onRefetch },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative rounded-t-3xl overflow-y-auto max-h-[85vh]"
        style={{ background: V.ivory }}>
        {/* Handle + close */}
        <div className="flex justify-between items-center px-6 pt-5 pb-1">
          <div className="w-10 h-1 rounded-full mx-auto absolute left-1/2 -translate-x-1/2 top-3"
            style={{ background: "rgba(0,0,0,0.15)" }} />
          <div />
          <button onClick={onClose} className="p-2 rounded-full" style={{ background: V.cream }}>
            <X className="h-4 w-4" style={{ color: V.muted }} />
          </button>
        </div>

        <div className="px-6 pb-10 space-y-6">
          {/* Header */}
          <div className="flex items-start gap-4 pt-1">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold text-white shrink-0"
              style={{ background: V.primary }}>
              {contact.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-semibold" style={{ color: V.ink }}>{contact.name}</h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {contact.service_category && (
                  <span className="text-sm" style={{ color: V.muted }}>
                    {SERVICE_CATEGORY_LABELS[contact.service_category] ?? contact.service_category}
                  </span>
                )}
                <ReliabilityBadge status={contact.reliability_status} />
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl p-3 text-center" style={{ background: V.cream }}>
              <StarRating rating={contact.household_rating} />
              {!contact.household_rating && <span className="text-xs" style={{ color: V.muted }}>Sem avaliação</span>}
              <p className="text-xs mt-1" style={{ color: V.muted }}>Qualidade</p>
            </div>
            <div className="rounded-2xl p-3 text-center" style={{ background: V.cream }}>
              <p className="text-base font-semibold" style={{ color: (contact.no_show_count ?? 0) > 0 ? "#DC2626" : V.ink }}>
                {contact.no_show_count ?? 0}
              </p>
              <p className="text-xs" style={{ color: V.muted }}>Faltas</p>
            </div>
            <div className="rounded-2xl p-3 text-center" style={{ background: V.cream }}>
              <p className="text-sm font-medium" style={{ color: V.ink }}>
                {contact.last_used_at ? formatDate(contact.last_used_at) : "—"}
              </p>
              <p className="text-xs mt-0.5" style={{ color: V.muted }}>Último uso</p>
            </div>
          </div>

          {/* Price range */}
          {contact.last_price_range && (
            <div className="rounded-2xl px-4 py-3" style={{ background: V.cream }}>
              <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: V.muted }}>Faixa de preço</p>
              <p className="text-sm font-medium" style={{ color: V.ink }}>{contact.last_price_range}</p>
            </div>
          )}

          {/* Quick rate buttons */}
          {!ratingDone && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: V.muted }}>Avaliar serviço</p>
              <div className="grid grid-cols-2 gap-2">
                {([ ["bom", "✅ Bom", "#D1FAE5", "#065F46"], ["ok", "👍 Ok", "#FEF9C3", "#78350F"], ["ruim", "⚠️ Ruim", "#FEE2E2", "#991B1B"], ["no_show", "🚫 Não apareceu", "#F3F4F6", "#374151"] ] as const).map(([kw, label, bg, color]) => (
                  <button key={kw}
                    disabled={rating}
                    onClick={() => handleRate(kw)}
                    className="rounded-2xl py-3 px-3 text-sm font-medium text-center transition-opacity disabled:opacity-50"
                    style={{ background: bg, color }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {ratingDone && (
            <div className="rounded-2xl p-4 text-center" style={{ background: "#D1FAE5" }}>
              <p className="text-sm font-medium" style={{ color: "#065F46" }}>✅ Avaliação registrada!</p>
            </div>
          )}

          {/* Status override */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: V.muted }}>Status do prestador</p>
            <div className="flex gap-2 flex-wrap">
              {([ ["preferred", "⭐ Preferido"], ["backup", "🔄 Backup"], ["avoid", "⚠️ Evitar"], ["untested", "⚪ Não testado"] ] as const).map(([s, label]) => (
                <button key={s}
                  onClick={() => handleSetStatus(s)}
                  className="rounded-full px-3 py-1.5 text-xs font-medium border transition-all"
                  style={{
                    background: contact.reliability_status === s ? V.primary : "transparent",
                    color: contact.reliability_status === s ? "white" : V.ink,
                    borderColor: contact.reliability_status === s ? V.primary : "rgba(14,59,46,0.2)",
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Notes editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: V.muted }}>Notas de confiabilidade</p>
              {!editingNotes && (
                <button onClick={() => setEditingNotes(true)}
                  className="text-xs font-medium" style={{ color: V.primary }}>
                  {notes ? "Editar" : "+ Adicionar"}
                </button>
              )}
            </div>
            {editingNotes ? (
              <div className="space-y-2">
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ex: Prefere pagamento em dinheiro. Confirmar na véspera."
                  className="w-full rounded-2xl px-4 py-3 text-sm resize-none outline-none"
                  style={{ background: V.cream, color: V.ink, border: `1.5px solid ${V.primary}` }}
                />
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={priceRange}
                    onChange={(e) => setPriceRange(e.target.value)}
                    placeholder="Faixa de preço (ex: R$80–120)"
                    className="flex-1 rounded-2xl px-4 py-2.5 text-sm outline-none"
                    style={{ background: V.cream, color: V.ink, border: "1px solid rgba(14,59,46,0.2)" }}
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditingNotes(false)}
                    className="flex-1 rounded-full py-2.5 text-sm font-medium"
                    style={{ background: V.cream, color: V.muted }}>
                    Cancelar
                  </button>
                  <button onClick={handleSaveNotes}
                    className="flex-1 rounded-full py-2.5 text-sm font-medium text-white"
                    style={{ background: V.primary }}>
                    Salvar
                  </button>
                </div>
              </div>
            ) : notes ? (
              <p className="text-sm rounded-2xl px-4 py-3" style={{ background: V.cream, color: V.ink }}>{notes}</p>
            ) : (
              <p className="text-sm italic" style={{ color: V.muted }}>Nenhuma nota ainda.</p>
            )}
          </div>

          {/* Payment notes */}
          {contact.payment_notes && (
            <div className="rounded-2xl px-4 py-3" style={{ background: V.cream }}>
              <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: V.muted }}>Notas de pagamento</p>
              <p className="text-sm" style={{ color: V.ink }}>{contact.payment_notes}</p>
            </div>
          )}

          {/* Send WA rating request */}
          {contact.phone && (
            <button
              disabled={sending}
              onClick={() => requestRating({ id: contact.id })}
              className="w-full flex items-center justify-center gap-2 rounded-full py-3.5 text-sm font-medium border disabled:opacity-50"
              style={{ borderColor: V.primary, color: V.primary }}>
              <Send className="h-4 w-4" />
              {sending ? "Enviando…" : "Pedir avaliação via WhatsApp"}
            </button>
          )}

          {/* Phone */}
          {contact.phone && (
            <a href={`tel:${contact.phone}`}
              className="flex items-center gap-2 text-sm"
              style={{ color: V.muted }}>
              <Phone className="h-4 w-4" />
              {contact.phone}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PeoplePage() {
  const { data: members, isLoading: loadingMembers } = useListMembers();
  const { data: contacts, isLoading: loadingContacts, refetch: refetchContacts } = useListContacts({});
  const [selectedProvider, setSelectedProvider] = useState<Contact | null>(null);

  // Split contacts into household contacts and service providers
  const providers = contacts?.filter((c) => c.service_category != null) ?? [];
  const householdContacts = contacts?.filter((c) => !c.service_category) ?? [];

  // Sort providers: preferred first, then by name
  const sortedProviders = [...providers].sort((a, b) => {
    const order: Record<string, number> = { preferred: 0, backup: 1, untested: 2, avoid: 3 };
    const da = order[a.reliability_status ?? "untested"] ?? 2;
    const db_ = order[b.reliability_status ?? "untested"] ?? 2;
    if (da !== db_) return da - db_;
    return a.name.localeCompare(b.name, "pt-BR");
  });

  return (
    <>
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

        {/* Service Providers */}
        {(loadingContacts || sortedProviders.length > 0) && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: V.muted }}>
                Prestadores de Serviço
              </h2>
            </div>

            {loadingContacts ? (
              <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-20 rounded-3xl animate-pulse" style={{ background: V.cream }} />)}</div>
            ) : (
              <div className="space-y-2">
                {sortedProviders.map((c) => (
                  <button key={c.id}
                    onClick={() => setSelectedProvider(c)}
                    className="w-full text-left flex items-center gap-3 rounded-3xl px-5 py-4"
                    style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}
                    data-testid={`provider-${c.id}`}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0"
                      style={{ background: "#EAF1E5", color: V.primary }}>
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium" style={{ color: V.ink }}>{c.name}</p>
                        <ReliabilityBadge status={c.reliability_status} />
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {c.service_category && (
                          <span className="text-xs" style={{ color: V.muted }}>
                            {SERVICE_CATEGORY_LABELS[c.service_category] ?? c.service_category}
                          </span>
                        )}
                        {c.household_rating != null && (
                          <StarRating rating={c.household_rating} />
                        )}
                        {c.last_used_at && (
                          <span className="text-xs" style={{ color: V.muted }}>
                            Usado {formatDate(c.last_used_at)}
                          </span>
                        )}
                        {(c.no_show_count ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs" style={{ color: "#DC2626" }}>
                            <AlertTriangle className="h-3 w-3" />
                            {c.no_show_count} {c.no_show_count === 1 ? "falta" : "faltas"}
                          </span>
                        )}
                        {c.last_price_range && (
                          <span className="text-xs" style={{ color: V.muted }}>{c.last_price_range}</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0" style={{ color: V.muted }} />
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Household contacts */}
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
          ) : !householdContacts.length && !sortedProviders.length ? (
            <div className="rounded-3xl p-10 text-center" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
              <Users className="h-10 w-10 mx-auto mb-3 opacity-30" style={{ color: V.primary }} />
              <p className="text-sm font-medium" style={{ color: V.ink }}>Nenhum contato ainda</p>
              <p className="text-xs mt-1" style={{ color: V.muted }}>Adicione escola, médico, diarista e mais.</p>
            </div>
          ) : !householdContacts.length ? null : (
            <div className="space-y-2">
              {householdContacts.map((c) => (
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

      {/* Provider detail drawer */}
      {selectedProvider && (
        <ProviderDrawer
          contact={selectedProvider}
          onClose={() => setSelectedProvider(null)}
          onRefetch={() => refetchContacts()}
        />
      )}
    </>
  );
}
