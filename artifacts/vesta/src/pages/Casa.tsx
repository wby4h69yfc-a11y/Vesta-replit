import { useState } from "react";
import { useLocation } from "wouter";
import {
  Users, ShieldCheck, ChevronRight, Plus, Trash2,
  Home, Baby, Heart, Lock, Bell, Key, HelpCircle, LogOut,
  Sparkles, CheckCircle, Clock, AlertCircle, X
} from "lucide-react";
import { useGetHousehold } from "@workspace/api-client-react";

const V = {
  primary: "#0E3B2E",
  deep:    "#08251E",
  sage:    "#6F856F",
  ivory:   "#F7F4EA",
  cream:   "#FFFDF6",
  beige:   "#EEE6D6",
  ink:     "#12231C",
  muted:   "#5F6B61",
};

type Tab = "inicio" | "familia" | "diarista" | "privacidade";

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "inicio",      label: "Início" },
    { id: "familia",     label: "Família" },
    { id: "diarista",    label: "Diarista" },
    { id: "privacidade", label: "Privacidade" },
  ];
  return (
    <div className="flex" style={{ borderBottom: "1px solid rgba(14,59,46,0.08)" }}>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className="flex-1 py-3 text-xs font-semibold transition-colors"
          style={{
            color: active === t.id ? V.primary : V.muted,
            borderBottom: active === t.id ? `2px solid ${V.primary}` : "2px solid transparent",
          }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ── Início tab ──────────────────────────────────────── */
function InicioTab() {
  const { data: household } = useGetHousehold();
  const plan = household?.plan ?? "free";
  const isPremium = plan === "premium";

  const features = [
    { label: "Categorias ativas",          free: "3 de 7",        premium: "Todas 7" },
    { label: "Regras inteligentes",         free: "3 regras",      premium: "Ilimitado" },
    { label: "Histórico",                   free: "30 dias",       premium: "Completo + busca" },
    { label: "Resumo semanal (WhatsApp)",   free: "—",             premium: "Dom 20h" },
    { label: "Parceiro com edição",         free: "Só leitura",    premium: "Leitura + edição" },
    { label: "Imagens (papelzinho + OCR)",  free: "—",             premium: "✓ com OCR" },
  ];

  return (
    <div className="space-y-6 py-6">
      {/* Household card */}
      {household && (
        <div className="p-5 rounded-3xl flex items-center gap-4"
          style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-xl"
            style={{ background: V.primary }}>
            {household.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold" style={{ color: V.ink }}>{household.name}</p>
            {household.location && <p className="text-xs mt-0.5" style={{ color: V.muted }}>{household.location}</p>}
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full mt-1.5 inline-block"
              style={{
                background: isPremium ? "#FEF3C7" : "#EAF1E5",
                color:      isPremium ? "#92400E"  : V.primary,
              }}>
              {isPremium ? "Premium" : "Gratuito"}
            </span>
          </div>
        </div>
      )}

      {/* Upsell banner */}
      {!isPremium && (
        <div className="p-5 rounded-3xl"
          style={{ background: "linear-gradient(135deg, #0E3B2E 0%, #1A5C45 100%)" }}>
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-white mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-white mb-0.5">Upgrade para Premium</p>
              <p className="text-xs text-white/70 mb-3">R$24,90/mês · ou R$199/ano (economize 34%)</p>
              <button className="px-5 py-2 rounded-full text-xs font-bold text-white bg-white/20 hover:bg-white/30 transition-colors">
                Ver benefícios →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Plan features */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: V.muted }}>Seu plano</h2>
        <div className="rounded-3xl overflow-hidden" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
          {features.map((f, i) => (
            <div key={f.label} className="flex items-center gap-3 px-5 py-3.5"
              style={{ borderTop: i > 0 ? "1px solid rgba(14,59,46,0.06)" : "none" }}>
              {isPremium
                ? <CheckCircle className="h-4 w-4 shrink-0" style={{ color: V.primary }} />
                : <Lock className="h-4 w-4 shrink-0" style={{ color: V.muted }} />}
              <p className="flex-1 text-sm" style={{ color: V.ink }}>{f.label}</p>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{ background: isPremium ? "#EAF1E5" : V.beige, color: isPremium ? V.primary : V.muted }}>
                {isPremium ? f.premium : f.free}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Account settings */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: V.muted }}>Conta</h2>
        <div className="rounded-3xl overflow-hidden" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
          {[
            { icon: Bell,         label: "Notificações",  desc: "WhatsApp e push" },
            { icon: Key,          label: "Segurança",     desc: "Senha e acesso" },
            { icon: HelpCircle,   label: "Ajuda",         desc: "FAQ e suporte" },
          ].map((item, i) => (
            <button key={item.label} className="w-full flex items-center gap-4 px-5 py-4 text-left hover:opacity-80 transition-opacity"
              style={{ borderTop: i > 0 ? "1px solid rgba(14,59,46,0.06)" : "none" }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "#EAF1E5" }}>
                <item.icon className="h-4 w-4" style={{ color: V.primary }} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium" style={{ color: V.ink }}>{item.label}</p>
                <p className="text-xs" style={{ color: V.muted }}>{item.desc}</p>
              </div>
              <ChevronRight className="h-4 w-4" style={{ color: V.sage }} />
            </button>
          ))}
        </div>
      </section>

      <button
        onClick={() => { window.location.href = "/api/logout"; }}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-medium"
        style={{ background: "#FEE2E2", color: "#DC2626" }}>
        <LogOut className="h-4 w-4" /> Sair da conta
      </button>
    </div>
  );
}

/* ── Família tab ──────────────────────────────────────── */
function FamiliaTab() {
  const [showInvite, setShowInvite] = useState(false);
  const [phone, setPhone] = useState("");

  return (
    <div className="space-y-6 py-6">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: V.muted }}>Membros</h2>
          <button onClick={() => setShowInvite(!showInvite)}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full"
            style={{ background: "#EAF1E5", color: V.primary }}>
            <Plus className="h-3.5 w-3.5" /> Convidar
          </button>
        </div>

        {showInvite && (
          <div className="mb-4 p-4 rounded-2xl space-y-3"
            style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.1)" }}>
            <p className="text-sm font-semibold" style={{ color: V.ink }}>Convidar parceiro/a</p>
            <p className="text-xs" style={{ color: V.muted }}>O convite chega no WhatsApp deles.</p>
            <input type="tel" placeholder="+55 11 99999-9999" value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-4 py-3 rounded-xl text-sm border-0 outline-none"
              style={{ background: V.beige, color: V.ink }} />
            <div className="flex gap-2">
              <button onClick={() => setShowInvite(false)}
                className="flex-1 py-2.5 rounded-full text-xs font-semibold"
                style={{ background: V.beige, color: V.ink }}>
                Cancelar
              </button>
              <button className="flex-1 py-2.5 rounded-full text-xs font-semibold text-white"
                style={{ background: "#25D366" }}>
                Enviar pelo WhatsApp
              </button>
            </div>
          </div>
        )}

        <div className="rounded-3xl overflow-hidden" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
          <div className="flex items-center gap-4 px-5 py-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm"
              style={{ background: V.primary }}>V</div>
            <div className="flex-1">
              <p className="text-sm font-semibold" style={{ color: V.ink }}>Você</p>
              <p className="text-xs" style={{ color: V.muted }}>Administrador</p>
            </div>
          </div>
          <div className="flex items-center gap-4 px-5 py-4 opacity-50 cursor-not-allowed"
            style={{ borderTop: "1px solid rgba(14,59,46,0.06)" }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center border-2 border-dashed"
              style={{ borderColor: V.sage }}>
              <Users className="h-4 w-4" style={{ color: V.sage }} />
            </div>
            <div>
              <p className="text-sm" style={{ color: V.muted }}>Aguardando parceiro/a</p>
              <p className="text-xs" style={{ color: V.muted }}>Convite não enviado ainda</p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: V.muted }}>Crianças</h2>
        <button className="w-full flex items-center gap-4 p-4 rounded-3xl border-2 border-dashed hover:opacity-80 transition-opacity"
          style={{ borderColor: V.beige }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: V.beige }}>
            <Baby className="h-5 w-5" style={{ color: V.sage }} />
          </div>
          <div className="text-left">
            <p className="text-sm font-medium" style={{ color: V.ink }}>Adicionar criança</p>
            <p className="text-xs" style={{ color: V.muted }}>Nome, escola e ano</p>
          </div>
          <Plus className="h-4 w-4 ml-auto" style={{ color: V.sage }} />
        </button>
      </section>
    </div>
  );
}

/* ── Diarista tab ──────────────────────────────────────── */
function DiaristaTab() {
  const [step, setStep] = useState<"idle" | "form" | "pending" | "consented">("idle");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [days, setDays] = useState<string[]>([]);

  const weekDays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  function toggleDay(d: string) {
    setDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
  }

  if (step === "consented") return (
    <div className="py-10 text-center space-y-4">
      <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center" style={{ background: "#D1FAE5" }}>
        <CheckCircle className="h-8 w-8" style={{ color: "#065F46" }} />
      </div>
      <p className="font-semibold" style={{ color: V.ink }}>{name} aceitou ✓</p>
      <p className="text-sm" style={{ color: V.muted }}>Pronto para coordenar via WhatsApp.</p>
      <div className="p-4 rounded-2xl text-left space-y-1" style={{ background: V.cream }}>
        <p className="text-xs font-semibold" style={{ color: V.muted }}>Dias configurados</p>
        <p className="text-sm" style={{ color: V.ink }}>{days.join(", ") || "—"}</p>
      </div>
    </div>
  );

  if (step === "pending") return (
    <div className="py-6 space-y-4">
      <div className="p-5 rounded-3xl text-center" style={{ background: V.cream }}>
        <Clock className="h-10 w-10 mx-auto mb-3" style={{ color: V.sage }} />
        <p className="font-semibold mb-1" style={{ color: V.ink }}>Aguardando resposta de {name}</p>
        <p className="text-sm" style={{ color: V.muted }}>Enviamos consentimento para {phone}.</p>
        <p className="text-xs mt-2" style={{ color: V.muted }}>Expira em 7 dias se não houver resposta.</p>
      </div>
      <div className="p-4 rounded-2xl" style={{ background: "#FEF3C7", border: "1px solid rgba(245,158,11,0.2)" }}>
        <div className="flex gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "#D97706" }} />
          <p className="text-xs" style={{ color: "#92400E" }}>
            O Piloto não envia mensagens para {name} enquanto ela não aceitar. Exigência da LGPD.
          </p>
        </div>
      </div>
      <button onClick={() => setStep("idle")} className="w-full py-3 rounded-full text-sm" style={{ color: V.muted }}>
        Cancelar
      </button>
    </div>
  );

  if (step === "form") return (
    <div className="space-y-5 py-4">
      <div>
        <h3 className="font-semibold mb-1" style={{ color: V.ink }}>Adicionar diarista</h3>
        <p className="text-xs" style={{ color: V.muted }}>Vamos pedir a permissão dela antes de começar.</p>
      </div>
      <input type="text" placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)}
        className="w-full px-4 py-3.5 rounded-2xl text-sm border-0 outline-none"
        style={{ background: V.cream, color: V.ink }} />
      <input type="tel" placeholder="WhatsApp (+55 21 99XXX-XXXX)" value={phone} onChange={(e) => setPhone(e.target.value)}
        className="w-full px-4 py-3.5 rounded-2xl text-sm border-0 outline-none"
        style={{ background: V.cream, color: V.ink }} />
      <div>
        <p className="text-sm font-medium mb-2" style={{ color: V.ink }}>Dias que vem</p>
        <div className="flex gap-1.5">
          {weekDays.map((d) => (
            <button key={d} onClick={() => toggleDay(d)}
              className="flex-1 py-2 rounded-xl text-xs font-semibold transition-colors"
              style={{ background: days.includes(d) ? V.primary : V.beige, color: days.includes(d) ? "white" : V.ink }}>
              {d}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4 rounded-2xl" style={{ background: "#EFF6FF", border: "1px solid rgba(59,130,246,0.15)" }}>
        <p className="text-xs" style={{ color: "#1E40AF" }}>
          Antes de começar, vamos pedir permissão de {name || "sua diarista"}. Ela pode aceitar ou recusar. Exigência da LGPD.
        </p>
      </div>
      <div className="flex gap-3">
        <button onClick={() => setStep("idle")} className="px-5 py-3 rounded-full text-sm" style={{ background: V.beige, color: V.ink }}>
          Cancelar
        </button>
        <button onClick={() => { if (name && phone) setStep("pending"); }}
          disabled={!name || !phone}
          className="flex-1 py-3 rounded-full text-sm font-semibold text-white disabled:opacity-40"
          style={{ background: V.primary }}>
          Pedir permissão a {name || "ela"} →
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-5 py-6">
      <div className="p-5 rounded-3xl" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
        <div className="flex items-start gap-3">
          <Heart className="h-5 w-5 shrink-0 mt-0.5" style={{ color: V.primary }} />
          <div>
            <p className="font-semibold mb-1" style={{ color: V.ink }}>Coordenação com diarista</p>
            <p className="text-sm" style={{ color: V.muted }}>O Piloto monta e envia o briefing de tarefas antes de ela chegar — com sua aprovação.</p>
          </div>
        </div>
      </div>
      <ul className="space-y-2">
        {["Lista de tarefas no dia que ela vem", "Avisos quando tiver mudança de planos", "Consentimento LGPD garantido"].map((item) => (
          <li key={item} className="flex items-center gap-2 text-sm px-1" style={{ color: V.muted }}>
            <CheckCircle className="h-4 w-4 shrink-0" style={{ color: V.primary }} />
            {item}
          </li>
        ))}
      </ul>
      <button onClick={() => setStep("form")}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-full text-sm font-semibold text-white"
        style={{ background: V.primary }}>
        <Plus className="h-4 w-4" /> Adicionar diarista
      </button>
    </div>
  );
}

/* ── Privacidade tab ──────────────────────────────────── */
function PrivacidadeTab() {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const DELETE_PHRASE = "Eu entendo que todos os meus dados serão permanentemente apagados";

  return (
    <div className="space-y-6 py-6">
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: V.muted }}>O que a Vesta guarda</h2>
        <div className="rounded-3xl overflow-hidden" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
          {[
            { label: "Mensagens recebidas",          value: "90 dias" },
            { label: "Regras e memória da casa",     value: "Enquanto você usar" },
            { label: "Tarefas e eventos aprovados",  value: "Enquanto você usar" },
            { label: "Registros de auditoria",       value: "Anonimizados" },
          ].map((item, i) => (
            <div key={item.label} className="flex items-center gap-3 px-5 py-3.5"
              style={{ borderTop: i > 0 ? "1px solid rgba(14,59,46,0.06)" : "none" }}>
              <Lock className="h-4 w-4 shrink-0" style={{ color: V.sage }} />
              <p className="flex-1 text-sm" style={{ color: V.ink }}>{item.label}</p>
              <span className="text-xs" style={{ color: V.muted }}>{item.value}</span>
            </div>
          ))}
        </div>
        <p className="text-xs mt-2 px-1" style={{ color: V.muted }}>
          Seus dados nunca são vendidos. Compartilhamos só com: Twilio (WhatsApp), Anthropic/OpenAI (classificação), Stripe (pagamentos).
        </p>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: V.muted }}>Seus direitos (LGPD)</h2>
        <div className="rounded-3xl overflow-hidden" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
          {[
            { icon: CheckCircle,  label: "Ver todos os seus dados",        desc: "Exportar em JSON" },
            { icon: ShieldCheck,  label: "Corrigir informações",           desc: "Edite qualquer dado" },
            { icon: Key,          label: "Política de privacidade",        desc: "Em linguagem simples" },
          ].map((item, i) => (
            <button key={item.label} className="w-full flex items-center gap-4 px-5 py-4 text-left hover:opacity-80 transition-opacity"
              style={{ borderTop: i > 0 ? "1px solid rgba(14,59,46,0.06)" : "none" }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "#EAF1E5" }}>
                <item.icon className="h-4 w-4" style={{ color: V.primary }} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium" style={{ color: V.ink }}>{item.label}</p>
                <p className="text-xs" style={{ color: V.muted }}>{item.desc}</p>
              </div>
              <ChevronRight className="h-4 w-4" style={{ color: V.sage }} />
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#DC2626" }}>Zona de perigo</h2>
        <div className="rounded-3xl overflow-hidden"
          style={{ background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.15)" }}>
          <button onClick={() => setShowDeleteConfirm(true)}
            className="w-full flex items-center gap-4 px-5 py-4 text-left hover:opacity-80 transition-opacity">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "#FEE2E2" }}>
              <Trash2 className="h-4 w-4" style={{ color: "#DC2626" }} />
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: "#DC2626" }}>Excluir todos os dados</p>
              <p className="text-xs" style={{ color: "#EF4444" }}>Irreversível — exclui tudo</p>
            </div>
          </button>
        </div>
      </section>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setShowDeleteConfirm(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full rounded-t-3xl p-6 space-y-4"
            style={{ background: "white" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-semibold" style={{ color: "#DC2626" }}>Excluir conta e dados</p>
              <button onClick={() => setShowDeleteConfirm(false)}>
                <X className="h-5 w-5" style={{ color: V.muted }} />
              </button>
            </div>
            <p className="text-sm" style={{ color: V.muted }}>
              Isso apagará permanentemente: perfis, tarefas, eventos, regras, contatos, memória da casa e tokens OAuth. Não é possível desfazer.
            </p>
            <div>
              <p className="text-xs mb-1 font-medium" style={{ color: V.ink }}>Digite para confirmar:</p>
              <p className="text-xs italic mb-2" style={{ color: V.muted }}>"{DELETE_PHRASE}"</p>
              <textarea value={deleteInput} onChange={(e) => setDeleteInput(e.target.value)} rows={3}
                className="w-full px-4 py-3 rounded-xl text-sm border-0 outline-none resize-none"
                style={{ background: "#FEE2E2", color: V.ink }}
                placeholder="Digite a frase acima..." />
            </div>
            <button disabled={deleteInput !== DELETE_PHRASE}
              className="w-full py-3.5 rounded-full text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: "#DC2626" }}>
              Excluir permanentemente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Page root ──────────────────────────────────────────── */
export default function CasaPage() {
  const [activeTab, setActiveTab] = useState<Tab>("inicio");

  return (
    <div className="min-h-screen" style={{ background: V.ivory }}>
      <div className="px-5 pt-6 pb-3">
        <h1 className="font-serif text-3xl font-semibold" style={{ color: V.ink }}>Casa</h1>
        <p className="text-sm mt-1" style={{ color: V.muted }}>Família, diarista e privacidade.</p>
      </div>
      <div className="px-5">
        <TabBar active={activeTab} onChange={setActiveTab} />
        {activeTab === "inicio"      && <InicioTab />}
        {activeTab === "familia"     && <FamiliaTab />}
        {activeTab === "diarista"    && <DiaristaTab />}
        {activeTab === "privacidade" && <PrivacidadeTab />}
      </div>
    </div>
  );
}
