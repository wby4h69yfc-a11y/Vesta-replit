import { Home, Shield, Zap, Users } from "lucide-react";

const V = {
  primary: "#0E3B2E",
  sage: "#6F856F",
  ivory: "#F7F4EA",
  cream: "#FFFDF6",
  ink: "#12231C",
  muted: "#5F6B61",
  beige: "#EEE6D6",
};

const features = [
  {
    icon: Zap,
    title: "Logística automática",
    desc: "Mensagens da escola, saúde e diarista organizadas pelo WhatsApp",
  },
  {
    icon: Users,
    title: "Toda a família sincronizada",
    desc: "Parceiro, filhos, diarista — cada um vê só o que precisa",
  },
  {
    icon: Shield,
    title: "Privacidade por padrão",
    desc: "Dados da sua família ficam na sua conta. LGPD compliant.",
  },
];

export default function LoginPage() {
  function handleLogin() {
    window.location.href = "/api/login?returnTo=/app";
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-12"
      style={{ background: V.ivory }}
    >
      <div className="w-full max-w-sm flex flex-col items-center gap-10">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-sm"
            style={{ background: V.primary }}
          >
            <Home className="h-8 w-8 text-white" strokeWidth={1.5} />
          </div>
          <div className="text-center">
            <h1
              className="text-3xl font-semibold tracking-tight"
              style={{ color: V.ink }}
            >
              vesta
            </h1>
            <p className="text-sm mt-1" style={{ color: V.muted }}>
              O sistema operacional da sua família
            </p>
          </div>
        </div>

        {/* Hero line */}
        <div className="text-center">
          <h2
            className="font-serif text-2xl font-semibold leading-snug"
            style={{ color: V.ink }}
          >
            Menos caos, mais presença
          </h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: V.muted }}>
            Organize a logística da casa para você poder cuidar do que realmente importa.
          </p>
        </div>

        {/* Features */}
        <div className="w-full space-y-3">
          {features.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="flex items-start gap-4 p-4 rounded-2xl"
              style={{ background: V.cream }}
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: V.beige }}
              >
                <Icon className="h-4 w-4" style={{ color: V.primary }} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: V.ink }}>
                  {title}
                </p>
                <p className="text-xs mt-0.5 leading-relaxed" style={{ color: V.muted }}>
                  {desc}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="w-full space-y-3">
          <button
            onClick={handleLogin}
            className="w-full py-4 rounded-full text-base font-semibold text-white transition-opacity hover:opacity-90 active:opacity-80"
            style={{ background: V.primary }}
          >
            Entrar / Criar conta grátis
          </button>
          <p className="text-center text-xs" style={{ color: V.muted }}>
            Leva menos de 2 minutos para configurar
          </p>
        </div>

        {/* Fine print */}
        <p className="text-center text-xs leading-relaxed" style={{ color: V.muted }}>
          Ao entrar você concorda com nossos{" "}
          <span
            className="underline cursor-pointer"
            style={{ color: V.sage }}
          >
            Termos de Uso
          </span>{" "}
          e{" "}
          <span
            className="underline cursor-pointer"
            style={{ color: V.sage }}
          >
            Política de Privacidade
          </span>
          .
        </p>
      </div>
    </div>
  );
}
