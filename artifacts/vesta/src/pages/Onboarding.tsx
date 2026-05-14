import { useState } from "react";
import { useLocation } from "wouter";
import { Home, ChevronRight, ChevronLeft, Check, Users, Baby, Heart, BookOpen, Stethoscope, MessageCircle, Calendar, Sparkles, X } from "lucide-react";

const V = {
  primary: "#0E3B2E",
  sage: "#6F856F",
  ivory: "#F7F4EA",
  cream: "#FFFDF6",
  ink: "#12231C",
  muted: "#5F6B61",
  beige: "#EEE6D6",
};

type Composition = { adults: number; children: number; others: number };

interface StepProps {
  onNext: (data?: Record<string, unknown>) => void;
  onBack: () => void;
  data: Record<string, unknown>;
}

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex gap-1 mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="h-1 flex-1 rounded-full transition-all duration-300"
          style={{ background: i < step ? V.primary : V.beige }}
        />
      ))}
    </div>
  );
}

function Step0Welcome({ onNext }: StepProps) {
  return (
    <div className="flex flex-col items-center text-center gap-6 pt-8">
      <div className="w-20 h-20 rounded-3xl flex items-center justify-center" style={{ background: V.primary }}>
        <Home className="h-10 w-10 text-white" strokeWidth={1.5} />
      </div>
      <div>
        <h1 className="font-serif text-4xl font-semibold mb-3" style={{ color: V.ink }}>Bem-vinda ao Piloto</h1>
        <p className="text-base leading-relaxed" style={{ color: V.muted }}>
          Seu assistente familiar que cuida da logística da casa para você poder cuidar do que importa.
        </p>
      </div>
      <div className="w-full space-y-3 text-left mt-4">
        {[
          "Organiza mensagens da escola e saúde automaticamente",
          "Coordena agenda com seu parceiro/a",
          "Avisa pelo WhatsApp — sem precisar abrir o app",
        ].map((item) => (
          <div key={item} className="flex items-start gap-3 p-4 rounded-2xl" style={{ background: V.cream }}>
            <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: V.primary }} />
            <span className="text-sm" style={{ color: V.ink }}>{item}</span>
          </div>
        ))}
      </div>
      <button
        onClick={() => onNext()}
        className="w-full py-4 rounded-full text-base font-semibold text-white transition-opacity hover:opacity-90 mt-4"
        style={{ background: V.primary }}
      >
        Começar →
      </button>
      <p className="text-xs" style={{ color: V.muted }}>Leva ~2 minutos</p>
    </div>
  );
}

function Step1AboutYou({ onNext, onBack }: StepProps) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const roles = [
    { value: "mae", label: "Mãe" },
    { value: "pai", label: "Pai" },
    { value: "responsavel", label: "Responsável" },
    { value: "sozinha", label: "Sozinha" },
    { value: "sozinho", label: "Sozinho" },
  ];
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-3xl font-semibold mb-2" style={{ color: V.ink }}>Sobre você</h2>
        <p className="text-sm" style={{ color: V.muted }}>Como você quer ser chamada/o?</p>
      </div>
      <div>
        <input
          type="text"
          placeholder="Seu nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-5 py-4 rounded-2xl text-base border-0 outline-none"
          style={{ background: V.cream, color: V.ink }}
        />
      </div>
      <div>
        <p className="text-sm font-medium mb-3" style={{ color: V.ink }}>Seu papel na família</p>
        <div className="flex flex-wrap gap-2">
          {roles.map((r) => (
            <button
              key={r.value}
              onClick={() => setRole(r.value)}
              className="px-4 py-2.5 rounded-full text-sm font-medium transition-colors"
              style={{
                background: role === r.value ? V.primary : V.cream,
                color: role === r.value ? "white" : V.ink,
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-3 pt-4">
        <button onClick={onBack} className="px-6 py-3.5 rounded-full text-sm font-medium" style={{ background: V.beige, color: V.ink }}>
          <ChevronLeft className="h-4 w-4 inline" /> Voltar
        </button>
        <button
          onClick={() => onNext({ name, role })}
          disabled={!name.trim()}
          className="flex-1 py-3.5 rounded-full text-sm font-semibold text-white transition-opacity disabled:opacity-40"
          style={{ background: V.primary }}
        >
          Continuar <ChevronRight className="h-4 w-4 inline" />
        </button>
      </div>
    </div>
  );
}

function Step2Composition({ onNext, onBack }: StepProps) {
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(1);
  const [others, setOthers] = useState(0);

  const Counter = ({ label, icon: Icon, value, onChange }: { label: string; icon: React.ElementType; value: number; onChange: (v: number) => void }) => (
    <div className="flex items-center justify-between p-4 rounded-2xl" style={{ background: V.cream }}>
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5" style={{ color: V.primary }} />
        <span className="text-sm font-medium" style={{ color: V.ink }}>{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => onChange(Math.max(0, value - 1))} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: V.beige }}>
          <span className="text-base font-bold" style={{ color: V.ink }}>−</span>
        </button>
        <span className="w-6 text-center font-semibold" style={{ color: V.ink }}>{value}</span>
        <button onClick={() => onChange(value + 1)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: V.primary }}>
          <span className="text-base font-bold text-white">+</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-3xl font-semibold mb-2" style={{ color: V.ink }}>Composição da casa</h2>
        <p className="text-sm" style={{ color: V.muted }}>Quem mora com você?</p>
      </div>
      <div className="space-y-3">
        <Counter label="Adultos (incluindo você)" icon={Users} value={adults} onChange={setAdults} />
        <Counter label="Crianças" icon={Baby} value={children} onChange={setChildren} />
        <Counter label="Outros (idosos, pets)" icon={Heart} value={others} onChange={setOthers} />
      </div>
      <div className="flex gap-3 pt-4">
        <button onClick={onBack} className="px-6 py-3.5 rounded-full text-sm font-medium" style={{ background: V.beige, color: V.ink }}>
          <ChevronLeft className="h-4 w-4 inline" /> Voltar
        </button>
        <button
          onClick={() => onNext({ composition: { adults, children, others } })}
          className="flex-1 py-3.5 rounded-full text-sm font-semibold text-white"
          style={{ background: V.primary }}
        >
          Continuar <ChevronRight className="h-4 w-4 inline" />
        </button>
      </div>
    </div>
  );
}

function Step3Kids({ onNext, onBack, data }: StepProps) {
  const composition = data.composition as Composition | undefined;
  const count = composition?.children ?? 0;
  const [kids, setKids] = useState<Array<{ name: string; school: string; grade: string }>>(
    Array.from({ length: count }, () => ({ name: "", school: "", grade: "" }))
  );

  if (count === 0) {
    onNext({});
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-3xl font-semibold mb-2" style={{ color: V.ink }}>Perfil das crianças</h2>
        <p className="text-sm" style={{ color: V.muted }}>Assim eu organizo melhor as mensagens da escola.</p>
      </div>
      <div className="space-y-4">
        {kids.map((kid, i) => (
          <div key={i} className="p-4 rounded-3xl space-y-3" style={{ background: V.cream }}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: V.muted }}>Criança {i + 1}</p>
            <input
              type="text"
              placeholder="Nome"
              value={kid.name}
              onChange={(e) => setKids(kids.map((k, j) => j === i ? { ...k, name: e.target.value } : k))}
              className="w-full px-4 py-3 rounded-xl text-sm border-0 outline-none"
              style={{ background: "#EEE6D6", color: V.ink }}
            />
            <input
              type="text"
              placeholder="Escola (opcional)"
              value={kid.school}
              onChange={(e) => setKids(kids.map((k, j) => j === i ? { ...k, school: e.target.value } : k))}
              className="w-full px-4 py-3 rounded-xl text-sm border-0 outline-none"
              style={{ background: "#EEE6D6", color: V.ink }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-3 pt-2">
        <button onClick={onBack} className="px-6 py-3.5 rounded-full text-sm font-medium" style={{ background: V.beige, color: V.ink }}>
          <ChevronLeft className="h-4 w-4 inline" /> Voltar
        </button>
        <button onClick={() => onNext({ kids })} className="flex-1 py-3.5 rounded-full text-sm font-semibold text-white" style={{ background: V.primary }}>
          Continuar <ChevronRight className="h-4 w-4 inline" />
        </button>
      </div>
    </div>
  );
}

function Step4PainPoints({ onNext, onBack }: StepProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const options = [
    { value: "casa", label: "Coordenar a casa", icon: Home, desc: "Limpeza, serviços, rotina" },
    { value: "saude", label: "Saúde da família", icon: Stethoscope, desc: "Consultas, medicamentos" },
    { value: "escola", label: "Vida das crianças", icon: BookOpen, desc: "Escola, atividades" },
    { value: "logistica", label: "Logística de pickup", icon: Users, desc: "Quem busca quem, quando" },
    { value: "parceiro", label: "Coordenar com parceiro", icon: Heart, desc: "Dividir tarefas e agenda" },
  ];

  function toggle(value: string) {
    setSelected((s) => s.includes(value) ? s.filter((v) => v !== value) : [...s, value]);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-3xl font-semibold mb-2" style={{ color: V.ink }}>Por onde começar?</h2>
        <p className="text-sm" style={{ color: V.muted }}>Selecione o que mais te sobrecarrega. Pode escolher vários.</p>
      </div>
      <div className="space-y-2">
        {options.map(({ value, label, icon: Icon, desc }) => {
          const active = selected.includes(value);
          return (
            <button
              key={value}
              onClick={() => toggle(value)}
              className="w-full flex items-center gap-4 p-4 rounded-2xl text-left transition-colors"
              style={{
                background: active ? "#EAF1E5" : V.cream,
                border: `2px solid ${active ? V.primary : "transparent"}`,
              }}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: active ? V.primary : V.beige }}>
                <Icon className="h-5 w-5" style={{ color: active ? "white" : V.ink }} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: V.ink }}>{label}</p>
                <p className="text-xs" style={{ color: V.muted }}>{desc}</p>
              </div>
              {active && <Check className="h-4 w-4 ml-auto shrink-0" style={{ color: V.primary }} />}
            </button>
          );
        })}
      </div>
      <div className="flex gap-3 pt-2">
        <button onClick={onBack} className="px-6 py-3.5 rounded-full text-sm font-medium" style={{ background: V.beige, color: V.ink }}>
          <ChevronLeft className="h-4 w-4 inline" /> Voltar
        </button>
        <button onClick={() => onNext({ painPoints: selected })} className="flex-1 py-3.5 rounded-full text-sm font-semibold text-white" style={{ background: V.primary }}>
          {selected.length === 0 ? "Pular" : "Continuar"} <ChevronRight className="h-4 w-4 inline" />
        </button>
      </div>
    </div>
  );
}

function Step5WhatsApp({ onNext, onBack }: StepProps) {
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "#25D366" }}>
          <MessageCircle className="h-6 w-6 text-white" />
        </div>
        <div>
          <h2 className="font-serif text-2xl font-semibold" style={{ color: V.ink }}>WhatsApp</h2>
          <p className="text-xs" style={{ color: V.muted }}>Onde tudo acontece</p>
        </div>
      </div>
      <div className="p-5 rounded-3xl space-y-4" style={{ background: V.cream }}>
        <p className="text-sm" style={{ color: V.ink }}>
          O Piloto funciona principalmente pelo WhatsApp. Você encaminha mensagens, ele cuida do resto.
        </p>
        <ul className="space-y-2">
          {[
            "Encaminhe mensagens da escola",
            "Receba resumos diários às 7h",
            "Aprove ações com um toque",
          ].map((item) => (
            <li key={item} className="flex items-center gap-2 text-sm" style={{ color: V.muted }}>
              <Check className="h-3.5 w-3.5 shrink-0" style={{ color: V.primary }} />
              {item}
            </li>
          ))}
        </ul>
      </div>
      {!sent ? (
        <div className="space-y-3">
          <p className="text-sm font-medium" style={{ color: V.ink }}>Seu número de WhatsApp</p>
          <input
            type="tel"
            placeholder="+55 11 99999-9999"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full px-5 py-4 rounded-2xl text-base border-0 outline-none"
            style={{ background: V.cream, color: V.ink }}
          />
          <button
            onClick={() => setSent(true)}
            disabled={!phone.trim()}
            className="w-full py-4 rounded-full text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: "#25D366" }}
          >
            Enviar código de verificação →
          </button>
        </div>
      ) : (
        <div className="p-4 rounded-2xl text-center space-y-2" style={{ background: "#D1FAE5" }}>
          <Check className="h-8 w-8 mx-auto" style={{ color: "#065F46" }} />
          <p className="text-sm font-semibold" style={{ color: "#065F46" }}>Enviamos uma mensagem para {phone}</p>
          <p className="text-xs" style={{ color: "#047857" }}>Responda "OI" para verificar</p>
        </div>
      )}
      <div className="flex gap-3">
        <button onClick={onBack} className="px-6 py-3.5 rounded-full text-sm font-medium" style={{ background: V.beige, color: V.ink }}>
          <ChevronLeft className="h-4 w-4 inline" /> Voltar
        </button>
        <button onClick={() => onNext({ phone, whatsapp_verified: sent })} className="flex-1 py-3.5 rounded-full text-sm font-semibold text-white" style={{ background: V.primary }}>
          {sent ? "Confirmado ✓" : "Pular por agora"} <ChevronRight className="h-4 w-4 inline" />
        </button>
      </div>
    </div>
  );
}

function Step6Calendar({ onNext, onBack }: StepProps) {
  const [connected, setConnected] = useState(false);
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "#4285F4" }}>
          <Calendar className="h-6 w-6 text-white" />
        </div>
        <div>
          <h2 className="font-serif text-2xl font-semibold" style={{ color: V.ink }}>Calendário</h2>
          <p className="text-xs" style={{ color: V.muted }}>Opcional</p>
        </div>
      </div>
      <p className="text-sm" style={{ color: V.muted }}>
        Conecte seu Google Agenda para que o Piloto crie eventos automaticamente após você aprovar.
      </p>
      {!connected ? (
        <button
          onClick={() => setConnected(true)}
          className="w-full flex items-center justify-center gap-3 py-4 rounded-full text-sm font-semibold border-2 transition-colors"
          style={{ borderColor: "#4285F4", color: "#4285F4", background: "white" }}
        >
          <Calendar className="h-4 w-4" />
          Conectar Google Agenda
        </button>
      ) : (
        <div className="p-4 rounded-2xl text-center" style={{ background: "#DBEAFE" }}>
          <p className="text-sm font-semibold" style={{ color: "#1E40AF" }}>Google Agenda conectado ✓</p>
        </div>
      )}
      <div className="flex gap-3">
        <button onClick={onBack} className="px-6 py-3.5 rounded-full text-sm font-medium" style={{ background: V.beige, color: V.ink }}>
          <ChevronLeft className="h-4 w-4 inline" /> Voltar
        </button>
        <button onClick={() => onNext({ calendar_connected: connected })} className="flex-1 py-3.5 rounded-full text-sm font-semibold text-white" style={{ background: V.primary }}>
          {connected ? "Continuar" : "Pular"} <ChevronRight className="h-4 w-4 inline" />
        </button>
      </div>
    </div>
  );
}

function Step7Ready({ onNext }: StepProps) {
  return (
    <div className="flex flex-col items-center text-center gap-6 pt-4">
      <div className="w-24 h-24 rounded-full flex items-center justify-center" style={{ background: "#EAF1E5" }}>
        <Sparkles className="h-12 w-12" style={{ color: V.primary }} />
      </div>
      <div>
        <h2 className="font-serif text-3xl font-semibold mb-3" style={{ color: V.ink }}>Tudo pronto!</h2>
        <p className="text-base" style={{ color: V.muted }}>
          Encaminhe sua primeira mensagem no WhatsApp para começar. O Piloto cuida do resto.
        </p>
      </div>
      <div className="w-full p-5 rounded-3xl text-left" style={{ background: V.cream }}>
        <p className="text-sm font-semibold mb-3" style={{ color: V.ink }}>Primeiro passo:</p>
        <p className="text-sm" style={{ color: V.muted }}>
          Abra o WhatsApp → encontre uma mensagem da escola ou saúde → toque em "Encaminhar" → mande para o Piloto
        </p>
      </div>
      <button
        onClick={() => onNext()}
        className="w-full py-4 rounded-full text-base font-semibold text-white mt-2"
        style={{ background: V.primary }}
      >
        Abrir meu painel →
      </button>
    </div>
  );
}

const STEPS = [
  { component: Step0Welcome, title: "" },
  { component: Step1AboutYou, title: "Sobre você" },
  { component: Step2Composition, title: "Sua casa" },
  { component: Step3Kids, title: "Crianças" },
  { component: Step4PainPoints, title: "Prioridades" },
  { component: Step5WhatsApp, title: "WhatsApp" },
  { component: Step6Calendar, title: "Calendário" },
  { component: Step7Ready, title: "Pronto!" },
];

export default function OnboardingPage() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  function handleNext(data?: Record<string, unknown>) {
    const merged = { ...formData, ...data };
    setFormData(merged);
    if (step >= STEPS.length - 1) {
      navigate("/app");
    } else {
      setStep((s) => s + 1);
    }
  }

  function handleBack() {
    if (step > 0) setStep((s) => s - 1);
  }

  const StepComponent = STEPS[step].component;
  const showProgress = step > 0 && step < STEPS.length - 1;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: V.ivory }}>
      <header className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: V.primary }}>
            <Home className="h-4 w-4 text-white" strokeWidth={1.8} />
          </div>
          <span className="text-lg font-semibold tracking-tight" style={{ color: V.ink }}>vesta</span>
        </div>
        {step > 0 && (
          <button onClick={() => navigate("/app")} style={{ color: V.muted }}>
            <X className="h-5 w-5" />
          </button>
        )}
      </header>

      <div className="flex-1 px-5 pb-8 max-w-md mx-auto w-full">
        {showProgress && <ProgressBar step={step} total={STEPS.length - 2} />}
        <StepComponent onNext={handleNext} onBack={handleBack} data={formData} />
      </div>
    </div>
  );
}
