import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight, CalendarDays, Camera, Car, Check, ChevronDown,
  ChevronRight, Cloud, Home, Inbox, ListChecks, Mail, Menu,
  MessageCircle, MoreHorizontal, Play, Plus, Search, Send,
  ShieldCheck, Sparkles, Users, WalletCards, Wand2, X,
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
  const cls = `${base} ${className}`;
  const style = {
    background: variant === "primary" ? V.primary : variant === "light" ? V.cream : "transparent",
    color: variant === "primary" ? "white" : V.ink,
    border: variant !== "primary" ? `1px solid rgba(14,59,46,0.12)` : "none",
    boxShadow: variant === "primary" ? "0 12px 30px rgba(14,59,46,0.18)" : "none",
  };
  if (href) return <Link href={href} className={cls} style={style}>{children}</Link>;
  return <button onClick={onClick} className={cls} style={style}>{children}</button>;
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
            (tab as { center?: boolean }).center ? (
              <button key={i} className="mx-auto flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg"
                style={{ background: V.primary }}>
                <Plus className="h-6 w-6" />
              </button>
            ) : (
              <div key={i} className="flex flex-col items-center gap-1 text-[9px]"
                style={{ color: (tab as { active?: boolean }).active ? V.primary : V.sage }}>
                {tab.icon}
                <span>{(tab as { label?: string }).label}</span>
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
            {[["Recursos","#recursos"],["Para famílias","#para-familias"],["Preços","#precos"],["Sobre nós","#sobre-nos"]].map(([l, h]) => (
              <a key={l} href={h} className="block text-sm font-medium" style={{ color: V.ink }} onClick={() => setMobileOpen(false)}>{l}</a>
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
          Tire a rotina<br />da <em className="not-italic" style={{ color: V.sage }}>sua</em> cabeça.
        </h1>
        <p className="mt-4 font-serif text-3xl leading-tight tracking-[-0.03em] md:text-4xl" style={{ color: V.sage }}>
          A casa em movimento.
        </p>
        <p className="mt-7 max-w-lg text-lg leading-8" style={{ color: "#4D5A50" }}>
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

        <p className="mt-10 text-sm" style={{ color: V.muted }}>
          Famílias selecionadas já estão testando a Vesta.
        </p>
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

        <div className="absolute left-[280px] top-[185px] hidden h-px w-20 rotate-12 bg-[#0E3B2E]/40 lg:block" />
        <div className="absolute left-[300px] top-[365px] hidden h-px w-20 rotate-[28deg] bg-[#0E3B2E]/40 lg:block" />

        <div className="relative z-10 mx-auto pt-4 lg:ml-[230px]">
          <PhoneMockup />
        </div>

        {/* Small lifestyle pill — replaces the large card that was causing overlap */}
        <div className="absolute bottom-32 right-4 hidden rounded-2xl px-4 py-3 text-sm font-medium shadow-md lg:block"
          style={{ background: V.primary, color: "white" }}>
          Menos cobrança.<br />Mais combinados.
        </div>
      </div>
    </section>
  );
}

function Integrations() {
  const items = [
    { label: "Google Agenda", icon: <CalendarDays className="h-5 w-5 text-blue-500" /> },
    { label: "Outlook",       icon: <Mail className="h-5 w-5 text-blue-600" /> },
    { label: "Apple Calendar",icon: <CalendarDays className="h-5 w-5 text-red-500" /> },
    { label: "WhatsApp",      icon: <MessageCircle className="h-5 w-5 text-green-600" /> },
    { label: "iCloud",        icon: <Cloud className="h-5 w-5 text-sky-400" /> },
    { label: "E-mail",        icon: <Mail className="h-5 w-5" style={{ color: V.sage }} /> },
    { label: "e mais",        icon: <Plus className="h-4 w-4" style={{ color: V.primary }} /> },
  ];
  return (
    <section className="mx-auto max-w-7xl px-6 py-4">
      <div className="flex flex-wrap items-center gap-6 rounded-3xl px-8 py-6 shadow-sm"
        style={{ background: "rgba(255,253,246,0.7)", border: `1px solid rgba(14,59,46,0.10)` }}>
        <p className="w-full max-w-[200px] text-sm font-bold sm:w-auto" style={{ color: V.ink }}>
          Pensado para funcionar com o que sua família já usa
        </p>
        <div className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-3">
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
    { icon: <Inbox className="h-10 w-10" />,        title: "Captura de qualquer jeito",  text: "Fale, digita, manda print, foto ou encaminha mensagem. A Vesta entende." },
    { icon: <ListChecks className="h-10 w-10" />,   title: "Organiza e prioriza",         text: "A Vesta transforma o caos em planos claros, com prazos e prioridades." },
    { icon: <Users className="h-10 w-10" />,        title: "Delega sem cobrança",         text: "As tarefas vão pras pessoas certas, com contexto — sem você ter que ficar lembrando." },
    { icon: <CalendarDays className="h-10 w-10" />, title: "Escreve no lugar certo",      text: "Compromissos e lembretes na agenda certa, sempre atualizados." },
    { icon: <Car className="h-10 w-10" />,          title: "Ajuda a resolver",            text: "Precisa de uma mão? A Vesta encontra, organiza e acompanha — com seu sim." },
    { icon: <ShieldCheck className="h-10 w-10" />,  title: "Privacidade desde o começo",  text: "Pensado pra proteger os dados da sua família. Seus, sempre." },
  ];
  return (
    <section id="recursos" className="mx-auto max-w-7xl px-6 py-20">
      <span id="para-familias" className="sr-only" />
      <div className="mb-4">
        <VBadge>TUDO NUM LUGAR SÓ</VBadge>
      </div>
      <h2 className="mx-auto mb-14 max-w-3xl font-serif text-4xl font-semibold tracking-[-0.03em] md:text-5xl" style={{ color: V.ink }}>
        Tudo o que sua família precisa. <em className="not-italic" style={{ color: V.sage }}>Em um só lugar.</em>
      </h2>
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((f) => (
          <div key={f.title} className="rounded-3xl p-6" style={{ background: V.cream, border: `1px solid rgba(14,59,46,0.08)` }}>
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{ background: "#EAF1E5", color: V.primary }}>
              {f.icon && <div className="scale-75">{f.icon}</div>}
            </div>
            <h3 className="mb-2 text-base font-bold" style={{ color: V.ink }}>{f.title}</h3>
            <p className="text-sm leading-7" style={{ color: "#4D5A50" }}>{f.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function PracticeDemo() {
  const steps = [
    {
      step: "1. CHEGA NO WHATSAPP",
      title: "Grupo da escola",
      content: "\"Lembrete: Dia da Foto é terça, 14/10. Roupa branca. Crianças com camiseta branca.\"",
      icon: <MessageCircle className="h-5 w-5 text-green-600" />,
      bg: V.cream,
    },
    {
      step: "2. A VESTA ENTENDE",
      title: "Identifica e organiza",
      content: "Evento: 14/10 — roupa branca responsável: Helena. Lembrete no domingo.",
      icon: <Wand2 className="h-5 w-5" style={{ color: V.primary }} />,
      bg: V.cream,
    },
    {
      step: "3. VOCÊ APROVA",
      title: "Um toque pra confirmar",
      content: "Confirma com 1 toque ou ajusta. Da próxima vez parecida, já vai sozinho.",
      icon: <Check className="h-5 w-5" style={{ color: V.primary }} />,
      bg: V.cream,
    },
    {
      step: "4. VAI PRA VIDA REAL",
      title: "Na agenda da família",
      content: "Entra no Google/Apple/Outlook, vira lembrete e avisa quem precisa ser avisado.",
      icon: <CalendarDays className="h-5 w-5" style={{ color: V.primary }} />,
      bg: V.cream,
    },
  ];
  return (
    <section className="mx-auto max-w-7xl px-6 pb-20">
      <div className="mb-4">
        <VBadge>VEJA NA PRÁTICA</VBadge>
      </div>
      <h2 className="mb-12 max-w-2xl font-serif text-3xl font-semibold tracking-[-0.03em] md:text-4xl" style={{ color: V.ink }}>
        Do grupo da escola{" "}
        <em className="not-italic" style={{ color: V.sage }}>pra agenda da família,</em>{" "}
        em segundos.
      </h2>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <div key={s.step} className="relative flex flex-col rounded-3xl p-6"
            style={{ background: s.bg, border: `1px solid rgba(14,59,46,0.09)` }}>
            {i < steps.length - 1 && (
              <ChevronRight className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 text-[#0E3B2E]/30 lg:block" />
            )}
            <p className="mb-4 text-[10px] font-bold tracking-widest" style={{ color: V.sage }}>{s.step}</p>
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "#EAF1E5" }}>
              {s.icon}
            </div>
            <p className="mb-2 text-sm font-bold" style={{ color: V.ink }}>{s.title}</p>
            <p className="text-sm leading-relaxed" style={{ color: V.muted }}>{s.content}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { title: "Você envia para a Vesta",    text: "Pode ser por WhatsApp, e-mail, foto, voz ou texto.",         icon: <Send className="h-10 w-10" />,        num: "01" },
    { title: "A Vesta entende e organiza", text: "Ela identifica o que precisa ser feito e o contexto.",        icon: <Wand2 className="h-10 w-10" />,       num: "02" },
    { title: "Você aprova e delega",       text: "Confirme, ajuste e escolha quem vai fazer o quê.",            icon: <Check className="h-10 w-10" />,       num: "03" },
    { title: "A Vesta coloca em ação",     text: "No calendário, nas listas e na vida real — com lembretes.",   icon: <CalendarDays className="h-10 w-10" />, num: "04" },
  ];
  return (
    <section id="como-funciona" className="mx-auto max-w-7xl px-6 pb-6">
      <div className="rounded-[2rem] px-8 py-14" style={{ background: V.warm }}>
        <div className="mb-4">
          <VBadge>COMO FUNCIONA</VBadge>
        </div>
        <h2 className="mb-12 max-w-xl font-serif text-3xl font-semibold tracking-[-0.03em] md:text-4xl" style={{ color: V.ink }}>
          Do recado bagunçado ao próximo passo claro.
        </h2>
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-4">
          {steps.map((s) => (
            <div key={s.title}>
              <div className="mb-5 flex h-24 items-center justify-center rounded-3xl shadow-sm"
                style={{ background: V.cream, color: V.primary }}>
                {s.icon}
              </div>
              <p className="mb-1 text-xs font-bold tracking-widest" style={{ color: V.sage }}>{s.num}</p>
              <h3 className="mb-2 text-base font-bold" style={{ color: V.ink }}>{s.title}</h3>
              <p className="text-sm leading-7" style={{ color: "#4D5A50" }}>{s.text}</p>
            </div>
          ))}
        </div>
        <p className="mt-10 max-w-lg text-sm leading-7" style={{ color: V.muted }}>
          No começo a Vesta confirma com você. Com o tempo, ela aprende seus combinados e só te chama quando algo foge da rotina.
        </p>
      </div>
    </section>
  );
}

function YouInControl() {
  const rules = [
    "Sempre pedir aprovação antes de compartilhar algo fora de casa",
    "Adicionar lembretes simples automaticamente",
    "Sugerir quem deve cuidar de cada tarefa",
    "Avisar quando tiver conflito na agenda",
    "Te manter no controle sem perguntar tudo toda hora",
  ];
  return (
    <section className="mx-auto max-w-7xl px-6 py-20">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <div className="mb-4">
            <VBadge>VOCÊ NO CONTROLE</VBadge>
          </div>
          <h2 className="mb-6 font-serif text-3xl font-semibold tracking-[-0.03em] md:text-4xl" style={{ color: V.ink }}>
            Você decide as regras.{" "}
            <em className="not-italic" style={{ color: V.sage }}>A Vesta aprende a rotina.</em>
          </h2>
          <p className="max-w-md text-base leading-8" style={{ color: V.muted }}>
            No começo, a Vesta confirma com você o que importa. Com o tempo, aprende os seus combinados: o que vira lembrete sozinho, o que precisa de aprovação e quando alguém da casa deve ser avisado.
          </p>
        </div>
        <div className="rounded-[2rem] p-8" style={{ background: V.cream, border: `1px solid rgba(14,59,46,0.09)` }}>
          <p className="mb-5 text-xs font-bold tracking-widest" style={{ color: V.sage }}>REGRAS DA SUA FAMÍLIA</p>
          <div className="space-y-4">
            {rules.map((r) => (
              <div key={r} className="flex items-start gap-4 rounded-2xl px-4 py-3.5" style={{ background: V.ivory }}>
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ background: V.softSage }}>
                  <Check className="h-3 w-3" style={{ color: V.primary }} />
                </div>
                <p className="text-sm leading-6" style={{ color: V.ink }}>{r}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ConciergeBanner() {
  return (
    <section className="mx-auto max-w-7xl px-6 pb-20">
      <div className="relative overflow-hidden rounded-[2rem] px-10 py-14"
        style={{ background: V.primary }}>
        <div className="relative z-10 max-w-xl">
          <div className="mb-4">
            <span className="rounded-full px-4 py-1.5 text-[11px] font-bold tracking-[0.12em]"
              style={{ background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.85)" }}>
              CONCIERGE
            </span>
          </div>
          <h2 className="mb-5 font-serif text-3xl font-semibold leading-tight tracking-[-0.03em] text-white md:text-4xl">
            Quando precisa sair do combinado e{" "}
            <em className="not-italic opacity-75">virar solução.</em>
          </h2>
          <p className="mb-8 max-w-md text-base leading-8" style={{ color: "rgba(255,255,255,0.72)" }}>
            Além de organizar a rotina, a Vesta pode ajudar a encaminhar tarefas que precisam de apoio externo — conserto, compras, serviços, orçamentos, entregas ou pequenas pendências da casa.
          </p>
          <div className="flex flex-wrap items-center gap-5">
            <Link href="/concierge"
              className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all"
              style={{ background: V.sage, color: "white" }}>
              Conhecer o Concierge <ArrowRight className="h-4 w-4" />
            </Link>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
              Nada é enviado, contratado ou agendado sem a seu sim
            </p>
          </div>
        </div>
        <div className="absolute -right-16 -top-16 h-72 w-72 rounded-full opacity-10" style={{ background: V.sage }} />
        <div className="absolute -bottom-20 right-20 h-56 w-56 rounded-full opacity-8" style={{ background: "white" }} />
      </div>
    </section>
  );
}

function Pricing() {
  const plans = [
    {
      name: "Grátis",
      description: "Pra começar a tirar a rotina da cabeça.",
      cta: "Começar grátis",
      highlight: false,
      badge: null,
      features: [
        "Captura básica de tarefas",
        "Lista da casa",
        "Lembretes simples",
        "1 agenda conectada",
      ],
    },
    {
      name: "Premium",
      description: "Pra família que quer a rotina mais organizada.",
      cta: "Entrar na lista",
      highlight: true,
      badge: "MAIS ESCOLHIDO",
      features: [
        "Regras inteligentes",
        "Várias agendas e lembretes",
        "Delegação pro quem mora junto",
        "Histórico e acompanhamento",
      ],
    },
    {
      name: "Concierge",
      description: "Pro quem quer ajuda pra resolver.",
      cta: "Quero saber mais",
      highlight: false,
      badge: null,
      features: [
        "Apoio em tarefas selecionadas",
        "Orçamentos e serviços",
        "Acompanhamento de pendências",
        "Aprovação antes de qualquer ação externa",
      ],
    },
  ];
  return (
    <section id="precos" className="mx-auto max-w-7xl px-6 py-20">
      <div className="mb-4">
        <VBadge>PLANOS EM DEFINIÇÃO</VBadge>
      </div>
      <h2 className="mb-3 font-serif text-3xl font-semibold tracking-[-0.03em] md:text-4xl" style={{ color: V.ink }}>
        Um plano{" "}
        <em className="not-italic" style={{ color: V.sage }}>pra cada momento</em>{" "}
        da sua casa.
      </h2>
      <p className="mb-14 max-w-xl text-base leading-7" style={{ color: V.muted }}>
        Os valores serão divulgados em breve. As primeiras famílias entram com condições especiais.
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
            {plan.badge && (
              <div className="mb-4">
                <span className="rounded-full px-3 py-1 text-[10px] font-bold tracking-widest"
                  style={{ background: "rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.9)" }}>
                  {plan.badge}
                </span>
              </div>
            )}
            <p className="text-base font-bold" style={{ color: plan.highlight ? "rgba(255,255,255,0.9)" : V.ink }}>{plan.name}</p>
            <p className="mt-1 text-sm leading-6" style={{ color: plan.highlight ? "rgba(255,255,255,0.6)" : V.muted }}>
              {plan.description}
            </p>
            <p className="my-6 font-serif text-4xl font-semibold" style={{ color: plan.highlight ? "rgba(255,255,255,0.6)" : V.muted }}>
              Em breve
            </p>
            <ul className="mb-8 flex-1 space-y-3">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm" style={{ color: plan.highlight ? "rgba(255,255,255,0.85)" : V.ink }}>
                  <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: plan.highlight ? "rgba(255,255,255,0.6)" : V.sage }} />
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
    </section>
  );
}

function Testimonial() {
  return (
    <section className="mx-auto max-w-7xl px-6 pb-10">
      <div className="rounded-[2rem] p-10 md:p-14" style={{ background: V.cream, border: `1px solid rgba(14,59,46,0.09)` }}>
        <p className="mb-6 font-serif text-6xl leading-none" style={{ color: V.sage }}>"</p>
        <blockquote className="max-w-2xl font-serif text-2xl font-semibold leading-snug tracking-[-0.02em] md:text-3xl" style={{ color: V.ink }}>
          A Vesta virou o coração da nossa casa. Nada fica esquecido, e a rotina finalmente não depende só de mim.
        </blockquote>
        <div className="mt-8 flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full font-bold text-white text-sm"
            style={{ background: V.sage }}>J</div>
          <div>
            <p className="text-sm font-semibold" style={{ color: V.ink }}>Juliana</p>
            <p className="text-xs" style={{ color: V.muted }}>mãe do Theo e da Bia</p>
          </div>
          <span className="ml-auto rounded-full px-3 py-1 text-[10px] font-bold tracking-widest"
            style={{ background: "#EAF1E5", color: V.primary }}>COMO UMA FAMÍLIA IMAGINA</span>
        </div>
      </div>
    </section>
  );
}

function WaitlistCTA() {
  const [email, setEmail] = useState("");
  return (
    <section id="sobre-nos" className="mx-auto max-w-7xl px-6 pb-20">
      <div className="grid overflow-hidden rounded-[2rem] md:grid-cols-[1fr_1.1fr]"
        style={{ background: V.ivory, border: `1px solid rgba(14,59,46,0.09)` }}>
        <div className="p-10 md:p-12" style={{ borderRight: `1px solid rgba(14,59,46,0.09)` }}>
          <div className="mb-4">
            <span className="rounded-full px-4 py-1.5 text-[11px] font-bold tracking-widest"
              style={{ background: "#EAF1E5", color: V.primary }}>
              LISTA DE ESPERA — VAGAS LIMITADAS
            </span>
          </div>
          <h2 className="mb-4 font-serif text-3xl font-semibold tracking-[-0.03em]" style={{ color: V.ink }}>
            Garanta sua vaga
          </h2>
          <p className="mb-8 max-w-sm text-base leading-8" style={{ color: V.muted }}>
            Conta um pouco da sua família. A gente chama em pequenos grupos pra cuidar bem de cada uma.
          </p>
          <div className="space-y-3">
            {[
              "Pré-lançamento — ainda não está aberto pra todo mundo",
              "Chamando as primeiras famílias",
              "Atendimento de perto no começo",
            ].map((step, i) => (
              <div key={step} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ background: i === 0 ? V.primary : i === 1 ? V.sage : `rgba(14,59,46,0.2)`, color: i < 2 ? "white" : V.muted }}>
                  {i + 1}
                </span>
                <p className="text-sm leading-6" style={{ color: i < 2 ? V.ink : V.muted }}>{step}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col justify-center p-10 md:p-12">
          <div className="mx-auto w-full max-w-sm rounded-3xl p-8 shadow-md" style={{ background: "white" }}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-widest" style={{ color: V.muted }}>EMAIL</span>
              <span className="text-[10px] font-bold tracking-widest" style={{ color: V.muted }}>SUA FAMÍLIA</span>
            </div>
            <h3 className="mb-1 font-serif text-xl font-semibold" style={{ color: V.ink }}>Começa pelo seu email.</h3>
            <p className="mb-6 text-xs leading-5" style={{ color: V.muted }}>
              Em seguida a gente faz umas perguntas rápidas sobre a sua família.
            </p>
            <label className="mb-1.5 block text-xs font-semibold" style={{ color: V.ink }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@familia.com"
              className="mb-4 w-full rounded-2xl border px-4 py-3 text-sm outline-none transition-all"
              style={{ borderColor: `rgba(14,59,46,0.2)`, background: V.ivory, color: V.ink }}
            />
            <button
              className="flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold text-white transition-all"
              style={{ background: V.primary }}
            >
              Continuar <ArrowRight className="h-4 w-4" />
            </button>
            <p className="mt-4 text-center text-xs" style={{ color: V.muted }}>
              Leva até 30 segundos. Spam, nunca.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  const items = [
    {
      q: "É só mais um app de agenda?",
      a: "Não. Agenda mostra o que já foi decidido. A Vesta entra antes — no recado do WhatsApp, na pendência da casa, na tarefa que alguém precisa pegar e no lembrete que não pode passar batido.",
    },
    {
      q: "Com quais agendas funciona?",
      a: "Google Calendar, Apple Calendar (iCloud), Outlook e Exchange. O que bate com a sua regra entra na agenda certa — da família ou sua.",
    },
    {
      q: "Vocês marcam serviço por mim?",
      a: "Não automaticamente. Pelo Concierge, a Vesta pode ajudar a encontrar, orçar e acompanhar — mas nada é confirmado sem a sua aprovação.",
    },
    {
      q: "Babá, diarista, avós e crianças podem usar?",
      a: "Sim. Cada pessoa acessa só o que é dela. Você decide o que cada um pode ver e fazer.",
    },
    {
      q: "Já tá aberto?",
      a: "Ainda não. Estamos chamando as primeiras famílias em pequenos grupos. Entre na lista de espera e a gente te avisa.",
    },
    {
      q: "E meus dados?",
      a: "São seus. Nunca vendemos, nunca compartilhamos, nunca treinamos modelos com o conteúdo da sua casa. Privacidade desde o começo.",
    },
  ];
  return (
    <section className="mx-auto max-w-3xl px-6 pb-20">
      <div className="mb-4">
        <VBadge>DÚVIDAS</VBadge>
      </div>
      <h2 className="mb-12 font-serif text-3xl font-semibold tracking-[-0.03em] md:text-4xl" style={{ color: V.ink }}>
        Respostas honestas sobre o que é (e o que não é) a Vesta.
      </h2>
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={item.q} className="overflow-hidden rounded-2xl" style={{ border: `1px solid rgba(14,59,46,0.10)` }}>
            <button
              onClick={() => setOpen(open === i ? null : i)}
              className="flex w-full items-center justify-between px-6 py-5 text-left text-sm font-semibold transition-colors"
              style={{ background: open === i ? V.cream : "white", color: V.ink }}
            >
              {item.q}
              <ChevronDown
                className="h-4 w-4 shrink-0 transition-transform"
                style={{ color: V.sage, transform: open === i ? "rotate(180deg)" : "rotate(0deg)" }}
              />
            </button>
            {open === i && (
              <div className="px-6 pb-5 text-sm leading-7" style={{ background: V.cream, color: V.muted }}>
                {item.a}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="mx-auto max-w-7xl px-6 pb-20">
      <div className="flex flex-col items-center rounded-[2rem] py-16 text-center"
        style={{ background: V.cream, border: `1px solid rgba(14,59,46,0.09)` }}>
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ border: `1px solid rgba(14,59,46,0.2)` }}>
          <Home className="h-8 w-8" style={{ color: V.primary }} strokeWidth={1.5} />
        </div>
        <h2 className="mb-3 font-serif text-3xl font-semibold tracking-[-0.03em] md:text-4xl" style={{ color: V.ink }}>
          Pronto pra sentir sua casa mais leve?
        </h2>
        <p className="mb-8 text-base" style={{ color: V.muted }}>Comece grátis. Sem compromisso.</p>
        <VButton href="/app">
          Começar agora <ArrowRight className="h-4 w-4" />
        </VButton>
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
      <PracticeDemo />
      <HowItWorks />
      <YouInControl />
      <ConciergeBanner />
      <Pricing />
      <Testimonial />
      <WaitlistCTA />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  );
}
