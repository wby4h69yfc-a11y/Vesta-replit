import { useState } from "react";
import { Link } from "wouter";
import {
  CalendarDays, Check, ChevronRight, Cloud, Home, Inbox,
  ListChecks, Mail, Menu, MoreHorizontal, Play, Plus,
  Search, Send, ShieldCheck, Sparkles, Users, WalletCards,
  Wand2, MessageCircle, Camera, Car, ShoppingBag, X,
} from "lucide-react";

/* ── Design tokens ── */
const V = {
  primary:  "#0E3B2E",
  deep:     "#08251E",
  sage:     "#6F856F",
  ivory:    "#F7F4EA",
  cream:    "#FFFDF6",
  beige:    "#EEE6D6",
  warm:     "#F1EBDD",
  softSage: "#DDE8D8",
  gold:     "#D9B95F",
  ink:      "#12231C",
  muted:    "#5F6B61",
};

/* ── Shared Components ── */
function VButton({
  children,
  variant = "primary",
  className = "",
  href,
  onClick,
}: {
  children: React.ReactNode;
  variant?: "primary" | "ghost" | "light";
  className?: string;
  href?: string;
  onClick?: () => void;
}) {
  const base = "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all";
  const styles = {
    primary: `bg-[${V.primary}] text-white hover:bg-[${V.deep}] shadow-[0_12px_30px_rgba(14,59,46,0.18)]`,
    ghost:   `bg-transparent text-[${V.ink}] hover:bg-[${V.primary}]/5 border border-[${V.primary}]/10`,
    light:   `bg-[${V.cream}] text-[${V.primary}] hover:bg-white border border-[${V.primary}]/10`,
  };
  const cls = `${base} ${className}`;
  if (href) {
    return (
      <Link href={href} className={cls} style={{
        background: variant === "primary" ? V.primary : variant === "light" ? V.cream : "transparent",
        color: variant === "primary" ? "white" : V.ink,
        border: variant !== "primary" ? `1px solid rgba(14,59,46,0.12)` : "none",
      }}>
        {children}
      </Link>
    );
  }
  return (
    <button onClick={onClick} className={cls} style={{
      background: variant === "primary" ? V.primary : variant === "light" ? V.cream : "transparent",
      color: variant === "primary" ? "white" : V.ink,
      border: variant !== "primary" ? `1px solid rgba(14,59,46,0.12)` : "none",
      boxShadow: variant === "primary" ? "0 12px 30px rgba(14,59,46,0.18)" : "none",
    }}>
      {children}
    </button>
  );
}

function VBadge({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[11px] font-semibold tracking-[0.12em]"
      style={{ background: "#EAF1E5", color: V.primary }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: V.primary }} />
      {children}
    </div>
  );
}

function IntakeCard({ icon, title, children, className = "" }: {
  icon: React.ReactNode; title: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`rounded-3xl p-5 backdrop-blur ${className}`}
      style={{ background: "rgba(255,253,246,0.95)", border: `1px solid rgba(14,59,46,0.1)`, boxShadow: "0 20px 50px rgba(24,38,30,0.08)" }}>
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <p className="text-sm font-bold" style={{ color: V.ink }}>{title}</p>
      </div>
      <div className="text-sm leading-relaxed" style={{ color: "#3D4A40" }}>{children}</div>
    </div>
  );
}

function PhoneMockup() {
  const tasks = [
    { icon: <Inbox className="h-4 w-4" />,       title: "Entrega de trabalho", time: "10:00 · Home Office",  tag: "" },
    { icon: <CalendarDays className="h-4 w-4" />, title: "Vacina da Sofia",     time: "14:30 · Clínica Vida", tag: "Saúde" },
    { icon: <Sparkles className="h-4 w-4" />,     title: "Treino do Miguel",    time: "16:00 · Escola Arena", tag: "Esporte" },
    { icon: <Users className="h-4 w-4" />,        title: "Jantar em família",   time: "19:30",                tag: "Casa" },
    { icon: <WalletCards className="h-4 w-4" />,  title: "Pagar conta de luz",  time: "Vence amanhã",         tag: "Financeiro" },
  ];

  return (
    <div className="relative mx-auto h-[590px] w-[302px] rounded-[46px] border-[8px] border-[#111] shadow-[0_30px_80px_rgba(0,0,0,0.28)]"
      style={{ background: V.ivory }}>
      <div className="absolute left-1/2 top-2 h-7 w-28 -translate-x-1/2 rounded-full bg-black" />
      <div className="flex h-full flex-col overflow-hidden rounded-[36px] px-5 pb-4 pt-12" style={{ background: "#F8F5EC" }}>
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-lg font-bold" style={{ color: V.ink }}>Bom dia, Camila ☀️</p>
            <p className="text-xs" style={{ color: V.muted }}>Sua casa, organizada com você.</p>
          </div>
          <Search className="h-5 w-5" style={{ color: V.ink }} />
        </div>
        <p className="mb-3 text-sm font-bold" style={{ color: V.ink }}>Hoje · 18 de maio</p>
        <div className="space-y-2">
          {tasks.map((t) => (
            <div key={t.title} className="rounded-2xl p-3 shadow-sm"
              style={{ background: V.cream, border: `1px solid rgba(14,59,46,0.08)` }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: "#EAF1E5", color: V.primary }}>
                    {t.icon}
                  </div>
                  <div>
                    <p className="text-xs font-bold" style={{ color: V.ink }}>{t.title}</p>
                    <p className="text-[10px]" style={{ color: V.muted }}>{t.time}</p>
                  </div>
                </div>
                {t.tag ? (
                  <span className="rounded-full px-2 py-1 text-[9px] font-semibold" style={{ background: V.softSage, color: V.primary }}>{t.tag}</span>
                ) : (
                  <div className="h-4 w-4 rounded-full border" style={{ borderColor: `rgba(14,59,46,0.3)` }} />
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-auto grid grid-cols-5 items-center rounded-3xl px-2 py-2 shadow-sm" style={{ background: V.cream, color: V.primary }}>
          {[
            { icon: <Home className="h-4 w-4" />, label: "Início", active: true },
            { icon: <CalendarDays className="h-4 w-4" />, label: "Planej." },
            { center: true },
            { icon: <Users className="h-4 w-4" />, label: "Pessoas" },
            { icon: <MoreHorizontal className="h-4 w-4" />, label: "Mais" },
          ].map((tab, i) =>
            tab.center ? (
              <button key={i} className="mx-auto flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg"
                style={{ background: V.primary }}>
                <Plus className="h-6 w-6" />
              </button>
            ) : (
              <div key={i} className="flex flex-col items-center gap-1 text-[9px]"
                style={{ color: tab.active ? V.primary : V.sage }}>
                {tab.icon}
                <span>{tab.label}</span>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sections ── */
function Nav({ mobileOpen, setMobileOpen }: { mobileOpen: boolean; setMobileOpen: (v: boolean) => void }) {
  return (
    <header className="sticky top-0 z-50" style={{ background: "rgba(247,244,234,0.92)", backdropFilter: "blur(12px)", borderBottom: `1px solid rgba(14,59,46,0.08)` }}>
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl" style={{ border: `1px solid rgba(14,59,46,0.2)` }}>
            <Home className="h-6 w-6" style={{ color: V.primary }} strokeWidth={1.8} />
          </div>
          <span className="text-2xl font-semibold tracking-tight" style={{ color: V.ink }}>vesta</span>
        </div>

        <nav className="hidden items-center gap-8 text-sm font-medium md:flex" style={{ color: V.ink }}>
          {[
            ["Recursos",      "#recursos"],
            ["Para famílias", "#para-familias"],
            ["Preços",        "#precos"],
            ["Sobre nós",     "#sobre-nos"],
          ].map(([label, href]) => (
            <a key={label} href={href} className="hover:opacity-60 transition-opacity">{label}</a>
          ))}
        </nav>

        <div className="hidden items-center gap-4 md:flex">
          <Link href="/app" className="text-sm font-semibold hover:opacity-60 transition-opacity" style={{ color: V.ink }}>Entrar</Link>
          <VButton href="/app">Começar grátis</VButton>
        </div>

        <button className="md:hidden" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X className="h-6 w-6" style={{ color: V.primary }} /> : <Menu className="h-6 w-6" style={{ color: V.primary }} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t px-6 pb-6 md:hidden" style={{ borderColor: `rgba(14,59,46,0.08)` }}>
          <div className="space-y-3 pt-4">
            {["Recursos", "Para famílias", "Preços", "Sobre nós"].map((l) => (
              <a key={l} href="#" className="block text-sm font-medium" style={{ color: V.ink }}>{l}</a>
            ))}
          </div>
          <VButton href="/app" className="mt-5 w-full">Começar grátis</VButton>
        </div>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto grid max-w-7xl items-center gap-12 px-6 pb-10 pt-10 lg:grid-cols-[1fr_1.25fr]">
      <div>
        <VBadge>A CASA ANDANDO. VOCÊ PRESENTE.</VBadge>

        <h1 className="mt-7 max-w-xl font-serif text-5xl font-semibold leading-[0.95] tracking-[-0.04em] md:text-7xl" style={{ color: V.ink }}>
          Tire a rotina<br />da sua cabeça.
        </h1>
        <p className="mt-4 font-serif text-3xl leading-tight tracking-[-0.03em] md:text-5xl" style={{ color: V.sage }}>
          A casa em movimento.
        </p>
        <p className="mt-7 max-w-xl text-lg leading-8" style={{ color: "#4D5A50" }}>
          A Vesta captura o que precisa ser feito, transforma em ações aprovadas, escreve no lugar certo, delega para as pessoas certas e ajuda a resolver quando você quiser.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-5">
          <VButton href="/app">Começar grátis</VButton>
          <a href="#como-funciona" className="inline-flex items-center gap-3 text-sm font-semibold" style={{ color: V.ink }}>
            <span className="flex h-11 w-11 items-center justify-center rounded-full" style={{ border: `1px solid rgba(14,59,46,0.3)` }}>
              <Play className="h-4 w-4" style={{ fill: V.primary, color: V.primary }} />
            </span>
            Ver como funciona
          </a>
        </div>

        <div className="mt-10 flex items-center gap-5">
          <div className="flex -space-x-3">
            {["#CDAA7D", "#6F856F", "#D8B9A0", "#2E473B"].map((c) => (
              <div key={c} className="h-11 w-11 rounded-full border-2" style={{ backgroundColor: c, borderColor: V.ivory }} />
            ))}
          </div>
          <div>
            <div className="flex gap-1 text-lg" style={{ color: V.gold }}>{"★★★★★"}</div>
            <p className="text-sm" style={{ color: V.muted }}>Mais de 2.000 famílias já usam a Vesta</p>
          </div>
        </div>
      </div>

      {/* Product visualization */}
      <div className="relative min-h-[660px]">
        <div className="absolute left-2 top-12 hidden w-44 lg:block">
          <IntakeCard icon={<MessageCircle className="h-5 w-5 text-green-600" />} title="Grupo da escola">
            Festa junina dia 24/05. Quem pode ajudar com as barracas? 🎉
          </IntakeCard>
        </div>
        <div className="absolute left-10 top-64 hidden w-48 lg:block">
          <IntakeCard icon={<Mail className="h-5 w-5 text-blue-500" />} title="E-mail da escola">
            Autorização para passeio pedagógico em anexo.
          </IntakeCard>
        </div>
        <div className="absolute bottom-24 left-0 hidden w-44 lg:block">
          <IntakeCard icon={<Camera className="h-5 w-5" style={{ color: "#B58445" }} />} title="Foto do bilhete">
            Trazer 1kg de alimento não perecível até 20/06.
          </IntakeCard>
        </div>

        {/* Arrow connectors */}
        <div className="absolute left-[280px] top-[185px] hidden h-px w-20 rotate-12 bg-[#0E3B2E]/40 lg:block" />
        <div className="absolute left-[300px] top-[365px] hidden h-px w-20 rotate-[28deg] bg-[#0E3B2E]/40 lg:block" />

        <div className="relative z-10 mx-auto pt-4 lg:ml-[230px]">
          <PhoneMockup />
        </div>

        {/* Lifestyle card — only at 2xl+ where there is enough column width */}
        <div className="absolute right-0 top-8 hidden h-[560px] w-[240px] overflow-hidden rounded-[34px] shadow-[0_24px_70px_rgba(24,38,30,0.14)] 2xl:block"
          style={{ background: V.beige }}>
          <div className="h-full w-full" style={{ background: "radial-gradient(circle at 50% 20%, #d8c4a6, transparent 35%), linear-gradient(160deg, #efe3cf, #c9ad87)" }} />
          <div className="absolute bottom-0 left-0 right-0 rounded-t-[28px] p-6 text-white" style={{ background: V.primary }}>
            <p className="font-serif text-2xl leading-tight">Menos cobrança. <br />Mais combinados.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Integrations() {
  const items = [
    { label: "Google Calendar", icon: <CalendarDays className="h-5 w-5 text-blue-500" /> },
    { label: "Outlook",         icon: <Mail className="h-5 w-5 text-blue-600" /> },
    { label: "Apple Calendar",  icon: <CalendarDays className="h-5 w-5 text-red-500" /> },
    { label: "WhatsApp",        icon: <MessageCircle className="h-5 w-5 text-green-600" /> },
    { label: "iCloud",          icon: <Cloud className="h-5 w-5 text-sky-400" /> },
    { label: "e mais",          icon: <Plus className="h-4 w-4" style={{ color: V.primary }} /> },
  ];
  return (
    <section className="mx-auto max-w-7xl px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-6 rounded-3xl px-8 py-6 shadow-sm"
        style={{ background: "rgba(255,253,246,0.7)", border: `1px solid rgba(14,59,46,0.10)` }}>
        <p className="max-w-[180px] text-sm font-bold" style={{ color: V.ink }}>
          Funciona com o que sua família já usa
        </p>
        <div className="flex flex-1 flex-wrap items-center justify-between gap-5">
          {items.map((i) => (
            <div key={i.label} className="flex items-center gap-2.5 text-sm" style={{ color: V.ink }}>
              {i.icon}
              <span>{i.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  const items = [
    { icon: <Inbox className="h-10 w-10" />,      title: "Capture de qualquer jeito", text: "Fale, digite, envie um print, foto ou encaminhe uma mensagem. A Vesta entende." },
    { icon: <ListChecks className="h-10 w-10" />, title: "Organiza e prioriza",        text: "A Vesta transforma o caos em planos claros, com prazos e prioridades." },
    { icon: <Users className="h-10 w-10" />,      title: "Delega sem estresse",        text: "Tarefas vão para as pessoas certas, com contexto e sem cobranças." },
    { icon: <CalendarDays className="h-10 w-10" />, title: "Escreve no lugar certo",   text: "Compromissos e lembretes no calendário certo, sempre atualizados." },
    { icon: <Car className="h-10 w-10" />,        title: "Resolve por você",           text: "Precisa de ajuda? A Vesta encontra, agenda e acompanha." },
    { icon: <ShieldCheck className="h-10 w-10" />, title: "Privacidade é inegociável", text: "Seus dados são seus. Seguros, privados e nunca compartilhados." },
  ];
  return (
    <section id="recursos" className="mx-auto max-w-7xl px-6 py-20">
      <span id="para-familias" className="sr-only" />
      <h2 className="mx-auto mb-14 max-w-3xl text-center font-serif text-4xl font-semibold tracking-[-0.03em] md:text-5xl" style={{ color: V.ink }}>
        Tudo o que sua família precisa. Em um só lugar.
      </h2>
      <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((f) => (
          <div key={f.title} className="text-center">
            <div className="mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-[2rem]"
              style={{ background: "#EAF1E5", color: V.primary }}>
              {f.icon}
            </div>
            <h3 className="mb-3 text-base font-bold" style={{ color: V.ink }}>{f.title}</h3>
            <p className="text-sm leading-7" style={{ color: "#4D5A50" }}>{f.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { title: "Você envia para a Vesta",     text: "Pode ser por WhatsApp, e-mail, foto, voz ou texto.",          icon: <Send className="h-10 w-10" /> },
    { title: "A Vesta entende e organiza",  text: "Ela identifica o que precisa ser feito e o contexto.",         icon: <Wand2 className="h-10 w-10" /> },
    { title: "Você aprova e delega",        text: "Confirme, ajuste e escolha quem vai fazer o quê.",             icon: <Check className="h-10 w-10" /> },
    { title: "A Vesta coloca em ação",      text: "No calendário, nas listas e na vida real — com lembretes.",    icon: <CalendarDays className="h-10 w-10" /> },
  ];
  return (
    <section id="como-funciona" className="mx-auto max-w-7xl px-6 pb-6">
      <div className="rounded-[2rem] px-8 py-12" style={{ background: V.warm }}>
        <h2 className="mb-12 text-center font-serif text-4xl font-semibold" style={{ color: V.ink }}>Como funciona</h2>
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-4">
          {steps.map((s, i) => (
            <div key={s.title}>
              <div className="mb-5 flex h-24 items-center justify-center rounded-3xl shadow-sm"
                style={{ background: V.cream, color: V.primary }}>
                {s.icon}
              </div>
              <div className="mb-4 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ background: V.primary }}>
                {i + 1}
              </div>
              <h3 className="mb-2 text-base font-bold" style={{ color: V.ink }}>{s.title}</h3>
              <p className="text-sm leading-7" style={{ color: "#4D5A50" }}>{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const plans = [
    {
      name: "Grátis",
      price: "R$0",
      period: "/mês",
      description: "Para experimentar sem compromisso.",
      cta: "Começar grátis",
      ctaVariant: "ghost" as const,
      features: [
        "1 pessoa",
        "Até 30 capturas por mês",
        "Agenda básica",
        "App mobile",
      ],
      highlight: false,
    },
    {
      name: "Família",
      price: "R$47",
      period: "/mês",
      description: "Para a casa toda funcionar em sincronia.",
      cta: "Começar agora",
      ctaVariant: "primary" as const,
      features: [
        "Até 6 pessoas",
        "Capturas ilimitadas",
        "Delegação e aprovações",
        "Integração com calendários",
        "WhatsApp, e-mail e foto",
        "Lembretes automáticos",
      ],
      highlight: true,
    },
    {
      name: "Casa+",
      price: "R$79",
      period: "/mês",
      description: "Para quem gerencia mais de uma casa.",
      cta: "Falar com a equipe",
      ctaVariant: "ghost" as const,
      features: [
        "Residências ilimitadas",
        "Tudo do plano Família",
        "Concierge ativo",
        "Suporte prioritário",
        "Relatórios mensais",
      ],
      highlight: false,
    },
  ];

  return (
    <section id="precos" className="mx-auto max-w-7xl px-6 py-20">
      <h2 className="mx-auto mb-4 max-w-2xl text-center font-serif text-4xl font-semibold tracking-[-0.03em] md:text-5xl" style={{ color: V.ink }}>
        Simples assim.
      </h2>
      <p className="mb-14 text-center text-lg" style={{ color: V.muted }}>
        Comece grátis. Upgrade quando fizer sentido.
      </p>
      <div className="grid gap-6 md:grid-cols-3">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className="flex flex-col rounded-[2rem] p-8"
            style={{
              background: plan.highlight ? V.primary : V.cream,
              border: plan.highlight ? "none" : `1px solid rgba(14,59,46,0.10)`,
              boxShadow: plan.highlight ? "0 24px 60px rgba(14,59,46,0.22)" : "0 2px 12px rgba(14,59,46,0.06)",
            }}
          >
            {plan.highlight && (
              <div className="mb-4">
                <span className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: "rgba(255,255,255,0.18)", color: "white" }}>
                  MAIS POPULAR
                </span>
              </div>
            )}
            <p className="text-sm font-semibold" style={{ color: plan.highlight ? "rgba(255,255,255,0.7)" : V.muted }}>{plan.name}</p>
            <div className="mt-2 flex items-end gap-1">
              <span className="font-serif text-5xl font-semibold" style={{ color: plan.highlight ? "white" : V.ink }}>{plan.price}</span>
              <span className="mb-1 text-sm" style={{ color: plan.highlight ? "rgba(255,255,255,0.6)" : V.muted }}>{plan.period}</span>
            </div>
            <p className="mt-3 text-sm leading-6" style={{ color: plan.highlight ? "rgba(255,255,255,0.75)" : V.muted }}>
              {plan.description}
            </p>
            <ul className="my-8 flex-1 space-y-3">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm" style={{ color: plan.highlight ? "rgba(255,255,255,0.9)" : V.ink }}>
                  <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: plan.highlight ? "rgba(255,255,255,0.8)" : V.sage }} />
                  {f}
                </li>
              ))}
            </ul>
            <VButton href="/app" variant={plan.highlight ? "light" : "ghost"}>
              {plan.cta}
            </VButton>
          </div>
        ))}
      </div>
      <p className="mt-10 text-center text-sm" style={{ color: V.muted }}>
        Sem contrato. Cancele quando quiser. Dados sempre seus.
      </p>
    </section>
  );
}

function BottomCTA() {
  return (
    <section id="sobre-nos" className="mx-auto max-w-7xl px-6 py-8">
      <div className="grid overflow-hidden rounded-[2rem] shadow-sm md:grid-cols-[1fr_1.35fr]" style={{ background: V.cream }}>
        <div className="p-10" style={{ borderRight: `1px solid rgba(14,59,46,0.10)` }}>
          <p className="font-serif text-6xl leading-none" style={{ color: V.sage }}>"</p>
          <blockquote className="max-w-md text-xl leading-8" style={{ color: V.ink }}>
            A Vesta virou o coração da nossa casa. Nada fica esquecido, e a rotina finalmente não depende só de mim.
          </blockquote>
          <p className="mt-6 text-sm" style={{ color: V.muted }}>Juliana, mãe do Theo e da Bia</p>
        </div>
        <div className="relative flex min-h-[270px] items-center overflow-hidden p-10">
          <div className="relative z-10 max-w-md">
            <h2 className="font-serif text-4xl font-semibold leading-tight tracking-[-0.03em]" style={{ color: V.ink }}>
              Pronto para sentir sua casa mais leve?
            </h2>
            <p className="mt-3" style={{ color: V.muted }}>Comece grátis. Sem compromisso.</p>
            <VButton href="/app" className="mt-7">Começar agora</VButton>
          </div>
          <div className="absolute right-10 top-10 hidden rotate-6 rounded-xl p-5 text-sm leading-6 shadow-md md:block"
            style={{ background: V.beige, color: V.ink }}>
            Planos existem.<br />O que faz a casa<br />andar são os<br />combinados. ♡
          </div>
          <div className="absolute bottom-0 right-0 h-56 w-56 rounded-full" style={{ background: V.softSage }} />
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t py-10" style={{ borderColor: `rgba(14,59,46,0.10)` }}>
      <div className="mx-auto max-w-7xl px-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ border: `1px solid rgba(14,59,46,0.2)` }}>
            <Home className="h-5 w-5" style={{ color: V.primary }} strokeWidth={1.8} />
          </div>
          <span className="text-lg font-semibold" style={{ color: V.ink }}>vesta</span>
        </div>
        <p className="text-xs" style={{ color: V.muted }}>© 2026 Vesta. Feito com carinho para famílias brasileiras.</p>
        <div className="flex gap-5">
          {["Privacidade", "Termos"].map((l) => (
            <a key={l} href="#" className="text-xs hover:underline" style={{ color: V.muted }}>{l}</a>
          ))}
        </div>
      </div>
    </footer>
  );
}

export default function Landing() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="min-h-screen font-sans" style={{ background: V.ivory, color: V.ink }}>
      <Nav mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
      <Hero />
      <Integrations />
      <Features />
      <HowItWorks />
      <Pricing />
      <BottomCTA />
      <Footer />
    </div>
  );
}
