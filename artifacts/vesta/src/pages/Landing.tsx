import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  Mic, Check, Calendar, MessageCircle, List, Users, Hand, Lock,
  Eye, Server, SlidersHorizontal, Shield, Plus, X, CheckCircle,
} from "lucide-react";
import "./landing-v3.css";
import heroFamiliaImg from "@assets/hero-familia_1780377659160.webp";
import regrasoPaiImg from "@assets/regras-pai_1780377617921.webp";
import comoFuncionaImg from "@assets/como-funciona_1780377671830.webp";

/* ── Hearth SVG mark (Vesta brand) ── */
function HearthMark({ className = "", style = {} }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" className={className} style={style} aria-hidden="true">
      <path fill="currentColor" fillRule="evenodd"
        d="M14 70 Q8 70 8 64 L8 39 A32 32 0 0 1 72 39 L72 64 Q72 70 66 70 Z M40 30 A17 17 0 0 0 23 47 L23 64 Q23 66 25 66 L55 66 Q57 66 57 64 L57 47 A17 17 0 0 0 40 30 Z" />
    </svg>
  );
}

/* ── WhatsApp icon ── */
function IconWave({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
      <path d="M12.004 2C6.477 2 2 6.477 2 12c0 1.785.47 3.458 1.29 4.905L2 22l5.235-1.273A9.956 9.956 0 0012.004 22C17.53 22 22 17.523 22 12S17.53 2 12.004 2zm0 18.173a8.17 8.17 0 01-4.154-1.13l-.297-.178-3.104.755.785-2.999-.196-.31A8.173 8.173 0 1112.004 20.173z"/>
    </svg>
  );
}

const WAITLIST_ENDPOINT = "https://feqykyiyqzkmepfeehmg.supabase.co/functions/v1/waitlist-signup";
const EMAIL_RE = /^\S+@\S+\.\S+$/;

async function submitWaitlist(payload: Record<string, unknown>): Promise<boolean> {
  try {
    const r = await fetch(WAITLIST_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/* ── Waitlist form ── */
function WaitlistForm({ id = "waitlist-form" }: { id?: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [lar, setLar] = useState("filhos");
  const [nameErr, setNameErr] = useState(false);
  const [emailErr, setEmailErr] = useState(false);
  const [pending, setPending] = useState(false);
  const [netErr, setNetErr] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const badName = !name.trim();
    const badEmail = !EMAIL_RE.test(email.trim());
    setNameErr(badName);
    setEmailErr(badEmail);
    if (badName || badEmail) return;
    setPending(true);
    setNetErr(false);
    const ok = await submitWaitlist({ email: email.trim(), name: name.trim(), lar, source: "landing-form" });
    setPending(false);
    if (ok) setDone(true);
    else setNetErr(true);
  }

  if (done) {
    return (
      <div className="form-card" style={{ textAlign: "center", padding: "40px 30px" }}>
        <CheckCircle style={{ width: 48, height: 48, color: "var(--approval)", margin: "0 auto 16px", display: "block" }} />
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: 24, fontVariationSettings: '"SOFT" 100,"opsz" 30' }}>
          Você está na lista.
        </h3>
        <p style={{ fontSize: 14, color: "var(--fg-muted)", marginTop: 8, lineHeight: 1.6 }}>
          A gente chama na sua vez. Enquanto isso, fica por perto — é onde a gente conta o que vem primeiro.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 18, flexWrap: "wrap" }}>
          <a className="btn btn--primary btn--sm" href="https://instagram.com/vestaoai" target="_blank" rel="noopener">Seguir @vestaoai</a>
          <a className="btn btn--secondary btn--sm"
            href={`https://wa.me/?text=${encodeURIComponent("Achei a Vesta — uma assistente da família no WhatsApp. Entra na lista: https://vestaoai.com.br")}`}
            target="_blank" rel="noopener">Contar pra uma amiga</a>
        </div>
      </div>
    );
  }

  return (
    <div className="form-card" id={id}>
      <form onSubmit={handleSubmit} noValidate>
        <div className={`field${nameErr ? " field--error" : ""}`}>
          <label htmlFor="nome">Seu nome</label>
          <input id="nome" type="text" autoComplete="name" value={name}
            onChange={e => { setName(e.target.value); if (e.target.value.trim()) setNameErr(false); }} />
          <span className="field__err">Como a gente te chama?</span>
        </div>
        <div className={`field${emailErr ? " field--error" : ""}`}>
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" inputMode="email" autoComplete="email" value={email}
            onChange={e => { setEmail(e.target.value); if (EMAIL_RE.test(e.target.value.trim())) setEmailErr(false); }} />
          <span className="field__err">Confere o e-mail? Parece faltar algo.</span>
        </div>
        <div className="field">
          <label>Quantas pessoas moram com você?</label>
          <div className="choices" role="radiogroup">
            {([["solo","Moro sozinho(a)"],["casal","Eu + parceiro(a)"],["filhos","Família com filhos"],["multi","Multigeracional"]] as const).map(([v,l]) => (
              <label key={v} className="choice">
                <input type="radio" name="lar" value={v} checked={lar === v} onChange={() => setLar(v)} />
                <span>{l}</span>
              </label>
            ))}
          </div>
        </div>
        <button type="submit" className="btn btn--primary btn--lg" style={{ width: "100%", marginTop: 8 }}
          aria-busy={pending ? "true" : undefined}>
          <span className="btn__spin" aria-hidden="true" />
          <span>{pending ? "Entrando…" : "Quero entrar na lista"}</span>
        </button>
        {netErr && <p className="form__neterr">Ops, algo travou aqui. Tenta de novo em instantes?</p>}
      </form>
      <div className="form__or">ou</div>
      <a className="btn btn--wa btn--lg"
        href="#lista"
        onClick={e => { e.preventDefault(); document.getElementById("nome")?.focus(); }}>
        <IconWave style={{ width: 20, height: 20 } as React.CSSProperties} />
        Começar pelo WhatsApp
      </a>
      <p className="form__fine">
        Sem spam. Você só recebe quando a sua vez chegar. Ao continuar, você concorda com a nossa{" "}
        <a href="https://vestaoai.com.br/privacidade">política de privacidade</a>.
      </p>
    </div>
  );
}

/* ── Exit-intent modal ── */
function ExitModal() {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [exitEmail, setExitEmail] = useState("");
  const [emailErr, setEmailErr] = useState(false);
  const [pending, setPending] = useState(false);
  const seenKey = "vesta_exit_seen";

  useEffect(() => {
    try { if (localStorage.getItem(seenKey)) return; } catch { /* ignore */ }
    let armed = false, moved = false;
    const armTimer = setTimeout(() => { armed = true; }, 8000);
    const onScroll = () => { if (window.scrollY > 120) moved = true; };
    const onMove = (e: MouseEvent) => { if (e.clientY > 140) moved = true; };
    const onOut = (e: MouseEvent) => {
      if (armed && moved && window.innerWidth > 760 && !e.relatedTarget && e.clientY <= 0) {
        try { localStorage.setItem(seenKey, "1"); } catch { /* ignore */ }
        setOpen(true);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseout", onOut);
    return () => {
      clearTimeout(armTimer);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseout", onOut);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;

  async function handleExitSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(exitEmail.trim())) { setEmailErr(true); return; }
    setEmailErr(false);
    setPending(true);
    const ok = await submitWaitlist({ email: exitEmail.trim(), source: "exit-intent" });
    setPending(false);
    if (ok) { setDone(true); setTimeout(() => setOpen(false), 2800); }
    else setEmailErr(true);
  }

  return (
    <div className="exitmodal is-open" role="dialog" aria-modal="true" aria-labelledby="exit-title">
      <div className="exitmodal__scrim" onClick={() => setOpen(false)} />
      <div className="exitmodal__card">
        <button className="exitmodal__close" onClick={() => setOpen(false)} aria-label="Fechar">
          <X style={{ width: 18, height: 18 }} />
        </button>
        {done ? (
          <div>
            <HearthMark style={{ width: 42, height: 42, color: "var(--brand)", margin: "0 auto 16px", display: "block" }} />
            <h3 id="exit-title">Você está na lista. ♥</h3>
            <p>A gente chama na sua vez. Pode fechar a aba tranquila.</p>
          </div>
        ) : (
          <>
            <HearthMark style={{ width: 42, height: 42, color: "var(--brand)", margin: "0 auto 16px", display: "block" }} />
            <h3 id="exit-title">Antes de ir — <em>tira uma coisa da cabeça?</em></h3>
            <p>Entra na lista e a gente te chama na próxima onda. Sem pressa, sem spam.</p>
            <form className="exitmodal__form" onSubmit={handleExitSubmit} noValidate>
              <div className={`exitmodal__field${emailErr ? " field--error" : ""}`}>
                <input type="email" inputMode="email" placeholder="Seu melhor e-mail" value={exitEmail}
                  onChange={e => { setExitEmail(e.target.value); if (EMAIL_RE.test(e.target.value.trim())) setEmailErr(false); }} />
                <button type="submit" className="btn btn--primary" aria-busy={pending ? "true" : undefined}>
                  <span className="btn__spin" aria-hidden="true" />
                  <span>{pending ? "Entrando…" : "Entrar"}</span>
                </button>
              </div>
              {emailErr && <span className="field__err" style={{ display: "block", marginTop: 8, textAlign: "left" }}>Confere o e-mail? Parece faltar algo.</span>}
            </form>
            <p className="exitmodal__fine">1.000+ famílias já na lista · próxima onda em junho</p>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Main landing component ── */
export default function Landing() {
  const navRef = useRef<HTMLElement>(null);
  const [navStuck, setNavStuck] = useState(false);
  const [mobarOn, setMobarOn] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setNavStuck(window.scrollY > 8);
      setMobarOn(window.scrollY > 620);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="lv3" id="top">
      <a className="skip" href="#main">Ir para o conteúdo</a>

      {/* ── NAV ── */}
      <header>
        <nav ref={navRef} className={`nav${navStuck ? " is-stuck" : ""}`} aria-label="Navegação principal">
          <div className="wrap nav__row">
            <a className="brand" href="#top" aria-label="Vesta — início">
              <HearthMark className="brand__mark" />
              <span className="brand__name">Vesta</span>
            </a>
            <nav className="nav__links" aria-label="Seções">
              <a href="#produto">Produto</a>
              <a href="#recursos">Recursos</a>
              <a href="#planos">Planos</a>
            </nav>
            <div className="nav__right">
              <Link href="/app" className="nav__signin">Entrar</Link>
              <a className="btn btn--primary" href="#lista" style={{ padding: "10px 20px", fontSize: 14 }}>
                Entrar na lista
              </a>
            </div>
          </div>
        </nav>
      </header>

      <main id="main">

        {/* ── HERO ── */}
        <section className="hero">
          <div className="wrap">
            <div className="hero__grid">
              <div>
                <div className="eyebrow">Assistente familiar · WhatsApp</div>
                <h1>A casa não precisa morar <em>só na sua cabeça.</em></h1>
                <p className="hero__sub">
                  Você manda um recado — escola, boleto, áudio, bilhete — e a Vesta vira ação. Sempre com a sua confirmação.
                </p>
                <div className="hero__cta">
                  <a className="btn btn--primary btn--lg" href="#lista">Entrar na lista</a>
                  <a className="btn btn--ghost" href="#como">Ver como funciona →</a>
                </div>
                <div className="hero__proof">
                  <div className="avatars">
                    <span className="av1">J</span>
                    <span className="av2">M</span>
                    <span className="av3">R</span>
                    <span className="av4">A</span>
                  </div>
                  <p><b>1.000+ famílias</b> já pararam de carregar tudo sozinhas · próxima onda em junho</p>
                </div>
              </div>

              <div className="stage" aria-hidden="true">
                <div className="stage__photo" style={{ backgroundImage: `url(${heroFamiliaImg})`, backgroundSize: "cover", backgroundPosition: "center" }} />
                <span className="script stage__script">
                  a casa toda.<br /><span className="heart">♥</span>
                </span>
                <div className="stage__card">
                  <span className="stage__card__chip">
                    <span className="dot" />
                    Sugerido · agora
                  </span>
                  <div className="stage__card__t">Marcar pediatra — Bia</div>
                  <div className="stage__card__m">Quinta, 8 jun · + lembrete: boleto escola (vence 10/jun)</div>
                  <div className="stage__card__row">
                    <span className="stage__card__b stage__card__b--p">Aprovar</span>
                    <span className="stage__card__b stage__card__b--g">Mudar</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── PRODUCT SHOWCASE ── */}
        <section className="showcase" id="produto">
          <div className="wrap">
            <div className="shead shead--c">
              <div className="eyebrow">Como é por dentro</div>
              <h2>Você manda do seu jeito. <em>A Vesta cuida do resto.</em></h2>
            </div>
            <div className="showcase__row">
              <div className="showcase__col showcase__col--l">
                <div className="callout">
                  <div className="callout__h"><Mic /> Captura inteligente</div>
                  <p>De voz, texto, foto ou recado. A Vesta entende e organiza.</p>
                </div>
                <div className="callout">
                  <div className="callout__h"><Check /> Regras que aprendem</div>
                  <p>A Vesta conhece a rotina e sugere o quê, quando e pra quem.</p>
                </div>
              </div>

              <div className="phone" aria-hidden="true">
                <div className="phone__screen">
                  <div className="wa-head">
                    <HearthMark className="brand__mark" />
                    <span className="wa-head__t">Vesta</span>
                    <span className="wa-head__s"><span className="dot" /> online</span>
                  </div>
                  <div className="bub bub--meta">Você repassou · 1 toque</div>
                  <div className="bub bub--in">Mãe, preciso marcar a pediatra da Bia pra quinta. E não esquece o boleto da escola que vence dia 10. 🙏</div>
                  <div className="arrowdown">a Vesta organizou</div>
                  <div className="appcard">
                    <span className="appcard__chip"><span className="dot" /> Sugerido · agora</span>
                    <div className="appcard__t">Marcar pediatra — Bia</div>
                    <div className="appcard__m">Quinta, 8 jun · + lembrete: boleto escola (vence 10/jun)</div>
                    <div className="appcard__row">
                      <span className="appcard__btn appcard__btn--p">Aprovar</span>
                      <span className="appcard__btn appcard__btn--g">Mudar</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="showcase__col showcase__col--r">
                <div className="callout">
                  <div className="callout__h"><Calendar /> No calendário certo</div>
                  <p>Escreve no lugar certo: Google, iCal, Outlook e mais.</p>
                </div>
                <div className="callout">
                  <div className="callout__h"><MessageCircle /> Onde a casa já conversa</div>
                  <p>A Vesta vive no WhatsApp da família. Sem aprender ferramenta nova.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── INTEGRATION BAR ── */}
        <div className="integbar">
          <div className="wrap integbar__row">
            <span className="integbar__lead">Conecte uma vez o que a família já usa</span>
            <span className="integbar__item"><IconWave style={{ width: 20, height: 20, color: "var(--approval-deep)" } as React.CSSProperties} /> WhatsApp</span>
            <span className="integbar__item"><Calendar style={{ width: 20, height: 20, color: "var(--approval-deep)" }} /> Google Calendar</span>
            <span className="integbar__item"><Calendar style={{ width: 20, height: 20, color: "var(--approval-deep)" }} /> Outlook</span>
            <span className="integbar__item" style={{ color: "var(--fg-soft)" }}>+ mais</span>
          </div>
        </div>

        {/* ── INVISIBLE WORK BAND ── */}
        <section className="band">
          <div className="wrap">
            <div className="eyebrow">O trabalho que ninguém vê</div>
            <h2>Você não está desorganizada. <em>Você é o sistema.</em></h2>
            <p className="band__lede">
              É um banco de dados que só existe na sua cabeça — sem backup, sem equipe, sem folga. E quando uma coisa escapa, todo mundo pergunta por que <em>você</em> esqueceu.
            </p>
            <div className="band__pile">
              {[
                "o médico que a criança foi e o que receitou",
                "o dia que a diarista não pode vir",
                "o vencimento de cada conta",
                "a reunião da escola na quinta",
                "o remédio que não pode faltar",
                "o passaporte que vence em julho",
                "a fruta que o filho do meio não come",
                "a senha do wifi de 3 anos atrás",
                "quem busca quem, e a que horas",
                "o presente do aniversário de sábado",
                "quando acaba o gás",
                "o que faltou no mercado",
              ].map((t) => <span key={t}>{t}</span>)}
            </div>
            <div className="band__turn">
              <HearthMark className="hearth-sm" />
              <div className="band__foot">
                A Vesta tira esse peso de uma pessoa só.<br />
                <em>Menos cobrança. Mais combinados.</em>
              </div>
            </div>
          </div>
        </section>

        {/* ── PHOTO BAND ── */}
        <div className="photoband" role="img" aria-label="Família brasileira na correria da manhã de escola, dividindo as tarefas" style={{ backgroundImage: `url(${comoFuncionaImg})`, backgroundSize: "cover", backgroundPosition: "center 30%" }}>
          <div className="photoband__cap">
            <div className="wrap">
              <span className="script">Para a casa toda. Não só para uma pessoa. ♥</span>
            </div>
          </div>
        </div>

        {/* ── FEATURE GRID ── */}
        <section id="recursos">
          <div className="wrap">
            <div className="shead shead--c">
              <div className="eyebrow">Tudo em um só lugar</div>
              <h2>Tudo que uma família precisa. <em>Em um só lugar.</em></h2>
            </div>
            <div className="feat-grid">
              {[
                { icon: <Mic />, title: "Entra do jeito que a vida manda", desc: "Mensagem, e-mail, foto ou áudio: você repassa do jeito que dá e a Vesta entende. Sem formulário, sem triagem." },
                { icon: <List />, title: "Organiza e prioriza", desc: "A Vesta transforma o caos em planos claros, com prazos e prioridades." },
                { icon: <Users />, title: "Delega sem estresse", desc: "O combinado vai pra pessoa certa, com contexto e sem cobrança." },
                { icon: <Calendar />, title: "Escreve no lugar certo", desc: "Compromissos e lembretes no calendário certo, sempre atualizados." },
                { icon: <Hand />, title: "Resolve por você", desc: "Peça ajuda quando precisar. A Vesta encontra, agenda e acompanha." },
                { icon: <Lock />, title: "Privacidade inegociável", desc: "Seus dados são seus. Seguros, privados e nunca compartilhados." },
              ].map(({ icon, title, desc }) => (
                <div key={title} className="fcard">
                  <div className="fcard__ic">{icon}</div>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── COMO FUNCIONA ── */}
        <section id="como" style={{ background: "var(--surface-soft)" }}>
          <div className="wrap">
            <div className="shead">
              <div className="eyebrow">Como funciona</div>
              <h2>Você conecta uma vez. <em>Depois, é só aprovar.</em></h2>
              <p>A parte cansativa nunca foi mandar — é separar, lembrar e cobrar. Isso a Vesta tira de você. Seu trabalho recorrente vira um só: aprovar.</p>
            </div>
            <div className="steps">
              {[
                { n: "01", title: "Conecte a casa, uma vez", desc: "Ligue sua agenda e deixe o e-mail da escola cair direto na Vesta. Configura uma vez e pronto." },
                { n: "02", title: "Manda num toque, sem organizar", desc: "O recado, a foto, o áudio — você só repassa. Quem tria, entende e monta o plano é a Vesta. Você nunca classifica nada." },
                { n: "03", title: "Você só aprova", desc: "Um toque: confirma, ajusta ou delega. Esse é o único passo que continua com você." },
                { n: "04", title: "A Vesta cuida do resto", desc: "Escreve no calendário, avisa quem precisa e acompanha até resolver." },
              ].map(({ n, title, desc }) => (
                <div key={n} className="step">
                  <div className="step__n">{n}</div>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                  <div className="step__line" />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── RULES + PHOTO ── */}
        <section id="regras">
          <div className="wrap split">
            <div>
              <div className="eyebrow">Regras da casa</div>
              <h2 style={{ fontSize: 38, marginTop: 14, fontVariationSettings: '"SOFT" 100,"opsz" 40' }}>
                Você decide as regras. <em>A Vesta segue.</em>
              </h2>
              <p style={{ color: "var(--fg-muted)", marginTop: 14, fontSize: 16, lineHeight: 1.6, maxWidth: "42ch" }}>
                Nada acontece sem combinar. Você define o limite de autonomia da Vesta e ajusta quando quiser — sem mexer em código, sem chamar suporte.
              </p>
              <ul className="rules-list">
                {[
                  "Quem pode aprovar o quê — você, o parceiro, ou ninguém.",
                  "O que vai pro calendário automaticamente — e o que sempre passa por você.",
                  "Quais categorias a Vesta pode delegar sem perguntar.",
                  "Quem recebe quais lembretes e em qual canal.",
                ].map((item) => (
                  <li key={item}>
                    <span className="ck"><Check style={{ width: 13, height: 13 }} /></span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="photoslot" style={{ backgroundImage: `url(${regrasoPaiImg})`, backgroundSize: "cover", backgroundPosition: "center" }} />
          </div>
        </section>

        {/* ── TIMELINE ── */}
        <section style={{ background: "var(--surface-soft)" }}>
          <div className="wrap">
            <div className="shead">
              <div className="eyebrow">Como a Vesta evolui com a sua casa</div>
              <h2>Começa com suas regras. <em>Aprende com o tempo.</em></h2>
              <p>A Vesta não chega tomando decisões. Entra discreta, segue o que você combinou e vai ganhando contexto na medida em que você confia.</p>
            </div>
            <div className="rail">
              <div className="tcard">
                <div className="tcard__when">No começo</div>
                <h3>Você define as regras</h3>
                <p>Quem confirma o quê, quais canais a Vesta escuta, o que vai direto pro calendário. Ela começa fazendo só o que você combinou.</p>
              </div>
              <div className="tcard">
                <div className="tcard__when">Com o uso</div>
                <h3>Ela aprende o jeito da casa</h3>
                <p>Vai entendendo seus horários, quem cuida de quê, quais mensagens viram tarefa e quais só ficam registradas.</p>
              </div>
              <div className="tcard">
                <div className="tcard__when">Com o tempo</div>
                <h3>Sugere antes de você pedir</h3>
                <p>Aos poucos, antecipa padrões: "agendo a próxima vacina?", "reabasteço a feira de sexta?". Você só confirma — ou ajusta a regra.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── PRIVACY ── */}
        <section id="privacidade" className="priv">
          <div className="wrap">
            <div className="shead">
              <div className="eyebrow">Privacidade da casa</div>
              <h2>O que é da sua casa <em>fica na sua casa.</em></h2>
              <p>A Vesta foi pensada por gente que também é mãe, pai e parceiro. Rotina de família é íntimo — e a gente trata assim, do código à operação.</p>
            </div>
            <div className="priv__grid">
              {[
                { icon: <Lock className="pcard__ic" />, title: "Criptografia no que importa", desc: "Mensagens, fotos e contexto da família são protegidos em trânsito e em repouso." },
                { icon: <Eye className="pcard__ic" />, title: "Não treinamos IA com seus dados", desc: "Sua casa não vira dataset. Nada do que entra na Vesta sai pra alimentar IA externa." },
                { icon: <Server className="pcard__ic" />, title: "Hospedagem no Brasil, sob a LGPD", desc: "Servidores na região Brasil e DPO designado. Você exporta ou apaga tudo a qualquer momento." },
                { icon: <SlidersHorizontal className="pcard__ic" />, title: "Você decide canal por canal", desc: "Conecta o que quiser, desconecta quando quiser. A Vesta nunca lê o que você não autorizou." },
              ].map(({ icon, title, desc }) => (
                <div key={title} className="pcard">
                  {icon}
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── PLANS ── */}
        <section id="planos">
          <div className="wrap">
            <div className="shead shead--c">
              <div className="eyebrow">Planos</div>
              <h2>Preço justo, <em>no seu tempo.</em></h2>
              <p>Cancela quando quiser. Quem entra agora trava o preço de fundadora por 12 meses.</p>
            </div>
            <div className="plans">
              <div className="plan">
                <div className="plan__name">Grátis pra sempre</div>
                <div className="plan__price">R$ 0</div>
                <div className="plan__desc">Pra tirar a primeira coisa da cabeça e sentir como é.</div>
                <ul className="plan__feats">
                  {["2 adultos + 1 criança","3 categorias","30 dias de histórico","3 regras da casa"].map(f => (
                    <li key={f}><Check className="ck" /> {f}</li>
                  ))}
                </ul>
                <a className="btn btn--secondary plan__cta" href="#lista">Começar grátis</a>
              </div>

              <div className="plan plan--feature">
                <span className="plan__flag">Mais escolhido</span>
                <div className="plan__name">Premium</div>
                <div className="plan__price">R$ 29,90<small> /mês</small></div>
                <div className="plan__desc">A casa inteira na Vesta — sem limites no que importa no dia a dia.</div>
                <ul className="plan__feats">
                  {["Família completa, sem limite de membros","Categorias e histórico ampliados","Regras ilimitadas e delegação","Sugestões que aprendem com a casa"].map(f => (
                    <li key={f}><Check className="ck" /> {f}</li>
                  ))}
                </ul>
                <a className="btn btn--primary plan__cta" href="#lista">Entrar na lista</a>
                <div className="plan__note">Preço de fundadora travado por 12 meses.</div>
              </div>

              <div className="plan">
                <div className="plan__name">
                  Concierge <span style={{ fontSize: 12, color: "var(--fg-soft)", fontFamily: "var(--font-mono)" }}>add-on</span>
                </div>
                <div className="plan__price">R$ 49<small> /mês + taxa</small></div>
                <div className="plan__desc">O que você prefere não fazer, uma pessoa real resolve — você confirma antes da execução.</div>
                <ul className="plan__feats">
                  {["Pessoa real cota, agenda e acompanha","Taxa só por pedido resolvido","Atendimento de seg a sáb","Complemento do plano Premium"].map(f => (
                    <li key={f}><Check className="ck" /> {f}</li>
                  ))}
                </ul>
                <a className="btn btn--secondary plan__cta" href="#lista">Quero saber mais</a>
              </div>
            </div>
          </div>
        </section>

        {/* ── TESTIMONIALS ── */}
        <section style={{ background: "var(--surface-soft)" }}>
          <div className="wrap">
            <div className="shead shead--c">
              <div className="eyebrow">Quem segura a casa</div>
              <h2>Não é mágica. <em>É terça, 18h.</em></h2>
              <p>Histórias reais de famílias do piloto. Nomes preservados quando pedido.</p>
            </div>
            <div className="tg">
              <div className="quote quote--lead">
                <div className="quote__mark">"</div>
                <p>Terça, 18h, no meio da reunião. A Vesta me lembrou da consulta da Bia que eu tinha deixado passar — e já tinha achado dois horários. Eu só toquei em <em>aprovar.</em></p>
                <div className="quote__who">
                  <span className="quote__av" style={{ background: "var(--brand)" }}>J</span>
                  <div>
                    <div className="quote__name">Juliana, 38</div>
                    <div className="quote__role">Mãe do Theo e da Bia · São Paulo</div>
                  </div>
                </div>
              </div>
              <div className="quote">
                <div className="quote__mark">"</div>
                <p>A gente parou de cobrar um ao outro. O combinado chega pra quem tem que fazer, com prazo e contexto.</p>
                <div className="quote__who">
                  <span className="quote__av" style={{ background: "var(--approval)" }}>M</span>
                  <div>
                    <div className="quote__name">Marcos &amp; Leo</div>
                    <div className="quote__role">Casal · Belo Horizonte</div>
                  </div>
                </div>
              </div>
              <div className="quote">
                <div className="quote__mark">"</div>
                <p>Pela primeira vez eu não sou a única que sabe de tudo. Isso mudou o clima da casa.</p>
                <div className="quote__who">
                  <span className="quote__av" style={{ background: "var(--approval-deep)" }}>R</span>
                  <div>
                    <div className="quote__name">Renata, 41</div>
                    <div className="quote__role">Mãe da Sofia · Rio de Janeiro</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── WAITLIST ── */}
        <section id="lista" className="signup">
          <div className="wrap signup__grid">
            <div>
              <div className="eyebrow">Vagas limitadas · onda de junho</div>
              <h2>Deixe de ser <em>o sistema da casa.</em></h2>
              <p style={{ color: "rgba(253,251,246,.78)", marginTop: 18, maxWidth: "46ch", lineHeight: 1.7 }}>
                A Vesta abre em ondas pequenas, pra cuidar de cada família com calma. Entre agora e, na sua vez, a primeira coisa some da sua cabeça em 2 minutos.
              </p>
              <ul className="signup__benefits">
                {[
                  "Sua primeira regra da casa, no dia em que entrar",
                  "Preço de fundadora travado por 12 meses",
                  "Linha direta com quem está construindo",
                ].map(b => (
                  <li key={b}><Check className="ck" /> {b}</li>
                ))}
              </ul>
              <p className="signup__wave"><b>1.000+</b> famílias já pararam de carregar tudo sozinhas · próxima onda em junho</p>
            </div>
            <WaitlistForm />
          </div>
        </section>

        {/* ── TRUST STRIP ── */}
        <div className="trust">
          <div className="wrap trust__row">
            <div className="trust__item"><Shield /> <span>Seus dados. Sua família. <b>Sua confiança.</b></span></div>
            <div className="trust__item"><Server /> <span>Hospedado no Brasil · <b>conforme a LGPD</b></span></div>
            <div className="trust__script">Feita para famílias reais. Como a sua.</div>
          </div>
        </div>

        {/* ── FAQ ── */}
        <section>
          <div className="wrap">
            <div className="shead shead--c">
              <div className="eyebrow">Perguntas frequentes</div>
              <h2>O que toda família <em>pergunta primeiro.</em></h2>
            </div>
            <div className="faq">
              {[
                { q: "É só mais um app de agenda?", a: "Não. A Vesta não é um app de tarefas, calendário ou checklist. Ela vive no WhatsApp que a família já usa, entende o recado que chega e transforma em ação — escrevendo no calendário que você já tem, quando você confirma." },
                { q: "Quem da família precisa instalar?", a: "Você usa a Vesta pelo WhatsApp que já tem — sem aprender ferramenta nova. As outras pessoas da casa não instalam nada: só recebem o que foi combinado, pelo canal que você definir." },
                { q: "A Vesta lê tudo do meu WhatsApp?", a: "Não. A Vesta só lê o que você encaminha pra ela. Você decide canal por canal o que ela enxerga — e desconecta quando quiser." },
                { q: "O Concierge é humano ou IA?", a: "Humano. Uma pessoa real cota, agenda e acompanha o pedido. A Vesta organiza; você confirma antes de qualquer execução. O Concierge é um add-on do Premium, por R$ 49/mês + taxa por pedido resolvido." },
                { q: "Meus dados são usados pra treinar IA?", a: "Nunca. Sua casa não vira dataset. Nada do que entra na Vesta sai pra alimentar IA externa, e tudo segue a LGPD com hospedagem no Brasil." },
                { q: "Quanto vai custar?", a: "Tem plano grátis pra sempre. O Premium custa R$ 29,90/mês e o Concierge é um add-on por R$ 49/mês + taxa por pedido. Quem entra pela lista agora trava o preço de fundadora por 12 meses." },
                { q: "Quando vou conseguir entrar?", a: "A Vesta abre em ondas pequenas. A próxima é em junho. Entrando na lista, a gente chama você na sua vez — sem pressa, pra cuidar de cada família com calma." },
              ].map(({ q, a }) => (
                <details key={q}>
                  <summary>
                    {q}
                    <Plus className="pm" style={{ width: 20, height: 20 }} />
                  </summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── FOUNDER ── */}
        <section className="founder">
          <div className="wrap">
            <div className="founder__card">
              <div className="founder__photo">V</div>
              <div>
                <div className="eyebrow">De quem está construindo</div>
                <p className="founder__q" style={{ marginTop: 12 }}>
                  "Eu vivia sendo a agenda, o sistema e o lembrete da minha casa — e nenhum app foi feito pra isso. Construí a Vesta pra tirar esse peso de uma pessoa só. A casa é de todo mundo; o trabalho de lembrar também devia ser."
                </p>
                <div className="founder__sig"><b>— Gio</b>, fundador(a) da Vesta</div>
              </div>
            </div>
          </div>
        </section>

        {/* ── MANIFESTO ── */}
        <section className="manifesto">
          <div className="wrap">
            <HearthMark className="hearth" />
            <p>A casa aprende. <em>Você respira.</em></p>
            <a className="btn btn--primary btn--lg" href="#lista">Entrar na lista</a>
          </div>
        </section>

      </main>

      {/* ── FOOTER ── */}
      <footer className="foot">
        <div className="wrap">
          <div className="foot__grid">
            <div className="foot__brand">
              <a className="brand" href="#top" aria-label="Vesta">
                <HearthMark className="brand__mark" />
                <span className="brand__name">Vesta</span>
              </a>
              <p>A assistente inteligente da família. Captura, organiza e delega — para um dia a dia mais leve.</p>
            </div>
            <div>
              <h4>Produto</h4>
              <ul>
                <li><a href="#recursos">Recursos</a></li>
                <li><a href="#como">Como funciona</a></li>
                <li><a href="#planos">Planos</a></li>
                <li><a href="#lista">Lista de espera</a></li>
              </ul>
            </div>
            <div>
              <h4>Casa</h4>
              <ul>
                <li><a href="https://vestaoai.com.br/privacidade">Privacidade</a></li>
                <li><a href="https://vestaoai.com.br/termos">Termos de uso</a></li>
                <li><a href="#lista">Começar agora</a></li>
              </ul>
            </div>
            <div>
              <h4>Contato</h4>
              <ul>
                <li><a href="mailto:hello@vestaoai.com.br">hello@vestaoai.com.br</a></li>
                <li><a href="mailto:privacidade@vestaoai.com.br">privacidade@vestaoai.com.br</a></li>
                <li><a href="https://instagram.com/vestaoai">Instagram · @vestaoai</a></li>
              </ul>
            </div>
          </div>
          <div className="foot__legal">
            <span>São Paulo · Brasil · Feito com cuidado para famílias brasileiras.</span>
            <span>© 2026 Vesta</span>
          </div>
        </div>
      </footer>

      {/* ── STICKY MOBILE BAR ── */}
      <div className={`mobar${mobarOn ? " is-on" : ""}`}>
        <a className="btn btn--primary" href="#lista">Tire uma coisa da cabeça</a>
      </div>

      {/* ── EXIT-INTENT MODAL ── */}
      <ExitModal />
    </div>
  );
}
