import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight, Calendar, Camera, Check, ChevronDown,
  Home, Lock, Mail, Menu, MessageCircle, Mic, MoreHorizontal,
  Play, Plus, Send, ShieldCheck, Sparkles, Wrench, X,
} from "lucide-react";

/* ── Design tokens ── */
const V = {
  primary:  "#0E3B2E",
  deep:     "#08251E",
  sage:     "#6F856F",
  ivory:    "#F7F4EA",
  cream:    "#FFFDF6",
  warm:     "#F1EBDD",
  softSage: "#DDE8D8",
  gold:     "#D9B95F",
  ink:      "#12231C",
  muted:    "#5F6B61",
};

/* ── Badge ── */
function VBadge({ children, white }: { children: React.ReactNode; white?: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-full px-4 py-1.5 text-[11px] font-semibold tracking-[0.16em] ${white ? "" : "bg-[#EAF1E5] text-[#0E3B2E]"}`}
      style={white ? { background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.85)" } : {}}>
      {children}
    </span>
  );
}

/* ── Intake cards ── */
function IntakeCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl p-5 backdrop-blur"
      style={{ background: "rgba(255,253,246,0.95)", border: "1px solid rgba(14,59,46,0.1)", boxShadow: "0 20px 50px rgba(24,38,30,0.08)" }}>
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <p className="text-sm font-bold" style={{ color: V.ink }}>{title}</p>
      </div>
      <div className="text-sm leading-relaxed" style={{ color: "#3D4A40" }}>{children}</div>
    </div>
  );
}

/* ── WhatsApp mockup ── */
function WhatsAppMockup() {
  const bars = [3, 6, 9, 5, 11, 7, 4, 9, 6, 3, 8, 5, 10, 7, 4, 9, 6, 3, 8, 5, 7];
  return (
    <div className="relative mx-auto h-[590px] w-[302px] rounded-[46px] border-[8px] border-[#111] shadow-[0_30px_80px_rgba(0,0,0,0.28)]">
      {/* Notch */}
      <div className="absolute left-1/2 top-2 z-20 h-7 w-28 -translate-x-1/2 rounded-full bg-black" />

      {/* WhatsApp badge */}
      <a className="absolute -top-3 -right-3 z-30 hidden h-9 -rotate-12 items-center gap-1 rounded-full bg-[#25D366] pl-2 pr-3 text-[11px] font-bold text-white shadow-lg transition hover:-rotate-6 hover:scale-[1.06] hover:bg-[#1FBE5C] lg:inline-flex cursor-pointer">
        <MessageCircle className="h-3.5 w-3.5" fill="white" strokeWidth={0} />
        WhatsApp
      </a>

      <div className="flex h-full flex-col overflow-hidden rounded-[36px] bg-[#ECE5DD]">
        {/* WA header */}
        <div className="flex items-center gap-3 bg-[#075E54] px-4 pb-3 pt-12 text-white">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-[#075E54]" style={{ border: "1.5px solid rgba(255,255,255,0.3)" }}>
            <Home className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold">Vesta</p>
            <p className="text-[11px] text-white/60">online · responde em segundos</p>
          </div>
          <MoreHorizontal className="lucide lucide-ellipsis h-4 w-4 text-white/80" />
        </div>

        {/* Chat */}
        <div className="flex flex-1 flex-col justify-end gap-3 px-4 pb-4 pt-4">
          <div className="mb-2 flex justify-center">
            <span className="rounded-full px-3 py-0.5 text-[11px]" style={{ background: "rgba(255,255,255,0.65)", color: "#666" }}>hoje</span>
          </div>

          {/* Incoming voice */}
          <div className="flex max-w-[88%] items-center gap-2 rounded-2xl rounded-tl-none px-3 py-2.5" style={{ background: "white" }}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: V.primary }}>
              <Play className="h-3 w-3 fill-[#0E3B2E] text-[#0E3B2E]" fill="white" color="white" />
            </div>
            <div className="flex-1">
              <div className="flex items-end gap-[2px] h-7">
                {bars.map((h, i) => (
                  <div key={i} className="w-[2.5px] rounded-full"
                    style={{ height: `${h * 2.3}px`, background: i < 9 ? V.primary : "#C8C8C8" }} />
                ))}
              </div>
            </div>
            <span className="text-[10px] shrink-0" style={{ color: "#999" }}>0:14</span>
          </div>

          {/* Outgoing text — from user */}
          <div className="self-end flex flex-col items-end">
            <div className="rounded-2xl rounded-tr-none px-3 py-2 max-w-[88%]" style={{ background: "#D9FDD3" }}>
              <p className="text-xs leading-relaxed" style={{ color: V.ink }}>
                "Marca a consulta da Bia com a pediatra essa semana, de tarde..."
              </p>
              <div className="flex items-center justify-end gap-0.5 mt-0.5">
                <span className="text-[10px]" style={{ color: "#999" }}>09:14</span>
                <Check className="h-3 w-3" style={{ color: "#53BDEB" }} strokeWidth={2.5} />
                <Check className="h-3 w-3 -ml-1.5" style={{ color: "#53BDEB" }} strokeWidth={2.5} />
              </div>
            </div>
          </div>
        </div>

        {/* Input bar */}
        <div className="flex items-center gap-2 bg-[#F0F0F0] px-2 py-2">
          <div className="flex flex-1 items-center gap-2 rounded-full bg-white px-3 py-1.5">
            <Plus className="h-3.5 w-3.5 text-[#6F856F]" />
            <span className="flex-1 text-[11px] text-[#9AA59C]">Mensagem</span>
            <Camera className="h-3.5 w-3.5 text-[#6F856F]" />
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: V.primary }}>
            <Mic className="h-4 w-4 text-white" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Nav ── */
function Nav({ mobileOpen, setMobileOpen }: { mobileOpen: boolean; setMobileOpen: (v: boolean) => void }) {
  const links: [string, string][] = [
    ["Como funciona", "#como-funciona"],
    ["Concierge",     "#concierge"],
    ["Planos",        "#planos"],
    ["Lista de espera","#lista-de-espera"],
  ];
  return (
    <header className="sticky top-0 z-50"
      style={{ background: "rgba(247,244,234,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(14,59,46,0.08)" }}>
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[#0E3B2E]/20">
            <Home className="lucide lucide-house h-6 w-6 text-[#0E3B2E]" strokeWidth={1.8} />
          </div>
          <span className="text-2xl font-semibold tracking-tight" style={{ color: V.ink }}>vesta</span>
        </div>

        <nav className="hidden items-center gap-9 text-sm font-medium text-[#12231C] md:flex">
          {links.map(([label, href]) => (
            <a key={label} href={href} className="hover:text-[#0E3B2E] transition-colors">{label}</a>
          ))}
        </nav>

        <div className="hidden items-center gap-4 md:flex">
          <Link href="/app" className="text-sm font-semibold hover:opacity-60 transition-opacity" style={{ color: V.ink }}>Entrar</Link>
          <Link href="/app"
            className="inline-flex items-center gap-2 rounded-full bg-[#0E3B2E] px-7 py-3.5 text-[15px] font-semibold text-white shadow-[0_18px_40px_rgba(14,59,46,0.18)] transition hover:bg-[#08251E]">
            Entrar na lista
          </Link>
        </div>

        <button className="md:hidden" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen
            ? <X className="h-6 w-6" style={{ color: V.primary }} />
            : <Menu className="lucide lucide-menu h-6 w-6 text-[#0E3B2E]" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t px-6 pb-6 md:hidden" style={{ borderColor: "rgba(14,59,46,0.08)" }}>
          <div className="space-y-4 pt-4">
            {links.map(([l, h]) => (
              <a key={l} href={h} className="block text-sm font-medium" style={{ color: V.ink }} onClick={() => setMobileOpen(false)}>{l}</a>
            ))}
          </div>
          <Link href="/app"
            className="mt-5 flex w-full items-center justify-center rounded-full bg-[#0E3B2E] py-3 text-sm font-semibold text-white">
            Entrar na lista
          </Link>
        </div>
      )}
    </header>
  );
}

/* ── Hero ── */
function Hero() {
  return (
    <section className="mx-auto grid max-w-7xl items-center gap-12 px-6 pb-10 pt-10 lg:grid-cols-[1fr_1.25fr]">
      {/* Left */}
      <div>
        <VBadge>PARA QUEM SEGURA A CASA</VBadge>

        <h1 className="mt-7 max-w-xl font-serif text-5xl font-semibold leading-[1.0] tracking-[-0.04em] text-[#12231C] md:text-6xl lg:text-[64px]">
          A casa não<br />
          precisa morar{" "}
          <span className="font-serif italic text-[#6F856F]">só<br />
          na sua</span> cabeça.
        </h1>

        <p className="mt-5 max-w-xl font-serif text-3xl leading-tight tracking-[-0.03em] text-[#6F856F] md:text-4xl">
          Começa com suas regras. Aprende com o tempo.
        </p>

        <p className="mt-7 max-w-xl text-lg leading-8 text-[#4D5A50]">
          A Vesta é um sistema operacional discreto da casa. Ela organiza o que chega no WhatsApp, e-mail, foto ou voz pra você confirmar — e delega pra quem precisa, sem cobrança, sem app de tarefas pra família.
        </p>

        <div className="mt-4 inline-flex max-w-xl items-center gap-2 rounded-full border border-[#0E3B2E]/15 bg-[#FFFDF6] px-4 py-2 text-[12.5px] font-semibold text-[#3D4A40]">
          Não é <strong>&nbsp;mais um app de tarefas, calendário ou checklist</strong>&nbsp;da família.
        </div>

        <div className="mt-9 flex max-w-xl flex-wrap items-center gap-4">
          <Link href="/app"
            className="inline-flex items-center gap-2 rounded-full bg-[#0E3B2E] px-7 py-3.5 text-[15px] font-semibold text-white shadow-[0_18px_40px_rgba(14,59,46,0.18)] transition hover:bg-[#08251E]">
            Tire uma coisa da cabeça <ArrowRight className="h-4 w-4" />
          </Link>
          <a href="#como-funciona"
            className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-[#12231C] hover:text-[#0E3B2E]">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[#0E3B2E]/30">
              <Play className="h-3 w-3 fill-[#0E3B2E] text-[#0E3B2E]" />
            </span>
            Ver como funciona
          </a>
        </div>

        <div className="mt-4 flex max-w-xl flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-[#5F6B61]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#D9B95F]" />
            <strong className="font-semibold text-[#12231C]">Restam 47 vagas</strong>&nbsp;na fase 2
          </span>
          <span>·</span>
          <span>Trava preço por 12 meses</span>
        </div>

        <div className="mt-5 flex items-center gap-2 text-[13px] text-[#5F6B61]">
          <ShieldCheck className="lucide lucide-shield-check h-4 w-4 text-[#6F856F]" />
          Confirmação sempre com você. Seus dados nunca são vendidos.
        </div>

        <div className="mt-10 flex items-center gap-5">
          <div className="flex -space-x-3">
            {["#8FAB8E", "#6F856F", "#B8A090", "#4A7060"].map((bg, i) => (
              <div key={i} className="h-11 w-11 rounded-full border-2 border-[#F7F4EA]" style={{ background: bg }} />
            ))}
          </div>
          <div className="text-[12.5px] text-[#5F6B61]">
            <strong className="font-semibold text-[#12231C]">50+ famílias</strong>&nbsp;Famílias selecionadas já estão testando a Vesta.
          </div>
        </div>

        <div className="mt-6">
          <a href="#lista-de-espera"
            className="mt-6 inline-flex items-center gap-2.5 rounded-full border border-[#0E3B2E]/15 bg-[#FFFDF6]/80 px-3.5 py-2 text-[12.5px] text-[#3D4A40] transition hover:border-[#0E3B2E]/30">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#6F856F]/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#6F856F]" />
            </span>
            <strong>1000+ famílias</strong>&nbsp;já na lista · próxima onda em junho
            <ArrowRight className="lucide lucide-arrow-right h-3.5 w-3.5 text-[#6F856F]" />
          </a>
        </div>
      </div>

      {/* Right — floating cards + phone */}
      <div className="relative min-h-[660px]">
        <div className="absolute left-2 top-12 hidden w-44 lg:block">
          <IntakeCard icon={<MessageCircle className="lucide lucide-message-circle h-5 w-5 text-green-600" />} title="Grupo da escola">
            Festa junina dia 24/05. Quem pode ajudar com as barracas? 🎉
          </IntakeCard>
        </div>
        <div className="absolute left-10 top-64 hidden w-48 lg:block">
          <IntakeCard icon={<Mail className="lucide lucide-mail h-5 w-5 text-blue-500" />} title="E-mail da escola">
            Autorização para passeio pedagógico em anexo.
          </IntakeCard>
        </div>
        <div className="absolute bottom-24 left-0 hidden w-44 lg:block">
          <IntakeCard icon={<Camera className="lucide lucide-camera h-5 w-5 text-[#B58445]" />} title="Foto do bilhete">
            Trazer 1kg de alimento não perecível até 20/06.
          </IntakeCard>
        </div>

        <div className="absolute left-[280px] top-[185px] hidden h-px w-20 rotate-12 bg-[#0E3B2E]/40 lg:block" />
        <div className="absolute left-[300px] top-[365px] hidden h-px w-20 rotate-[28deg] bg-[#0E3B2E]/40 lg:block" />

        <div className="relative z-10 mx-auto pt-4 lg:ml-[230px]">
          <WhatsAppMockup />
        </div>

        <div className="absolute bottom-32 right-4 hidden rounded-2xl px-4 py-3 text-sm font-medium text-white shadow-md lg:block"
          style={{ background: V.primary }}>
          Menos cobrança.<br />Mais combinados.
        </div>
      </div>
    </section>
  );
}

/* ── Integrations ── */
function Integrations() {
  const items = [
    { label: "Google Calendar", desc: "Vesta cria, edita e cancela eventos no seu Google.",          icon: <Calendar className="h-5 w-5 text-blue-500" /> },
    { label: "Apple Calendar",  desc: "Sincroniza ao calendário compartilhado do iCloud.",            icon: <Calendar className="h-5 w-5 text-red-500" /> },
    { label: "Outlook",         desc: "Compromissos do trabalho convivem com os da casa.",            icon: <Mail className="h-5 w-5 text-blue-600" /> },
    { label: "WhatsApp",        desc: "Encaminhe mensagens; a Vesta entende e organiza.",             icon: <MessageCircle className="h-5 w-5 text-[#25D366]" /> },
    { label: "E-mail",          desc: "Encaminha pra um endereço; vira combinado direto.",            icon: <Mail className="h-5 w-5 text-[#6F856F]" /> },
    { label: "iCloud",          desc: "Fotos de bilhetes e listas viram tarefa automática.",          icon: <Send className="h-5 w-5 text-sky-400" /> },
  ];
  return (
    <section className="mx-auto max-w-7xl px-6 py-8">
      <div className="rounded-3xl px-8 py-10" style={{ background: "rgba(255,253,246,0.7)", border: "1px solid rgba(14,59,46,0.10)", boxShadow: "0 2px 12px rgba(14,59,46,0.06)" }}>
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-serif text-2xl font-semibold tracking-tight text-[#12231C]">
              Conversa com o que sua família já usa
              <span className="font-serif italic text-[#6F856F]">.</span>
            </p>
            <p className="mt-1 text-sm text-[#5F6B61]">Sincronização nos dois sentidos. Sem novo app pra ninguém.</p>
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((i) => (
            <div key={i.label} className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0">{i.icon}</div>
              <div>
                <p className="text-sm font-bold" style={{ color: V.ink }}>{i.label}</p>
                <p className="text-xs leading-5" style={{ color: V.muted }}>{i.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Como funciona ── */
function HowItWorks() {
  const steps = [
    { num: "01", icon: <Send className="h-8 w-8" />,      title: "Você manda do jeito que dá",      text: "WhatsApp, e-mail, foto, áudio ou texto. Sem formulário, sem categoria." },
    { num: "02", icon: <Sparkles className="h-8 w-8" />,   title: "A Vesta entende e organiza",      text: "Identifica o que é, prazo, categoria e quem deveria fazer." },
    { num: "03", icon: <Check className="h-8 w-8" />,      title: "Você aprova ou ajusta",           text: "Em um toque: confirma, edita ou delega para alguém da casa." },
    { num: "04", icon: <Calendar className="h-8 w-8" />,   title: "Vai pra vida real",               text: "Calendário, lista, lembrete — e a Vesta acompanha até resolver." },
  ];

  const rules = [
    "Quem pode aprovar o quê (você, parceiro, ninguém).",
    "O que vai pro calendário automaticamente — e o que sempre passa por você.",
    "Quais categorias a Vesta pode delegar sem perguntar.",
    "Quem recebe quais lembretes e em qual canal.",
    "Quando a Vesta pode falar com prestadores em seu nome.",
  ];

  return (
    <section id="como-funciona" className="scroll-mt-24 mx-auto max-w-7xl px-6 pb-6 pt-10">
      <div className="rounded-[2rem] px-8 py-14" style={{ background: "#F1EBDD" }}>
        <VBadge>COMO FUNCIONA</VBadge>
        <h2 className="mb-3 mt-4 max-w-xl font-serif text-3xl font-semibold tracking-[-0.03em] text-[#12231C] md:text-4xl">
          Quatro passos. Nenhum esforço a mais.
        </h2>
        <p className="mb-12 max-w-lg text-base leading-7 text-[#5F6B61]">
          Você não precisa mudar como sua família se comunica. A Vesta entra no meio do caos que já existe.
        </p>

        <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-4">
          {steps.map((s) => (
            <div key={s.num}>
              <div className="mb-5 flex h-24 items-center justify-center rounded-3xl shadow-sm"
                style={{ background: "#FFFDF6", color: V.primary }}>
                {s.icon}
              </div>
              <p className="mb-1 text-xs font-bold tracking-widest" style={{ color: V.sage }}>{s.num}</p>
              <h3 className="mb-2 text-base font-bold" style={{ color: V.ink }}>{s.title}</h3>
              <p className="text-sm leading-7" style={{ color: "#4D5A50" }}>{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Regras da Casa ── */
function Rules() {
  const rules = [
    "Quem pode aprovar o quê (você, parceiro, ninguém).",
    "O que vai pro calendário automaticamente — e o que sempre passa por você.",
    "Quais categorias a Vesta pode delegar sem perguntar.",
    "Quem recebe quais lembretes e em qual canal.",
    "Quando a Vesta pode falar com prestadores em seu nome.",
  ];
  return (
    <section className="mx-auto max-w-7xl px-6 py-16">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center">
        <div>
          <VBadge>REGRAS DA CASA</VBadge>
          <h2 className="mt-5 mb-4 font-serif text-3xl font-semibold tracking-[-0.03em] text-[#12231C] md:text-4xl">
            Você decide as regras.{" "}
            <span className="font-serif italic text-[#6F856F]">A Vesta segue.</span>
          </h2>
          <p className="mb-8 max-w-sm text-base leading-8 text-[#5F6B61]">
            Nada acontece sem combinar. Você define o limite de autonomia da Vesta e ajusta quando quiser — sem mexer em código, sem chamar suporte.
          </p>
          <a href="#lista-de-espera"
            className="inline-flex items-center gap-2 rounded-full border border-[#0E3B2E]/20 px-5 py-2.5 text-sm font-semibold transition hover:bg-[#EAF1E5]"
            style={{ color: V.primary }}>
            Ver exemplos de regras <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="rounded-2xl p-8" style={{ background: "#FFFDF6", border: "1px solid rgba(14,59,46,0.08)" }}>
          <p className="mb-5 text-xs font-bold tracking-widest text-[#6F856F]">VOCÊ ESCOLHE</p>
          <ul className="space-y-4">
            {rules.map((r) => (
              <li key={r} className="flex items-start gap-3 text-sm leading-6" style={{ color: V.ink }}>
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ background: "#DDE8D8" }}>
                  <Check className="h-3 w-3" style={{ color: V.primary }} />
                </div>
                {r}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ── Como a Vesta evolui ── */
function VestaEvolution() {
  const phases = [
    {
      tag: "DIA 1",
      title: "Você define as regras",
      text: "Quem confirma o quê, quais canais a Vesta escuta, o que vai direto pro calendário. A Vesta começa fazendo só o que você combinou.",
    },
    {
      tag: "SEMANAS 2 A 4",
      title: "Ela aprende o jeito da casa",
      text: "Com o tempo, entende seus horários, quem cuida de quê, quais mensagens viram tarefa e quais só ficam registradas. Sem você precisar configurar.",
    },
    {
      tag: "MÊS 2 EM DIANTE",
      title: "Sugere antes de você pedir",
      text: 'Antecipa padrões: "vou agendar a próxima vacina?", "reabasteço a feira de sexta?". Você só confirma — ou ajusta a regra pra próxima.',
    },
  ];

  return (
    <section className="scroll-mt-24 mx-auto max-w-7xl px-6 py-12">
      <div className="grid gap-12 rounded-[2rem] p-10 md:p-16 lg:grid-cols-[1.15fr_1fr]"
        style={{ background: "#FFFDF6", border: "1px solid rgba(14,59,46,0.08)" }}>
        <div>
          <VBadge>COMO A VESTA EVOLUI COM SUA CASA</VBadge>
          <h2 className="mt-5 mb-4 font-serif text-3xl font-semibold tracking-[-0.03em] text-[#12231C] md:text-4xl">
            Começa com suas regras.{" "}
            <span className="font-serif italic text-[#6F856F]">Aprende com o tempo.</span>
          </h2>
          <p className="max-w-sm text-base leading-8 text-[#5F6B61]">
            A Vesta não chega tomando decisões. Ela entra discreta, segue o que você combinou e vai ganhando contexto na medida em que você confia.
          </p>
        </div>
        <div className="grid gap-2.5">
          {phases.map((p, i) => (
            <div key={p.tag} className="rounded-2xl p-6"
              style={{ background: i === 0 ? "#EAF1E5" : i === 1 ? "#F1EBDD" : "#F7F4EA", border: "1px solid rgba(14,59,46,0.06)" }}>
              <p className="mb-2 text-[10px] font-bold tracking-widest" style={{ color: V.sage }}>{p.tag}</p>
              <h3 className="mb-1.5 font-serif text-base font-semibold" style={{ color: V.ink }}>{p.title}</h3>
              <p className="text-sm leading-6" style={{ color: "#4D5A50" }}>{p.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Privacy ── */
function Privacy() {
  const items = [
    {
      icon: <Lock className="h-5 w-5" style={{ color: V.primary }} />,
      title: "Criptografia ponta-a-ponta no que importa",
      text: "Mensagens, fotos e contexto da família são criptografados em trânsito e em repouso.",
    },
    {
      icon: <ShieldCheck className="h-5 w-5" style={{ color: V.primary }} />,
      title: "Não treinamos modelo com seus dados",
      text: "Sua casa não vira dataset. Nada do que entra na Vesta sai pra alimentar IA externa.",
    },
    {
      icon: <Check className="h-5 w-5" style={{ color: V.primary }} />,
      title: "Hospedagem no Brasil, em conformidade com a LGPD",
      text: "Servidores na região Brasil e DPO designado. Você exporta ou apaga tudo a qualquer momento.",
    },
    {
      icon: <Sparkles className="h-5 w-5" style={{ color: V.primary }} />,
      title: "Você decide canal por canal",
      text: "Conecta o que quiser, desconecta quando quiser. A Vesta nunca lê o que você não autorizou.",
    },
  ];

  return (
    <section className="scroll-mt-24 mx-auto max-w-7xl px-6 py-16">
      <div className="grid items-center gap-10 rounded-[2rem] px-10 py-14 md:p-16 lg:grid-cols-[1fr_1.4fr]"
        style={{ background: V.primary }}>
        <div>
          <VBadge white>PRIVACIDADE DA CASA</VBadge>
          <h2 className="mt-5 mb-5 font-serif text-3xl font-semibold leading-tight tracking-[-0.03em] text-white md:text-4xl">
            O que é da sua casa fica na sua casa.
          </h2>
          <p className="mb-8 max-w-sm text-base leading-8" style={{ color: "rgba(255,255,255,0.68)" }}>
            A Vesta foi pensada por gente que também é mãe, pai e parceiro. A gente entende que rotina de família é íntimo — e tratamos assim, do código à operação.
          </p>
          <a href="#"
            className="inline-flex items-center gap-2 text-sm font-semibold"
            style={{ color: "rgba(255,255,255,0.70)" }}>
            Ler a política completa <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item.title} className="rounded-2xl p-5" style={{ background: "rgba(255,255,255,0.08)" }}>
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "rgba(255,255,255,0.15)" }}>
                {item.icon}
              </div>
              <h3 className="mb-2 text-sm font-bold text-white">{item.title}</h3>
              <p className="text-xs leading-6" style={{ color: "rgba(255,255,255,0.60)" }}>{item.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Concierge ── */
function Concierge() {
  const requests = [
    "Encontrar eletricista pra terça",
    "Comprar presente da Lia até sábado",
    "Agendar manutenção da casa",
    "Cotar dedetização do quintal",
    "Reservar atividade infantil",
    "Comparar 3 orçamentos de pintura",
  ];
  return (
    <section id="concierge" className="scroll-mt-24 mx-auto max-w-7xl px-6 py-12">
      <div className="relative overflow-hidden rounded-[2rem] px-10 py-14" style={{ background: "#F1EBDD" }}>
        <div className="relative z-10 grid gap-12 lg:grid-cols-[1fr_1.1fr] items-start">
          <div>
            <VBadge>CONCIERGE · ADD-ON PREMIUM</VBadge>
            <h2 className="mt-5 mb-5 font-serif text-3xl font-semibold leading-tight tracking-[-0.03em] text-[#12231C] md:text-4xl">
              O que você prefere não fazer
              <span className="font-serif italic text-[#6F856F]">, a Vesta resolve.</span>
            </h2>
            <p className="mb-6 max-w-md text-base leading-8 text-[#5F6B61]">
              Ajuda externa quando fizer sentido — não pra terceirizar sua vida. Você descreve em uma frase, a gente cota, agenda e acompanha. Você confirma antes de qualquer execução.
            </p>
            <div className="mb-8 inline-flex flex-col gap-1 rounded-2xl px-6 py-4" style={{ background: "rgba(14,59,46,0.07)" }}>
              <p className="text-xs font-bold tracking-widest text-[#6F856F]">PREÇO</p>
              <p className="text-2xl font-bold text-[#12231C]">R$ 49<span className="text-lg font-normal">/mês</span></p>
              <p className="text-xs text-[#5F6B61]">+ taxa por pedido resolvido</p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Link href="/app"
                className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white transition"
                style={{ background: V.primary }}>
                Pedir ao Concierge <ArrowRight className="h-4 w-4" />
              </Link>
              <p className="text-xs text-[#5F6B61]">Pessoa real revisa · seg–sáb</p>
            </div>
          </div>

          <div>
            <p className="mb-4 text-[10px] font-bold tracking-widest text-[#6F856F]">PEDIDOS COMUNS</p>
            <div className="grid grid-cols-2 gap-3">
              {requests.map((r) => (
                <div key={r} className="flex items-start gap-2.5 rounded-xl px-4 py-3"
                  style={{ background: "rgba(14,59,46,0.06)" }}>
                  <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6F856F]" />
                  <p className="text-sm leading-snug text-[#12231C]">{r}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Pricing ── */
function Pricing() {
  const plans = [
    {
      label: "Grátis pra sempre",
      price: "R$ 0",
      priceNote: null,
      desc: "2 adultos + 1 criança · 3 categorias · 30 dias de histórico · 3 regras.",
      cta: "Começar grátis",
      href: "/app",
      highlight: false,
      badge: null,
    },
    {
      label: "Premium",
      price: "R$ 29,90",
      priceNote: "/mês ou R$ 279/ano",
      desc: "Família ilimitada, papelzinho, diarista LGPD, Pix automático e digest semanal.",
      cta: "Entrar na lista",
      href: "/app",
      highlight: true,
      badge: "MAIS ESCOLHIDO",
    },
    {
      label: "Concierge (add-on Premium)",
      price: "R$ 49",
      priceNote: "/mês + taxa",
      desc: "Pessoa real cota, agenda e compra — você confirma antes. Indicar profissional segue grátis.",
      cta: "Quero saber mais",
      href: "#concierge",
      highlight: false,
      badge: null,
    },
  ];

  return (
    <section id="planos" className="scroll-mt-24 mx-auto max-w-7xl px-6 py-12">
      <VBadge>PLANOS</VBadge>
      <h2 className="mt-4 mb-2 font-serif text-3xl font-semibold tracking-[-0.03em] text-[#12231C] md:text-4xl">
        Preço justo,{" "}
        <span className="font-serif italic text-[#6F856F]">no seu tempo.</span>
      </h2>
      <p className="mb-14 text-sm text-[#5F6B61]">
        Cancela quando quiser. Fundadora trava preço por 12 meses.
      </p>

      <div className="grid gap-5 md:grid-cols-3">
        {plans.map((plan) => (
          <div key={plan.label} className="flex flex-col rounded-[2rem] p-8"
            style={{
              background: plan.highlight ? V.primary : "#FFFDF6",
              border: plan.highlight ? "none" : "1px solid rgba(14,59,46,0.10)",
              boxShadow: plan.highlight ? "0 24px 60px rgba(14,59,46,0.22)" : "0 2px 12px rgba(14,59,46,0.06)",
            }}>
            {plan.badge && (
              <div className="mb-4">
                <span className="rounded-full px-3 py-1 text-[10px] font-bold tracking-widest"
                  style={{ background: "rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.9)" }}>
                  {plan.badge}
                </span>
              </div>
            )}
            <p className="text-base font-bold" style={{ color: plan.highlight ? "rgba(255,255,255,0.9)" : V.ink }}>{plan.label}</p>
            <p className="mt-6 font-serif text-4xl font-semibold" style={{ color: plan.highlight ? "white" : V.ink }}>{plan.price}</p>
            {plan.priceNote && (
              <p className="mt-1 text-xs" style={{ color: plan.highlight ? "rgba(255,255,255,0.55)" : V.muted }}>{plan.priceNote}</p>
            )}
            <p className="mt-4 mb-8 flex-1 text-sm leading-6" style={{ color: plan.highlight ? "rgba(255,255,255,0.70)" : V.muted }}>
              {plan.desc}
            </p>
            <Link href={plan.href}
              className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
              style={plan.highlight
                ? { background: "#FFFDF6", color: V.primary }
                : { background: "transparent", color: V.primary, border: "1px solid rgba(14,59,46,0.20)" }}>
              {plan.cta}
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Testimonials ── */
function Testimonials() {
  const quotes = [
    {
      text: "Antes eu era a planilha, o calendário e o lembrete da casa. Hoje a Vesta segura isso e a gente conversa sobre o que importa.",
      name: "Juliana, 38",
      sub: "Mãe do Theo e da Bia · São Paulo",
      initial: "J",
      avatarBg: V.sage,
    },
    {
      text: "Moro sozinha mas a casa também tem rotina: faxina, mercado, conta de luz. A Vesta resolve sem virar mais um app pra abrir.",
      name: "Renata, 31",
      sub: "Solo · Rio de Janeiro",
      initial: "R",
      avatarBg: "#8FAB8E",
    },
    {
      text: "A gente parou de cobrar um ao outro. O combinado chega pra quem tem que fazer, com prazo e contexto. Mudou o clima de casa.",
      name: "Marcos & Leo",
      sub: "Casal · Belo Horizonte",
      initial: "M",
      avatarBg: V.gold,
    },
  ];

  return (
    <section className="mx-auto max-w-7xl px-6 py-12">
      <div className="mb-4">
        <VBadge>QUEM SEGURA A CASA</VBadge>
      </div>
      <h2 className="mb-2 font-serif text-3xl font-semibold tracking-[-0.03em] text-[#12231C] md:text-4xl">
        Quem já está vivendo a Vesta.
      </h2>
      <p className="mb-12 text-sm text-[#5F6B61]">
        Histórias reais de famílias do piloto. Nomes preservados quando pedido.
      </p>
      <div className="grid gap-5 md:grid-cols-3">
        {quotes.map((q) => (
          <div key={q.name} className="flex flex-col rounded-[2rem] p-8"
            style={{ background: "#FFFDF6", border: "1px solid rgba(14,59,46,0.09)" }}>
            <p className="mb-5 font-serif text-4xl leading-none text-[#6F856F]">"</p>
            <blockquote className="flex-1 font-serif text-lg font-semibold leading-snug tracking-[-0.02em] text-[#12231C]">
              {q.text}
            </blockquote>
            <div className="mt-8 flex items-center gap-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                style={{ background: q.avatarBg, color: q.avatarBg === V.gold ? V.deep : "white" }}>
                {q.initial}
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: V.ink }}>{q.name}</p>
                <p className="text-xs" style={{ color: V.muted }}>{q.sub}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Waitlist CTA ── */
function WaitlistCTA() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [size, setSize] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const sizeOpts = ["Moro sozinho(a)", "Eu + parceiro(a)", "Família com filhos", "Multigeracional"];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (email) setDone(true);
  }

  return (
    <section id="lista-de-espera" className="scroll-mt-24 mx-auto max-w-7xl px-6 py-16">
      <div className="grid overflow-hidden rounded-[2rem] bg-[#FFFDF6] shadow-sm md:grid-cols-[1fr_1.35fr]"
        style={{ border: "1px solid rgba(14,59,46,0.09)" }}>
        {/* Left */}
        <div className="p-10 md:p-12" style={{ borderRight: "1px solid rgba(14,59,46,0.09)" }}>
          <VBadge>VAGAS LIMITADAS · ONDA DE JULHO</VBadge>
          <h2 className="mt-5 mb-4 font-serif text-3xl font-semibold tracking-[-0.03em] text-[#12231C]">
            Entra na lista. A gente chama na sua vez.
          </h2>
          <p className="mb-8 max-w-sm text-base leading-8 text-[#5F6B61]">
            Estamos abrindo a Vesta em ondas pequenas pra cuidar de cada família com calma. Quem entra agora ganha condições de fundadora e ajuda a moldar o produto.
          </p>
          <div className="mb-8 space-y-3">
            {[
              { text: "Acesso antes do lançamento público",       active: true },
              { text: "Preço de fundadora trancado por 12 meses", active: true },
              { text: "Conversa direta com o time da Vesta",      active: false },
            ].map(({ text, active }, i) => (
              <div key={text} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                  style={{
                    background: i === 0 ? V.primary : i === 1 ? V.sage : "rgba(14,59,46,0.18)",
                    color: active ? "white" : V.muted,
                  }}>
                  {i + 1}
                </span>
                <p className="text-sm leading-6" style={{ color: active ? V.ink : V.muted }}>{text}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-[#5F6B61]">
            Quando entrar, seu primeiro passo é criar a primeira regra da casa. Leva 2 minutos.
          </p>
          <div className="mt-5">
            <a href="#"
              className="inline-flex items-center gap-2.5 rounded-full border border-[#0E3B2E]/15 bg-[#FFFDF6]/80 px-3.5 py-2 text-[12.5px] text-[#3D4A40] transition hover:border-[#0E3B2E]/30">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#6F856F]/60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#6F856F]" />
              </span>
              <strong>1000+ famílias</strong>&nbsp;já na lista · próxima onda em junho
            </a>
          </div>
        </div>

        {/* Right — form */}
        <div className="flex flex-col justify-center p-10 md:p-12">
          <div className="mx-auto w-full max-w-sm rounded-3xl p-8 shadow-md" style={{ background: "white" }}>
            {done ? (
              <div className="py-4 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
                  style={{ background: "#DDE8D8" }}>
                  <Check className="h-6 w-6" style={{ color: V.primary }} />
                </div>
                <h3 className="mb-2 font-serif text-xl font-bold" style={{ color: V.ink }}>Você entrou na lista!</h3>
                <p className="text-sm leading-6 text-[#5F6B61]">
                  A gente entra em contato assim que sua vaga abrir. Fique de olho no e-mail.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <div className="mb-4">
                  <label className="mb-1.5 block text-xs font-semibold text-[#12231C]">Seu nome</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="Como quer ser chamada?" required
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none transition-all"
                    style={{ borderColor: "rgba(14,59,46,0.20)", background: "#F7F4EA", color: V.ink }} />
                </div>
                <div className="mb-4">
                  <label className="mb-1.5 block text-xs font-semibold text-[#12231C]">E-mail</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="voce@familia.com" required
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none transition-all"
                    style={{ borderColor: "rgba(14,59,46,0.20)", background: "#F7F4EA", color: V.ink }} />
                </div>
                <div className="mb-6">
                  <p className="mb-2 text-xs font-semibold text-[#12231C]">Quantas pessoas moram com você?</p>
                  <div className="grid grid-cols-2 gap-2">
                    {sizeOpts.map((o) => (
                      <button key={o} type="button" onClick={() => setSize(o)}
                        className="rounded-xl px-3 py-2 text-xs font-medium text-left transition-all"
                        style={{
                          background: size === o ? V.primary : "#F7F4EA",
                          color: size === o ? "white" : V.ink,
                          border: size === o ? "none" : "1px solid rgba(14,59,46,0.15)",
                        }}>
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
                <button type="submit"
                  className="flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold text-white transition hover:bg-[#08251E]"
                  style={{ background: V.primary }}>
                  Quero entrar na lista <ArrowRight className="h-4 w-4" />
                </button>
                <p className="mt-4 text-center text-xs text-[#5F6B61]">
                  Sem spam. Você só recebe quando a sua vez chegar.
                </p>
                <p className="mt-2 text-center text-xs text-[#5F6B61]">
                  Ao continuar, você concorda com a nossa{" "}
                  <a href="#" className="underline">política de privacidade</a>.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── FAQ ── */
function FAQ() {
  const [open, setOpen] = useState<number | null>(null);
  const items = [
    {
      q: "É só mais um app de agenda?",
      a: "Não. A agenda mostra o que já foi decidido. A Vesta entra antes — no recado do WhatsApp, na pendência da casa, na tarefa que alguém precisa pegar e no lembrete que não pode passar batido.",
    },
    {
      q: "Quem da família precisa instalar?",
      a: "Só quem vai aprovar. Os outros participam pelo WhatsApp ou recebem os lembretes normalmente — sem instalar nada.",
    },
    {
      q: "A Vesta lê tudo do meu WhatsApp?",
      a: "Não. A Vesta só lê o que você encaminha pra ela ou o que acontece em grupos onde você a adicionou. Ela não tem acesso às suas conversas pessoais.",
    },
    {
      q: "O Concierge é humano ou IA?",
      a: "Os pedidos são triados por IA, mas revisados por uma pessoa real antes de qualquer execução. Você sempre sabe quem está cuidando.",
    },
    {
      q: "Em que horário e cidades o Concierge atende?",
      a: "Segunda a sábado, durante o horário comercial. Atualmente nas principais capitais e regiões metropolitanas do Brasil.",
    },
    {
      q: "Meus dados são usados pra treinar IA?",
      a: "Não. Sua casa não vira dataset. Nada do que entra na Vesta sai pra alimentar modelos externos.",
    },
    {
      q: "Quanto vai custar?",
      a: "O plano grátis é para sempre em R$0. O Premium custa R$29,90/mês ou R$279/ano. O Concierge é um add-on por R$49/mês + taxa por pedido resolvido. Quem entra agora como fundadora trava o preço por 12 meses.",
    },
    {
      q: "Quando vou conseguir entrar?",
      a: "Estamos abrindo em ondas pequenas. Entre na lista de espera e a gente te avisa quando sua vez chegar — normalmente em algumas semanas.",
    },
  ];

  return (
    <section className="mx-auto max-w-4xl px-6 py-16">
      <VBadge>PERGUNTAS FREQUENTES</VBadge>
      <h2 className="mb-12 mt-4 font-serif text-3xl font-semibold tracking-[-0.03em] text-[#12231C] md:text-4xl">
        O que toda família pergunta primeiro.
      </h2>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={item.q} className="overflow-hidden rounded-2xl" style={{ border: "1px solid rgba(14,59,46,0.10)" }}>
            <button onClick={() => setOpen(open === i ? null : i)}
              className="flex w-full items-center justify-between px-6 py-5 text-left text-sm font-semibold transition-colors"
              style={{ background: open === i ? "#FFFDF6" : "white", color: V.ink }}>
              {item.q}
              <ChevronDown className="h-4 w-4 shrink-0 transition-transform text-[#6F856F]"
                style={{ transform: open === i ? "rotate(180deg)" : "rotate(0deg)" }} />
            </button>
            {open === i && (
              <div className="px-6 pb-5 text-sm leading-7 text-[#5F6B61]"
                style={{ background: "#FFFDF6" }}>
                {item.a}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Final CTA ── */
function FinalCTA() {
  return (
    <section className="mx-auto max-w-7xl px-6 pb-20">
      <div className="flex flex-col items-center rounded-[2rem] py-16 text-center"
        style={{ background: V.primary }}>
        <p className="mb-3 font-serif text-sm tracking-widest" style={{ color: "rgba(255,255,255,0.45)" }}>
          — Manifesto Vesta
        </p>
        <h2 className="mb-3 font-serif text-3xl font-semibold tracking-[-0.03em] text-white md:text-4xl">
          A casa aprende. Você respira.
        </h2>
        <p className="mb-2 text-base" style={{ color: "rgba(255,255,255,0.65)" }}>
          Pronta pra sentir sua casa mais leve?
        </p>
        <p className="mb-8 text-sm" style={{ color: "rgba(255,255,255,0.50)" }}>
          Entra na lista. A gente chama na sua vez — e você começa pelo plano grátis.
        </p>
        <Link href="/app"
          className="inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-sm font-semibold transition hover:scale-105"
          style={{ background: "#FFFDF6", color: V.primary, boxShadow: "0 12px 30px rgba(0,0,0,0.20)" }}>
          Entrar na lista <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

/* ── Footer ── */
function Footer() {
  return (
    <footer className="border-t py-12" style={{ borderColor: "rgba(14,59,46,0.10)", background: "#F7F4EA" }}>
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid gap-10 md:grid-cols-[1.8fr_1fr_1fr_1fr]">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[#0E3B2E]/20">
                <Home className="lucide lucide-house h-6 w-6 text-[#0E3B2E]" strokeWidth={1.8} />
              </div>
              <span className="text-2xl font-semibold tracking-tight" style={{ color: V.ink }}>vesta</span>
            </div>
            <p className="max-w-xs text-sm leading-7 text-[#5F6B61]">
              O sistema operacional discreto da casa. Captura, organiza e delega — pra família andar sem cobrança.
            </p>
            <p className="mt-4 text-xs" style={{ color: "#aaa" }}>São Paulo · Brasil</p>
          </div>

          <div>
            <p className="mb-4 text-xs font-bold tracking-widest text-[#12231C]">PRODUTO</p>
            <ul className="space-y-2.5">
              {[["Como funciona","#como-funciona"],["Concierge","#concierge"],["Planos","#planos"],["Lista de espera","#lista-de-espera"]].map(([l,h]) => (
                <li key={l}><a href={h} className="text-sm hover:opacity-70 transition-opacity text-[#5F6B61]">{l}</a></li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-4 text-xs font-bold tracking-widest text-[#12231C]">CASA</p>
            <ul className="space-y-2.5">
              {["Privacidade","Termos de uso"].map((l) => (
                <li key={l}><a href="#" className="text-sm hover:opacity-70 transition-opacity text-[#5F6B61]">{l}</a></li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-4 text-xs font-bold tracking-widest text-[#12231C]">FALE COM A GENTE</p>
            <p className="mb-2 text-xs font-semibold text-[#5F6B61]">Contato</p>
            <ul className="space-y-1.5">
              {["contato@vesta.casa","privacidade@vesta.casa"].map((e) => (
                <li key={e}><a href={`mailto:${e}`} className="text-sm hover:opacity-70 transition-opacity text-[#5F6B61]">{e}</a></li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t pt-8"
          style={{ borderColor: "rgba(14,59,46,0.08)" }}>
          <p className="text-xs" style={{ color: "#aaa" }}>
            © 2026 Vesta Tecnologia Ltda. Todos os direitos reservados. Feito com cuidado para famílias brasileiras.
          </p>
        </div>
      </div>
    </footer>
  );
}

/* ── Root ── */
export default function Landing() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="min-h-screen font-sans" style={{ background: "#F7F4EA", color: V.ink }}>
      <Nav mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
      <Hero />
      <Integrations />
      <HowItWorks />
      <Rules />
      <Concierge />
      <VestaEvolution />
      <Privacy />
      <Pricing />
      <Testimonials />
      <WaitlistCTA />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  );
}
