import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight, Calendar, Camera, Check, ChevronDown, ChevronRight,
  Home, Mail, Menu, MessageCircle, Mic, MoreHorizontal,
  Play, Plus, Send, ShieldCheck, Sparkles, Star, Wrench, X, Zap,
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
  lime:     "#6B8F5E",
};

/* ── Shared Components ── */
function VButton({
  children, variant = "primary", className = "", href, onClick,
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

function VBadge({ children, light }: { children: React.ReactNode; light?: boolean }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[11px] font-bold tracking-[0.12em]"
      style={{ background: light ? "rgba(255,255,255,0.12)" : "#EAF1E5", color: light ? "rgba(255,255,255,0.85)" : V.primary }}>
      {!light && <span className="h-1.5 w-1.5 rounded-full" style={{ background: V.primary }} />}
      {children}
    </div>
  );
}

function IntakeCard({ icon, title, children }: {
  icon: React.ReactNode; title: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl p-4 shadow-lg backdrop-blur"
      style={{ background: "rgba(255,253,246,0.97)", border: `1px solid rgba(14,59,46,0.10)`, boxShadow: "0 16px 40px rgba(24,38,30,0.10)" }}>
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <p className="text-xs font-bold" style={{ color: V.ink }}>{title}</p>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: "#3D4A40" }}>{children}</p>
    </div>
  );
}

/* ── WhatsApp Phone Mockup ── */
function WhatsAppMockup() {
  const bars = [3, 6, 9, 5, 11, 7, 4, 9, 6, 3, 8, 5, 10, 7, 4, 9, 6, 3, 8, 5, 7];
  return (
    <div className="relative mx-auto h-[560px] w-[288px] rounded-[44px] border-[7px] border-[#111] shadow-[0_30px_80px_rgba(0,0,0,0.30)]">
      {/* Notch */}
      <div className="absolute left-1/2 top-2 h-6 w-24 -translate-x-1/2 rounded-full bg-black z-10" />

      {/* WhatsApp badge */}
      <div className="absolute -top-3 -right-3 z-20 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold text-white shadow-lg"
        style={{ background: "#25D366" }}>
        <MessageCircle className="h-3 w-3" fill="white" /> WhatsApp
      </div>

      <div className="flex h-full flex-col overflow-hidden rounded-[36px]" style={{ background: "#E9DDD0" }}>
        {/* WA Header */}
        <div className="flex items-center gap-3 px-4 pt-10 pb-3" style={{ background: V.primary }}>
          <div className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "#1a5c47" }}>
            <Home className="h-5 w-5 text-white" strokeWidth={1.6} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-white">Vesta</p>
            <p className="text-[10px] text-white/60">online · responde em segundos</p>
          </div>
          <MoreHorizontal className="h-5 w-5 text-white/50" />
        </div>

        {/* Chat */}
        <div className="flex flex-1 flex-col justify-end gap-3 px-4 pb-3">
          <div className="flex justify-center">
            <span className="rounded-full px-3 py-0.5 text-[10px]" style={{ background: "rgba(255,255,255,0.65)", color: "#666" }}>hoje</span>
          </div>

          {/* Incoming voice */}
          <div className="flex items-center gap-2 rounded-2xl rounded-tl-none px-3 py-2.5 max-w-[88%] self-start"
            style={{ background: "white" }}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: V.primary }}>
              <Play className="h-3.5 w-3.5 text-white" fill="white" />
            </div>
            <div className="flex-1">
              <div className="flex items-end gap-px h-7">
                {bars.map((h, i) => (
                  <div key={i} className="w-[2.5px] rounded-full transition-all"
                    style={{ height: `${h * 2.2}px`, background: i < 9 ? V.primary : "#C8C8C8" }} />
                ))}
              </div>
            </div>
            <span className="text-[10px] shrink-0" style={{ color: "#999" }}>0:14</span>
          </div>

          {/* Outgoing text */}
          <div className="self-end max-w-[88%] rounded-2xl rounded-tr-none px-3 py-2"
            style={{ background: "#D9FDD3" }}>
            <p className="text-[11px] leading-relaxed" style={{ color: V.ink }}>
              "Marca a consulta da Bia com a pediatra essa semana, de tarde..."
            </p>
            <div className="flex items-center justify-end gap-1 mt-0.5">
              <span className="text-[10px]" style={{ color: "#999" }}>09:14</span>
              <Check className="h-3 w-3" style={{ color: "#53BDEB" }} strokeWidth={2.5} />
              <Check className="h-3 w-3 -ml-1.5" style={{ color: "#53BDEB" }} strokeWidth={2.5} />
            </div>
          </div>
        </div>

        {/* Input bar */}
        <div className="flex items-center gap-2 px-3 py-2" style={{ background: "#F0F0F0" }}>
          <div className="flex-1 rounded-full px-4 py-2 text-[11px]" style={{ background: "white", color: "#aaa" }}>Mensagem</div>
          <Camera className="h-5 w-5" style={{ color: "#666" }} />
          <div className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: V.primary }}>
            <Mic className="h-4 w-4 text-white" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sections ── */
function Nav({ mobileOpen, setMobileOpen }: { mobileOpen: boolean; setMobileOpen: (v: boolean) => void }) {
  const links = [
    ["Como funciona", "#como-funciona"],
    ["Concierge",     "#concierge"],
    ["Planos",        "#planos"],
    ["Lista de espera","#lista-de-espera"],
  ];
  return (
    <header className="sticky top-0 z-50" style={{ background: "rgba(247,244,234,0.94)", backdropFilter: "blur(12px)", borderBottom: `1px solid rgba(14,59,46,0.08)` }}>
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ border: `1px solid rgba(14,59,46,0.20)` }}>
            <Home className="h-5 w-5" style={{ color: V.primary }} strokeWidth={1.8} />
          </div>
          <span className="text-xl font-semibold tracking-tight" style={{ color: V.ink }}>vesta</span>
        </div>

        <nav className="hidden items-center gap-7 text-sm font-medium md:flex" style={{ color: V.ink }}>
          {links.map(([label, href]) => (
            <a key={label} href={href} className="hover:opacity-60 transition-opacity">{label}</a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link href="/app" className="text-sm font-medium hover:opacity-60 transition-opacity" style={{ color: V.muted }}>Entrar</Link>
          <VButton href="/app">Entrar na lista</VButton>
        </div>

        <button className="md:hidden" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X className="h-6 w-6" style={{ color: V.primary }} /> : <Menu className="h-6 w-6" style={{ color: V.primary }} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t px-6 pb-6 md:hidden" style={{ borderColor: `rgba(14,59,46,0.08)` }}>
          <div className="space-y-4 pt-4">
            {links.map(([l, h]) => (
              <a key={l} href={h} className="block text-sm font-medium" style={{ color: V.ink }} onClick={() => setMobileOpen(false)}>{l}</a>
            ))}
          </div>
          <VButton href="/app" className="mt-6 w-full">Entrar na lista</VButton>
        </div>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto grid max-w-7xl items-center gap-10 px-6 pb-10 pt-10 lg:grid-cols-[1.05fr_1fr]">
      {/* Left — text */}
      <div>
        <VBadge>PARA QUEM SEGURA A CASA</VBadge>

        <h1 className="mt-7 font-serif text-5xl font-bold leading-[0.92] tracking-[-0.03em] md:text-6xl lg:text-7xl" style={{ color: V.ink }}>
          A casa não<br />
          precisa morar{" "}
          <em className="not-italic" style={{ color: V.lime, fontStyle: "italic" }}>só<br />
          na sua</em> cabeça.
        </h1>

        <p className="mt-5 font-serif text-2xl leading-snug tracking-[-0.02em] md:text-3xl" style={{ color: V.sage }}>
          Começa com suas regras.<br />Aprende com o tempo.
        </p>

        <p className="mt-6 max-w-lg text-base leading-8" style={{ color: "#4D5A50" }}>
          A Vesta é um sistema operacional discreto da casa. Ela organiza o que chega no WhatsApp, e-mail, foto ou voz pra você confirmar — e delega pra quem precisa, sem cobrança, sem app de tarefas pra família.
        </p>

        <div className="mt-4 inline-block rounded-full border px-4 py-2 text-sm" style={{ borderColor: `rgba(14,59,46,0.15)`, color: V.muted }}>
          Não é <strong style={{ color: V.ink }}>mais um app de tarefas, calendário ou checklist</strong> da família.
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <VButton href="/app">
            Tire uma coisa da cabeça <ArrowRight className="h-4 w-4" />
          </VButton>
          <a href="#como-funciona" className="inline-flex items-center gap-3 text-sm font-semibold" style={{ color: V.ink }}>
            <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ border: `1.5px solid rgba(14,59,46,0.25)` }}>
              <Play className="h-3.5 w-3.5" style={{ fill: V.primary, color: V.primary }} />
            </span>
            Ver como funciona
          </a>
        </div>

        <div className="mt-6 flex items-center gap-2 text-xs" style={{ color: V.muted }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#4CAF50" }} />
          <strong style={{ color: V.ink }}>Restam 47 vagas</strong>&nbsp;na fase 2
          <span className="mx-1">·</span>
          Trava preço por 12 meses
        </div>

        <div className="mt-3 flex items-center gap-2 text-xs" style={{ color: V.muted }}>
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" style={{ color: V.sage }} />
          Confirmação sempre com você. Seus dados nunca são vendidos.
        </div>

        <div className="mt-7 flex items-center gap-3">
          <div className="flex -space-x-2">
            {["#8FAB8E","#6F856F","#B8A090","#4A7060"].map((bg, i) => (
              <div key={i} className="h-8 w-8 rounded-full border-2 border-white" style={{ background: bg }} />
            ))}
          </div>
          <div>
            <p className="text-xs font-bold" style={{ color: V.ink }}>
              <span className="mr-1" style={{ color: V.sage }}>50+ FAMÍLIAS</span>
              Famílias selecionadas já estão testando a Vesta.
            </p>
          </div>
        </div>

        <div className="mt-4">
          <a href="#lista-de-espera" className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium transition-opacity hover:opacity-75"
            style={{ borderColor: `rgba(14,59,46,0.18)`, color: V.ink }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#4CAF50" }} />
            <strong>1000+ famílias</strong>&nbsp;já na lista · próxima onda em junho
            <ChevronRight className="h-3 w-3" style={{ color: V.sage }} />
          </a>
        </div>
      </div>

      {/* Right — WhatsApp mockup + floating cards */}
      <div className="relative min-h-[600px] hidden lg:block">
        {/* Floating intake cards */}
        <div className="absolute left-0 top-16 w-48 z-10">
          <IntakeCard icon={<MessageCircle className="h-4 w-4 text-[#25D366]" />} title="Grupo da escola">
            Festa junina dia 24/05. Quem pode ajudar com as barracas? 🎉
          </IntakeCard>
        </div>
        <div className="absolute left-4 top-[260px] w-52 z-10">
          <IntakeCard icon={<Mail className="h-4 w-4 text-blue-500" />} title="E-mail da escola">
            Autorização para passeio pedagógico em anexo.
          </IntakeCard>
        </div>
        <div className="absolute left-0 bottom-16 w-48 z-10">
          <IntakeCard icon={<Camera className="h-4 w-4" style={{ color: "#B58445" }} />} title="Foto do bilhete">
            Trazer 1kg de alimento não perecível até 20/06.
          </IntakeCard>
        </div>

        {/* Connector lines */}
        <div className="absolute left-[188px] top-[100px] h-px w-16 rotate-12 opacity-30" style={{ background: V.primary }} />
        <div className="absolute left-[200px] top-[295px] h-px w-14 rotate-[20deg] opacity-30" style={{ background: V.primary }} />

        {/* Phone */}
        <div className="absolute right-0 top-8 z-10">
          <WhatsAppMockup />
        </div>
      </div>

      {/* Mobile-only phone */}
      <div className="lg:hidden flex justify-center">
        <WhatsAppMockup />
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      num: "01",
      icon: <Send className="h-7 w-7" />,
      title: "Você manda do jeito que dá",
      text: "WhatsApp, e-mail, foto, áudio ou texto. Sem formulário, sem categoria.",
    },
    {
      num: "02",
      icon: <Sparkles className="h-7 w-7" />,
      title: "A Vesta entende e organiza",
      text: "Identifica o que é, prazo, categoria e quem deveria fazer.",
    },
    {
      num: "03",
      icon: <Check className="h-7 w-7" />,
      title: "Você aprova ou ajusta",
      text: "Em um toque: confirma, edita ou delega para alguém da casa.",
    },
    {
      num: "04",
      icon: <Calendar className="h-7 w-7" />,
      title: "Vai pra vida real",
      text: "Calendário, lista, lembrete — e a Vesta acompanha até resolver.",
    },
  ];

  const rules = [
    "Quem pode aprovar o quê",
    "O que vai pro calendário automaticamente",
    "Quais categorias a Vesta pode delegar sem perguntar",
    "Quem recebe lembretes",
    "Quando falar com prestadores",
  ];

  return (
    <section id="como-funciona" className="mx-auto max-w-7xl px-6 pb-10">
      <div className="rounded-[2rem] px-8 py-14" style={{ background: V.warm }}>
        <VBadge>COMO FUNCIONA</VBadge>
        <h2 className="mt-4 mb-3 max-w-xl font-serif text-3xl font-bold tracking-[-0.03em] md:text-4xl" style={{ color: V.ink }}>
          Quatro passos. Nenhum esforço a mais.
        </h2>
        <p className="mb-12 max-w-lg text-base leading-7" style={{ color: V.muted }}>
          Você não precisa mudar como sua família se comunica. A Vesta entra no meio do caos que já existe.
        </p>

        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-4">
          {steps.map((s, i) => (
            <div key={s.num} className="relative">
              {i < steps.length - 1 && (
                <ChevronRight className="absolute -right-4 top-8 hidden text-[#0E3B2E]/20 md:block" />
              )}
              <div className="mb-5 flex h-20 items-center justify-center rounded-2xl shadow-sm"
                style={{ background: V.cream, color: V.primary }}>
                {s.icon}
              </div>
              <p className="mb-1 text-[10px] font-bold tracking-widest" style={{ color: V.sage }}>{s.num}</p>
              <h3 className="mb-2 text-sm font-bold" style={{ color: V.ink }}>{s.title}</h3>
              <p className="text-sm leading-7" style={{ color: "#4D5A50" }}>{s.text}</p>
            </div>
          ))}
        </div>

        <div className="mt-14 grid gap-8 md:grid-cols-2 items-start">
          <div>
            <h3 className="font-serif text-2xl font-bold tracking-[-0.02em] mb-3" style={{ color: V.ink }}>
              Você decide as regras.{" "}
              <em className="not-italic" style={{ color: V.sage }}>A Vesta segue.</em>
            </h3>
            <p className="text-sm leading-7" style={{ color: V.muted }}>
              Nada acontece sem combinar. Você define o limite de autonomia da Vesta e ajusta quando quiser.
            </p>
          </div>
          <div className="rounded-2xl p-5" style={{ background: V.cream }}>
            <p className="mb-3 text-[10px] font-bold tracking-widest" style={{ color: V.sage }}>EXEMPLOS DE REGRAS</p>
            <ul className="space-y-2">
              {rules.map((r) => (
                <li key={r} className="flex items-center gap-3 text-sm" style={{ color: V.ink }}>
                  <div className="h-4 w-4 shrink-0 flex items-center justify-center rounded-full" style={{ background: V.softSage }}>
                    <Check className="h-2.5 w-2.5" style={{ color: V.primary }} />
                  </div>
                  {r}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

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
    <section id="concierge" className="mx-auto max-w-7xl px-6 pb-10">
      <div className="relative overflow-hidden rounded-[2rem] px-10 py-14" style={{ background: V.primary }}>
        <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full opacity-[0.06]" style={{ background: V.sage }} />
        <div className="absolute -bottom-24 right-24 h-60 w-60 rounded-full opacity-[0.06]" style={{ background: "white" }} />

        <div className="relative z-10 grid gap-12 lg:grid-cols-[1fr_1.1fr] items-start">
          <div>
            <VBadge light>CONCIERGE · ADD-ON PREMIUM</VBadge>
            <h2 className="mt-5 mb-5 font-serif text-3xl font-bold leading-tight tracking-[-0.03em] text-white md:text-4xl">
              O que você prefere não fazer,{" "}
              <em className="not-italic" style={{ color: "rgba(255,255,255,0.55)" }}>a Vesta resolve.</em>
            </h2>
            <p className="mb-6 max-w-md text-base leading-8" style={{ color: "rgba(255,255,255,0.68)" }}>
              Ajuda externa quando fizer sentido — não pra terceirizar sua vida. Você descreve em uma frase, a gente cota, agenda e acompanha. Você confirma antes de qualquer execução.
            </p>
            <div className="mb-8 inline-flex flex-col gap-1 rounded-2xl px-6 py-4" style={{ background: "rgba(255,255,255,0.08)" }}>
              <p className="text-white/50 text-xs font-bold tracking-widest">PREÇO</p>
              <p className="text-white text-2xl font-bold">R$ 49<span className="text-lg font-normal">/mês</span></p>
              <p className="text-white/50 text-xs">+ taxa por pedido resolvido</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/app"
                className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white transition-all"
                style={{ background: V.sage }}>
                Pedir ao Concierge <ArrowRight className="h-4 w-4" />
              </Link>
              <p className="self-center text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
                Pessoa real revisa · seg–sáb
              </p>
            </div>
          </div>

          <div>
            <p className="mb-4 text-[10px] font-bold tracking-widest" style={{ color: "rgba(255,255,255,0.45)" }}>PEDIDOS COMUNS</p>
            <div className="grid grid-cols-2 gap-3">
              {requests.map((r) => (
                <div key={r} className="flex items-start gap-2.5 rounded-xl px-4 py-3"
                  style={{ background: "rgba(255,255,255,0.07)" }}>
                  <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "rgba(255,255,255,0.45)" }} />
                  <p className="text-sm leading-snug" style={{ color: "rgba(255,255,255,0.80)" }}>{r}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const plans = [
    {
      name: "Grátis",
      price: "R$ 0",
      priceNote: "para sempre",
      description: "Pra começar a tirar a rotina da cabeça.",
      cta: "Começar grátis",
      ctaHref: "/app",
      highlight: false,
      badge: null,
      features: [
        "2 adultos + 1 criança",
        "3 categorias",
        "30 dias de histórico",
        "3 regras",
      ],
    },
    {
      name: "Premium",
      price: "R$ 29,90",
      priceNote: "/mês · ou R$ 279/ano",
      description: "Pra família que quer a rotina mais organizada.",
      cta: "Entrar na lista",
      ctaHref: "/app",
      highlight: true,
      badge: "MAIS ESCOLHIDO",
      features: [
        "Família ilimitada",
        "Papelzinho e recados",
        "Diarista com fluxo LGPD",
        "Pix automático e digest semanal",
      ],
    },
    {
      name: "Concierge",
      price: "R$ 49",
      priceNote: "/mês + taxa",
      description: "Pessoa real cota, agenda e compra — você confirma antes.",
      cta: "Quero saber mais",
      ctaHref: "#concierge",
      highlight: false,
      badge: null,
      features: [
        "Tudo do Premium",
        "Indicar profissional segue grátis",
        "Pedidos cotados e acompanhados",
        "Aprovação antes de qualquer execução",
      ],
    },
  ];

  return (
    <section id="planos" className="mx-auto max-w-7xl px-6 py-20">
      <VBadge>PLANOS</VBadge>
      <h2 className="mt-4 mb-2 font-serif text-3xl font-bold tracking-[-0.03em] md:text-4xl" style={{ color: V.ink }}>
        Preço justo,{" "}
        <em className="not-italic" style={{ color: V.sage }}>no seu tempo.</em>
      </h2>
      <p className="mb-14 max-w-sm text-sm leading-7" style={{ color: V.muted }}>
        Cancela quando quiser. Fundadora trava preço por 12 meses.
      </p>

      <div className="grid gap-6 md:grid-cols-3">
        {plans.map((plan) => (
          <div key={plan.name} className="flex flex-col rounded-[2rem] p-8"
            style={{
              background: plan.highlight ? V.primary : V.cream,
              border: plan.highlight ? "none" : `1px solid rgba(14,59,46,0.10)`,
              boxShadow: plan.highlight ? "0 24px 60px rgba(14,59,46,0.22)" : "0 2px 12px rgba(14,59,46,0.06)",
            }}>
            {plan.badge && (
              <div className="mb-4">
                <span className="rounded-full px-3 py-1 text-[10px] font-bold tracking-widest"
                  style={{ background: "rgba(255,255,255,0.16)", color: "rgba(255,255,255,0.9)" }}>
                  {plan.badge}
                </span>
              </div>
            )}
            <p className="text-base font-bold" style={{ color: plan.highlight ? "white" : V.ink }}>{plan.name}</p>
            <p className="mt-1 mb-5 text-sm leading-6" style={{ color: plan.highlight ? "rgba(255,255,255,0.60)" : V.muted }}>
              {plan.description}
            </p>
            <p className="font-serif text-4xl font-bold" style={{ color: plan.highlight ? "white" : V.ink }}>{plan.price}</p>
            <p className="mb-7 text-xs mt-1" style={{ color: plan.highlight ? "rgba(255,255,255,0.50)" : V.muted }}>{plan.priceNote}</p>
            <ul className="mb-8 flex-1 space-y-3">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm"
                  style={{ color: plan.highlight ? "rgba(255,255,255,0.85)" : V.ink }}>
                  <Check className="mt-0.5 h-4 w-4 shrink-0"
                    style={{ color: plan.highlight ? "rgba(255,255,255,0.55)" : V.sage }} />
                  {f}
                </li>
              ))}
            </ul>
            <VButton href={plan.ctaHref} variant={plan.highlight ? "light" : "ghost"}>
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
        <p className="mb-5 font-serif text-5xl leading-none" style={{ color: V.sage }}>"</p>
        <blockquote className="max-w-2xl font-serif text-2xl font-semibold leading-snug tracking-[-0.02em] md:text-3xl" style={{ color: V.ink }}>
          A Vesta virou o coração da nossa casa. Nada fica esquecido, e a rotina finalmente não depende só de mim.
        </blockquote>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full font-bold text-white text-sm"
            style={{ background: V.sage }}>J</div>
          <div>
            <p className="text-sm font-semibold" style={{ color: V.ink }}>Juliana</p>
            <p className="text-xs" style={{ color: V.muted }}>mãe do Theo e da Bia</p>
          </div>
          <div className="ml-auto flex gap-0.5">
            {[0,1,2,3,4].map(i => <Star key={i} className="h-4 w-4" style={{ fill: V.gold, color: V.gold }} />)}
          </div>
        </div>
      </div>
    </section>
  );
}

function WaitlistCTA() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (email) setDone(true);
  }

  return (
    <section id="lista-de-espera" className="mx-auto max-w-7xl px-6 pb-20">
      <div className="grid overflow-hidden rounded-[2rem] md:grid-cols-[1fr_1.1fr]"
        style={{ background: V.ivory, border: `1px solid rgba(14,59,46,0.09)` }}>
        <div className="p-10 md:p-12" style={{ borderRight: `1px solid rgba(14,59,46,0.09)` }}>
          <VBadge>LISTA DE ESPERA — VAGAS LIMITADAS</VBadge>
          <h2 className="mt-5 mb-4 font-serif text-3xl font-bold tracking-[-0.03em]" style={{ color: V.ink }}>
            Garanta sua vaga
          </h2>
          <p className="mb-8 max-w-sm text-base leading-8" style={{ color: V.muted }}>
            Conta um pouco da sua família. A gente chama em pequenos grupos pra cuidar bem de cada uma.
          </p>
          <div className="space-y-3">
            {[
              { text: "Pré-lançamento — ainda não está aberto pra todo mundo", active: true },
              { text: "Chamando as primeiras famílias", active: true },
              { text: "Atendimento de perto no começo", active: false },
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
        </div>

        <div className="flex flex-col justify-center p-10 md:p-12">
          <div className="mx-auto w-full max-w-sm rounded-3xl p-8 shadow-md" style={{ background: "white" }}>
            {done ? (
              <div className="text-center py-4">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: V.softSage }}>
                  <Check className="h-6 w-6" style={{ color: V.primary }} />
                </div>
                <h3 className="font-serif text-xl font-bold mb-2" style={{ color: V.ink }}>Você entrou na lista!</h3>
                <p className="text-sm leading-6" style={{ color: V.muted }}>
                  A gente entra em contato assim que sua vaga abrir. Fique de olho no e-mail.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <h3 className="mb-1 font-serif text-xl font-bold" style={{ color: V.ink }}>Começa pelo seu email.</h3>
                <p className="mb-6 text-xs leading-5" style={{ color: V.muted }}>
                  Em seguida a gente faz umas perguntas rápidas sobre a sua família.
                </p>
                <label className="mb-1.5 block text-xs font-semibold" style={{ color: V.ink }}>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@familia.com"
                  required
                  className="mb-4 w-full rounded-2xl border px-4 py-3 text-sm outline-none transition-all"
                  style={{ borderColor: `rgba(14,59,46,0.20)`, background: V.ivory, color: V.ink }}
                />
                <button type="submit"
                  className="flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold text-white"
                  style={{ background: V.primary }}>
                  Continuar <ArrowRight className="h-4 w-4" />
                </button>
                <p className="mt-4 text-center text-xs" style={{ color: V.muted }}>
                  Leva até 30 segundos. Spam, nunca.
                </p>
              </form>
            )}
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
      <VBadge>DÚVIDAS</VBadge>
      <h2 className="mt-4 mb-12 font-serif text-3xl font-bold tracking-[-0.03em] md:text-4xl" style={{ color: V.ink }}>
        Respostas honestas sobre o que é (e o que não é) a Vesta.
      </h2>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={item.q} className="overflow-hidden rounded-2xl" style={{ border: `1px solid rgba(14,59,46,0.10)` }}>
            <button
              onClick={() => setOpen(open === i ? null : i)}
              className="flex w-full items-center justify-between px-6 py-5 text-left text-sm font-semibold transition-colors"
              style={{ background: open === i ? V.cream : "white", color: V.ink }}>
              {item.q}
              <ChevronDown className="h-4 w-4 shrink-0 transition-transform"
                style={{ color: V.sage, transform: open === i ? "rotate(180deg)" : "rotate(0deg)" }} />
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
        style={{ background: V.primary }}>
        <p className="mb-3 font-serif text-sm font-semibold tracking-widest" style={{ color: "rgba(255,255,255,0.45)" }}>
          MANIFESTO VESTA
        </p>
        <h2 className="mb-3 font-serif text-3xl font-bold tracking-[-0.03em] text-white md:text-4xl">
          A casa aprende. Você respira.
        </h2>
        <p className="mb-8 text-base max-w-sm" style={{ color: "rgba(255,255,255,0.60)" }}>
          Pronta pra sentir sua casa mais leve?
        </p>
        <Link href="/app"
          className="inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-sm font-semibold transition-all"
          style={{ background: V.cream, color: V.primary, boxShadow: "0 12px 30px rgba(0,0,0,0.20)" }}>
          Entra na lista <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t py-12" style={{ borderColor: `rgba(14,59,46,0.10)`, background: V.ivory }}>
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ border: `1px solid rgba(14,59,46,0.20)` }}>
                <Home className="h-5 w-5" style={{ color: V.primary }} strokeWidth={1.8} />
              </div>
              <span className="text-lg font-semibold" style={{ color: V.ink }}>vesta</span>
            </div>
            <p className="text-sm leading-7 max-w-xs" style={{ color: V.muted }}>
              O sistema operacional discreto da casa. Captura, organiza e delega — pra família andar sem cobrança.
            </p>
            <p className="mt-4 text-xs" style={{ color: "#aaa" }}>São Paulo · Brasil</p>
          </div>

          <div>
            <p className="mb-4 text-xs font-bold tracking-widest" style={{ color: V.ink }}>PRODUTO</p>
            <ul className="space-y-2.5">
              {[["Como funciona","#como-funciona"],["Concierge","#concierge"],["Planos","#planos"],["Lista de espera","#lista-de-espera"]].map(([l,h]) => (
                <li key={l}><a href={h} className="text-sm hover:opacity-70 transition-opacity" style={{ color: V.muted }}>{l}</a></li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-4 text-xs font-bold tracking-widest" style={{ color: V.ink }}>LEGAL</p>
            <ul className="space-y-2.5">
              {["Privacidade","Termos de uso"].map((l) => (
                <li key={l}><a href="#" className="text-sm hover:opacity-70 transition-opacity" style={{ color: V.muted }}>{l}</a></li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-4 text-xs font-bold tracking-widest" style={{ color: V.ink }}>FALE COM A GENTE</p>
            <ul className="space-y-2.5">
              {["contato@vesta.casa","privacidade@vesta.casa"].map((e) => (
                <li key={e}><a href={`mailto:${e}`} className="text-sm hover:opacity-70 transition-opacity" style={{ color: V.muted }}>{e}</a></li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t pt-8" style={{ borderColor: `rgba(14,59,46,0.08)` }}>
          <p className="text-xs" style={{ color: "#aaa" }}>© 2026 Vesta Tecnologia Ltda. Todos os direitos reservados. Feito com cuidado para famílias brasileiras.</p>
          <a href="#" className="text-xs hover:opacity-70 transition-opacity" style={{ color: "#aaa" }}>Política de privacidade</a>
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
      <HowItWorks />
      <Concierge />
      <Pricing />
      <Testimonial />
      <WaitlistCTA />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  );
}
