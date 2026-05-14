import { ShoppingBag, Wrench, Sparkles, Car, Package, ChevronRight, Plus } from "lucide-react";

const V = { primary: "#0E3B2E", deep: "#08251E", sage: "#6F856F", ivory: "#F7F4EA", cream: "#FFFDF6", beige: "#EEE6D6", warm: "#F1EBDD", ink: "#12231C", muted: "#5F6B61", gold: "#D9B95F" };

const SERVICES = [
  { icon: <Wrench className="h-6 w-6" />,    title: "Encontrar eletricista",       desc: "A Vesta pesquisa, compara e agenda para você.", color: "#EAF1E5" },
  { icon: <Sparkles className="h-6 w-6" />,  title: "Agendar limpeza",             desc: "Diaristas disponíveis na sua região.", color: "#EAF1E5" },
  { icon: <ShoppingBag className="h-6 w-6" />,title: "Comprar presente",           desc: "Sugestões personalizadas e entrega garantida.", color: "#EAF1E5" },
  { icon: <Package className="h-6 w-6" />,   title: "Repor supermercado",          desc: "Lista automática com base nos seus hábitos.", color: "#EAF1E5" },
  { icon: <Car className="h-6 w-6" />,       title: "Reservar atividade infantil", desc: "Esporte, cultura e lazer para a família.", color: "#EAF1E5" },
  { icon: <ShoppingBag className="h-6 w-6" />,title: "Comparar orçamento",         desc: "Receba 3 orçamentos e escolha com segurança.", color: "#EAF1E5" },
];

const RECENT = [
  { title: "Eletricista — tomada da cozinha", status: "Em andamento",    statusColor: V.primary },
  { title: "Diarista — limpeza pós-obras",    status: "Aguardando resp.", statusColor: "#92400E" },
  { title: "Presente Bia — aniversário 7 anos", status: "Resolvido",   statusColor: "#065F46" },
];

export default function ConciergePage() {
  return (
    <div className="px-4 py-6 space-y-7 animate-fade-in-up">
      <div>
        <h1 className="font-serif text-3xl font-semibold" style={{ color: V.ink }}>Concierge</h1>
        <p className="text-sm mt-1" style={{ color: V.muted }}>Delegue o que você não quer ou não tem tempo de fazer.</p>
      </div>

      {/* New request */}
      <div className="rounded-3xl p-6 text-white" style={{ background: V.primary }}>
        <p className="text-xs font-semibold uppercase tracking-widest opacity-70 mb-2">Nova solicitação</p>
        <p className="font-serif text-xl font-semibold mb-4 leading-snug">O que você precisa resolver hoje?</p>
        <div className="flex gap-2">
          <input
            placeholder="Ex: encontrar um eletricista para amanhã"
            className="flex-1 rounded-full px-4 py-2.5 text-sm outline-none"
            style={{ background: "rgba(255,255,255,0.15)", color: "white" }}
          />
          <button className="rounded-full px-5 py-2.5 text-sm font-semibold"
            style={{ background: V.gold, color: V.deep }}>
            Pedir
          </button>
        </div>
      </div>

      {/* Service categories */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: V.muted }}>Serviços frequentes</h2>
        <div className="grid grid-cols-2 gap-3">
          {SERVICES.map((s) => (
            <button key={s.title} className="rounded-3xl p-4 text-left transition-opacity hover:opacity-80"
              style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-3"
                style={{ background: "#EAF1E5", color: V.primary }}>
                {s.icon}
              </div>
              <p className="text-sm font-semibold leading-snug" style={{ color: V.ink }}>{s.title}</p>
              <p className="text-xs mt-1 leading-snug" style={{ color: V.muted }}>{s.desc}</p>
            </button>
          ))}
        </div>
      </section>

      {/* Recent requests */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: V.muted }}>Solicitações recentes</h2>
        <div className="rounded-3xl overflow-hidden" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
          {RECENT.map((r, i) => (
            <div key={r.title}
              className="flex items-center justify-between px-5 py-4"
              style={{ borderTop: i > 0 ? "1px solid rgba(14,59,46,0.07)" : "none" }}>
              <div>
                <p className="text-sm font-medium" style={{ color: V.ink }}>{r.title}</p>
                <span className="text-xs font-semibold mt-0.5 inline-block px-2 py-0.5 rounded-full"
                  style={{ background: `${r.statusColor}18`, color: r.statusColor }}>
                  {r.status}
                </span>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: V.sage }} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
