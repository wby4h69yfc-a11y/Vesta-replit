import { Link } from "wouter";
import { House, CheckCircle2, ArrowRight, Play, Star, Shield, Users, Calendar, Zap, MapPin } from "lucide-react";

const FEATURES = [
  {
    icon: "💬",
    title: "Capture de qualquer jeito",
    desc: "Fale, digite, envie um print, foto ou encaminhe uma mensagem. A Vesta entende.",
  },
  {
    icon: "✅",
    title: "Organiza e prioriza",
    desc: "A Vesta transforma o caos em planos claros, com prazos e prioridades.",
  },
  {
    icon: "👥",
    title: "Delega sem estresse",
    desc: "Tarefas vão para as pessoas certas, com contexto e sem cobranças.",
  },
  {
    icon: "📅",
    title: "Escreve no lugar certo",
    desc: "Compromissos e lembretes no calendário certo, sempre atualizados.",
  },
  {
    icon: "⚡",
    title: "Resolve por você",
    desc: "Precisa de ajuda? A Vesta encontra, agenda e acompanha.",
  },
  {
    icon: "🔒",
    title: "Privacidade é inegociável",
    desc: "Seus dados são seus. Seguros, privados e nunca compartilhados.",
  },
];

const STEPS = [
  {
    num: "1",
    title: "Você envia para a Vesta",
    desc: "Pode ser por WhatsApp, e-mail, foto, voz ou texto.",
  },
  {
    num: "2",
    title: "A Vesta entende e organiza",
    desc: "Ela identifica o que precisa ser feito e o contexto.",
  },
  {
    num: "3",
    title: "Você aprova e delega",
    desc: "Confirme, ajuste e escolha quem vai fazer o quê.",
  },
  {
    num: "4",
    title: "A Vesta coloca em ação",
    desc: "No calendário, nas listas e na vida real — com lembretes.",
  },
];

const INTEGRATIONS = [
  { label: "Google Calendar", color: "text-blue-600", bg: "bg-blue-50" },
  { label: "Outlook", color: "text-blue-700", bg: "bg-blue-50" },
  { label: "Apple Calendar", color: "text-gray-700", bg: "bg-gray-100" },
  { label: "WhatsApp", color: "text-green-700", bg: "bg-green-50" },
  { label: "iCloud", color: "text-sky-700", bg: "bg-sky-50" },
];

export default function Landing() {
  return (
    <div className="min-h-screen font-sans" style={{ background: "#F5F0E6", color: "#1B3A2D" }}>

      {/* ── NAV ── */}
      <header className="sticky top-0 z-50 border-b" style={{ background: "rgba(245,240,230,0.95)", borderColor: "#D8D0BE", backdropFilter: "blur(8px)" }}>
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center gap-6">
          <div className="flex items-center gap-2 mr-auto">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#1B3A2D" }}>
              <House className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight" style={{ color: "#1B3A2D" }}>vesta</span>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            {["Recursos", "Para famílias", "Preços", "Sobre nós"].map((l) => (
              <a key={l} href="#" className="text-sm font-medium hover:opacity-70 transition-opacity" style={{ color: "#1B3A2D" }}>{l}</a>
            ))}
          </nav>
          <div className="flex items-center gap-3 ml-4">
            <Link href="/hoje" className="hidden md:block text-sm font-medium hover:opacity-70 transition-opacity" style={{ color: "#1B3A2D" }}>Entrar</Link>
            <Link
              href="/hoje"
              className="px-4 py-2 rounded-full text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: "#1B3A2D" }}
            >
              Começar grátis
            </Link>
          </div>
        </div>
      </header>

      {/* ── HERO ── */}
      <section className="max-w-6xl mx-auto px-5 pt-16 pb-12 md:pt-20 md:pb-16">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            {/* Pill */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide" style={{ background: "#D8EDD5", color: "#1B3A2D" }}>
              <div className="w-1.5 h-1.5 rounded-full bg-green-600" />
              A CASA ANDANDO. VOCÊ PRESENTE.
            </div>

            {/* Headline */}
            <div>
              <h1 className="text-4xl md:text-5xl font-extrabold leading-tight tracking-tight" style={{ color: "#1B3A2D" }}>
                Tire a rotina<br />da sua cabeça.
              </h1>
              <h1 className="text-4xl md:text-5xl font-extrabold leading-tight tracking-tight mt-1" style={{ color: "#2D7A4F" }}>
                A casa em movimento.
              </h1>
            </div>

            <p className="text-base leading-relaxed max-w-md" style={{ color: "#4A6259" }}>
              A Vesta captura o que precisa ser feito, transforma em ações aprovadas, escreve no lugar certo, delega para as pessoas certas e ajuda a resolver quando você quiser.
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/hoje"
                className="px-6 py-3 rounded-full text-sm font-bold text-white transition-opacity hover:opacity-90"
                style={{ background: "#1B3A2D" }}
              >
                Começar grátis
              </Link>
              <a href="#como-funciona" className="flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold border-2 transition-colors hover:bg-white/50"
                style={{ borderColor: "#1B3A2D", color: "#1B3A2D" }}>
                <Play className="w-3.5 h-3.5 fill-current" />
                Ver como funciona
              </a>
            </div>

            {/* Social proof */}
            <div className="flex items-center gap-3 pt-1">
              <div className="flex -space-x-2">
                {["#C4A882", "#A8C4A0", "#C4B4A0", "#A0B4C4"].map((c, i) => (
                  <div key={i} className="w-8 h-8 rounded-full border-2 border-white" style={{ background: c }} />
                ))}
              </div>
              <div>
                <div className="flex gap-0.5">
                  {[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />)}
                </div>
                <p className="text-xs mt-0.5" style={{ color: "#4A6259" }}>Mais de 2,000 famílias já usam a Vesta</p>
              </div>
            </div>
          </div>

          {/* Phone mockup */}
          <div className="relative hidden md:flex justify-center items-start">
            {/* WhatsApp card 1 */}
            <div className="absolute left-0 top-8 z-10 bg-white rounded-2xl shadow-lg p-3 w-52 border" style={{ borderColor: "#E8E0D0" }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                  <span className="text-white text-[8px] font-bold">G</span>
                </div>
                <p className="text-xs font-semibold" style={{ color: "#1B3A2D" }}>Grupo da escola</p>
              </div>
              <p className="text-[11px] leading-snug" style={{ color: "#4A6259" }}>Festa junina dia 24/05! Quem pode ajudar com as barracas? 🎪</p>
              <div className="mt-2 flex justify-end">
                <ArrowRight className="w-3 h-3 text-green-600" />
              </div>
            </div>

            {/* Phone frame */}
            <div className="relative z-20 mx-auto w-56">
              <div className="rounded-3xl border-4 overflow-hidden shadow-2xl" style={{ borderColor: "#1B3A2D", background: "#F5F0E6" }}>
                {/* Status bar */}
                <div className="px-4 py-2 flex justify-between items-center" style={{ background: "#1B3A2D" }}>
                  <span className="text-white text-[9px]">9:41</span>
                  <span className="text-white text-[9px]">●●●</span>
                </div>
                {/* App content */}
                <div className="p-3 space-y-1" style={{ background: "#F5F0E6" }}>
                  <p className="text-[10px] font-bold" style={{ color: "#1B3A2D" }}>Bom dia, Camila! 👋</p>
                  <p className="text-[8px]" style={{ color: "#4A6259" }}>Sua casa, organizada com você.</p>
                  <div className="mt-2 space-y-1">
                    {[
                      { label: "Entrega de trabalho", time: "10:00 · Home Office", tag: null },
                      { label: "Yoga da Sofia", time: "14:30 · Clínica Vida", tag: "Saúde" },
                      { label: "Treino do Miguel", time: "16:00 · Escola Arena", tag: "Escola" },
                      { label: "Jantar em família", time: "19:30", tag: "Casa" },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between bg-white rounded-lg px-2 py-1.5">
                        <div>
                          <p className="text-[8px] font-semibold" style={{ color: "#1B3A2D" }}>{item.label}</p>
                          <p className="text-[7px]" style={{ color: "#4A6259" }}>{item.time}</p>
                        </div>
                        {item.tag && (
                          <span className="text-[7px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: "#D8EDD5", color: "#1B3A2D" }}>{item.tag}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                {/* Bottom nav */}
                <div className="flex border-t" style={{ borderColor: "#D8D0BE", background: "white" }}>
                  {["Hoje", "Para proc.", "Agenda", "Tarefas", "Casa"].map((t, i) => (
                    <div key={t} className="flex-1 flex flex-col items-center py-1.5">
                      <div className="w-2.5 h-2.5 rounded-sm mb-0.5" style={{ background: i === 0 ? "#1B3A2D" : "#C4B8A8" }} />
                      <span className="text-[6px]" style={{ color: i === 0 ? "#1B3A2D" : "#8A8070" }}>{t}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* WhatsApp card 2 */}
            <div className="absolute right-0 top-32 z-10 bg-white rounded-2xl shadow-lg p-3 w-52 border" style={{ borderColor: "#E8E0D0" }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                  <span className="text-white text-[8px]">@</span>
                </div>
                <p className="text-xs font-semibold" style={{ color: "#1B3A2D" }}>E-mail da escola</p>
              </div>
              <p className="text-[11px] leading-snug" style={{ color: "#4A6259" }}>Autorização para passeio pedagógico em anexo.</p>
              <div className="mt-2 flex justify-end">
                <ArrowRight className="w-3 h-3 text-blue-600" />
              </div>
            </div>

            {/* WhatsApp card 3 */}
            <div className="absolute right-4 bottom-8 z-10 bg-white rounded-2xl shadow-lg p-3 w-48 border" style={{ borderColor: "#E8E0D0" }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center">
                  <span className="text-white text-[8px]">📷</span>
                </div>
                <p className="text-xs font-semibold" style={{ color: "#1B3A2D" }}>Foto do bilhete</p>
              </div>
              <p className="text-[11px] leading-snug" style={{ color: "#4A6259" }}>Trazer 1kg de alimento não perecível até 20/05.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── INTEGRATIONS ── */}
      <section className="border-y py-5" style={{ borderColor: "#D8D0BE", background: "rgba(255,255,255,0.4)" }}>
        <div className="max-w-6xl mx-auto px-5">
          <div className="flex flex-wrap items-center gap-3 md:gap-6">
            <p className="text-sm font-medium mr-2" style={{ color: "#4A6259" }}>Funciona com o que<br className="hidden sm:block" /> sua família já usa</p>
            <div className="w-px h-8 hidden md:block" style={{ background: "#D8D0BE" }} />
            {INTEGRATIONS.map((intg) => (
              <div key={intg.label} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${intg.bg} ${intg.color}`}>
                {intg.label}
              </div>
            ))}
            <div className="px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">e mais</div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="max-w-6xl mx-auto px-5 py-16 md:py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-extrabold" style={{ color: "#1B3A2D" }}>Tudo o que sua família precisa.</h2>
          <h2 className="text-3xl md:text-4xl font-extrabold" style={{ color: "#1B3A2D" }}>Em um só lugar.</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-5 md:gap-8">
          {FEATURES.map((f) => (
            <div key={f.title} className="space-y-3">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl" style={{ background: "#D8EDD5" }}>
                {f.icon}
              </div>
              <h3 className="font-bold text-base leading-snug" style={{ color: "#1B3A2D" }}>{f.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: "#4A6259" }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="como-funciona" className="py-16 md:py-20" style={{ background: "rgba(255,255,255,0.5)" }}>
        <div className="max-w-6xl mx-auto px-5">
          <h2 className="text-3xl md:text-4xl font-extrabold text-center mb-12" style={{ color: "#1B3A2D" }}>Como funciona</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {STEPS.map((step, i) => (
              <div key={step.num} className="relative">
                {i < STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-6 left-full w-full h-px z-0" style={{ background: "#D8D0BE" }} />
                )}
                <div className="relative z-10 space-y-4">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-md" style={{ background: "#1B3A2D" }}>
                    {step.num}
                  </div>
                  <div className="space-y-1.5 bg-white rounded-2xl p-4 shadow-sm border" style={{ borderColor: "#E8E0D0" }}>
                    <p className="font-bold text-sm leading-snug" style={{ color: "#1B3A2D" }}>{step.title}</p>
                    <p className="text-xs leading-relaxed" style={{ color: "#4A6259" }}>{step.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIAL + CTA ── */}
      <section className="max-w-6xl mx-auto px-5 py-16 md:py-20">
        <div className="grid md:grid-cols-2 gap-10 items-center">
          {/* Quote */}
          <div className="rounded-3xl p-8 space-y-4" style={{ background: "#1B3A2D" }}>
            <div className="text-4xl text-green-400">"</div>
            <p className="text-lg font-medium leading-relaxed text-white">
              A Vesta virou o coração da nossa casa. Nada fica esquecido, e a rotina finalmente não depende só de mim.
            </p>
            <div>
              <p className="text-sm font-semibold text-green-300">Juliana</p>
              <p className="text-xs text-green-400/70">mãe do Theo e da Bia</p>
            </div>
            <div className="flex gap-0.5 pt-1">
              {[1,2,3,4,5].map(i => <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />)}
            </div>
          </div>

          {/* CTA */}
          <div className="space-y-5 text-center md:text-left">
            <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#2D7A4F" }}>Menos cobrança. Mais combinados.</p>
            <h2 className="text-3xl md:text-4xl font-extrabold leading-tight" style={{ color: "#1B3A2D" }}>
              Pronto para sentir<br />sua casa mais leve?
            </h2>
            <p className="text-sm" style={{ color: "#4A6259" }}>Comece grátis. Sem compromisso.</p>
            <Link
              href="/hoje"
              className="inline-block px-8 py-3.5 rounded-full text-base font-bold text-white transition-opacity hover:opacity-90"
              style={{ background: "#1B3A2D" }}
            >
              Começar agora
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t py-8" style={{ borderColor: "#D8D0BE" }}>
        <div className="max-w-6xl mx-auto px-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#1B3A2D" }}>
              <House className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold" style={{ color: "#1B3A2D" }}>vesta</span>
          </div>
          <p className="text-xs" style={{ color: "#8A8070" }}>© 2026 Vesta. Feito com carinho para famílias brasileiras.</p>
          <div className="flex gap-5">
            {["Privacidade", "Termos"].map((l) => (
              <a key={l} href="#" className="text-xs hover:underline" style={{ color: "#8A8070" }}>{l}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
