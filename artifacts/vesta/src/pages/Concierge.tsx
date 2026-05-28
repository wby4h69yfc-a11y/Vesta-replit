import { ShoppingBag, Wrench, Sparkles, Car, Package, Clock } from "lucide-react";

const V = { primary: "#0E3B2E", deep: "#08251E", sage: "#6F856F", ivory: "#F7F4EA", cream: "#FFFDF6", beige: "#EEE6D6", warm: "#F1EBDD", ink: "#12231C", muted: "#5F6B61", gold: "#D9B95F" };

const SERVICES = [
  { icon: <Wrench className="h-6 w-6" />,     title: "Encontrar eletricista",        desc: "Pesquisa, compara e agenda para você." },
  { icon: <Sparkles className="h-6 w-6" />,   title: "Agendar limpeza",              desc: "Diaristas disponíveis na sua região." },
  { icon: <ShoppingBag className="h-6 w-6" />, title: "Comprar presente",            desc: "Sugestões personalizadas e entrega garantida." },
  { icon: <Package className="h-6 w-6" />,    title: "Repor supermercado",           desc: "Lista automática com base nos seus hábitos." },
  { icon: <Car className="h-6 w-6" />,        title: "Reservar atividade infantil",  desc: "Esporte, cultura e lazer para a família." },
  { icon: <ShoppingBag className="h-6 w-6" />, title: "Comparar orçamento",          desc: "Receba 3 orçamentos e escolha com segurança." },
];

export default function ConciergePage() {
  return (
    <div className="px-4 py-6 space-y-7 animate-fade-in-up">

      {/* Em breve banner */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-2xl"
        style={{ background: "#FEF3C7", border: "1px solid #FDE68A" }}>
        <Clock className="h-4 w-4 shrink-0" style={{ color: "#D97706" }} />
        <div>
          <p className="text-xs font-semibold" style={{ color: "#92400E" }}>Em breve</p>
          <p className="text-xs" style={{ color: "#B45309" }}>
            O Concierge está em desenvolvimento e será liberado em breve para usuários premium.
          </p>
        </div>
      </div>

      <div>
        <h1 className="font-serif text-3xl font-semibold" style={{ color: V.ink }}>Concierge</h1>
        <p className="text-sm mt-1" style={{ color: V.muted }}>Delegue o que você não quer ou não tem tempo de fazer.</p>
      </div>

      {/* New request — disabled */}
      <div className="rounded-3xl p-6 text-white opacity-50 pointer-events-none select-none"
        style={{ background: V.primary }}>
        <p className="text-xs font-semibold uppercase tracking-widest opacity-70 mb-2">Nova solicitação</p>
        <p className="font-serif text-xl font-semibold mb-4 leading-snug">O que você precisa resolver hoje?</p>
        <div className="flex gap-2">
          <input
            placeholder="Funcionalidade em desenvolvimento…"
            disabled
            title="funcionalidade em desenvolvimento"
            className="flex-1 rounded-full px-4 py-2.5 text-sm outline-none cursor-not-allowed"
            style={{ background: "rgba(255,255,255,0.15)", color: "white" }}
          />
          <button disabled title="funcionalidade em desenvolvimento"
            className="rounded-full px-5 py-2.5 text-sm font-semibold cursor-not-allowed"
            style={{ background: V.gold, color: V.deep }}>
            Pedir
          </button>
        </div>
      </div>

      {/* Service categories */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: V.muted }}>Serviços disponíveis em breve</h2>
        <div className="grid grid-cols-2 gap-3 opacity-50 pointer-events-none select-none">
          {SERVICES.map((s) => (
            <div key={s.title} className="rounded-3xl p-4 text-left"
              style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-3"
                style={{ background: "#EAF1E5", color: V.primary }}>
                {s.icon}
              </div>
              <p className="text-sm font-semibold leading-snug" style={{ color: V.ink }}>{s.title}</p>
              <p className="text-xs mt-1 leading-snug" style={{ color: V.muted }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
