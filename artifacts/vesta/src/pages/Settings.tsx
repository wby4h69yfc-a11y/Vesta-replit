import { Shield, Bell, Users, Key, Trash2, ChevronRight, Lock } from "lucide-react";
import { useGetHousehold } from "@workspace/api-client-react";

import { V } from "@/lib/brand";

const SECTIONS = [
  {
    title: "Privacidade e dados",
    items: [
      { icon: <Shield className="h-5 w-5" />,  label: "Controle de dados",       desc: "Gerencie o que a Vesta armazena" },
      { icon: <Lock className="h-5 w-5" />,    label: "Permissões de acesso",    desc: "Quem pode ver o quê na sua casa" },
      { icon: <Key className="h-5 w-5" />,     label: "Segurança da conta",      desc: "Senha e autenticação" },
    ],
  },
  {
    title: "Notificações",
    items: [
      { icon: <Bell className="h-5 w-5" />,    label: "WhatsApp",                desc: "Resumos e aprovações via WhatsApp" },
      { icon: <Bell className="h-5 w-5" />,    label: "Push",                    desc: "Alertas do aplicativo" },
    ],
  },
  {
    title: "Família",
    items: [
      { icon: <Users className="h-5 w-5" />,   label: "Membros e permissões",    desc: "Convide e gerencie acesso" },
    ],
  },
  {
    title: "Zona de perigo",
    danger: true,
    items: [
      { icon: <Trash2 className="h-5 w-5" />,  label: "Excluir todos os dados",  desc: "Irreversível — exclui tudo da sua casa" },
    ],
  },
];

export default function SettingsPage() {
  const { data: household } = useGetHousehold();

  return (
    <div className="px-4 py-6 space-y-7 animate-fade-in-up">
      <div>
        <h1 className="font-serif text-3xl font-semibold" style={{ color: V.ink }}>Configurações</h1>
        <p className="text-sm mt-1" style={{ color: V.muted }}>Privacidade, dados e preferências.</p>
      </div>

      {/* Household card */}
      {household && (
        <div className="rounded-3xl p-5 flex items-center gap-4" style={{ background: V.cream, border: "1px solid rgba(14,59,46,0.08)" }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold text-lg"
            style={{ background: V.primary }}>
            {household.name.charAt(0)}
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: V.ink }}>{household.name}</p>
            {household.location && <p className="text-xs" style={{ color: V.muted }}>{household.location}</p>}
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full mt-1 inline-block"
              style={{ background: household.plan === "premium" ? "#FEF3C7" : "#EAF1E5", color: household.plan === "premium" ? "#92400E" : V.primary }}>
              {household.plan === "premium" ? "Premium" : "Gratuito"}
            </span>
          </div>
        </div>
      )}

      {/* Settings sections */}
      {SECTIONS.map((section) => (
        <section key={section.title}>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: V.muted }}>{section.title}</h2>
          <div className="rounded-3xl overflow-hidden" style={{ background: section.danger ? "#FEF2F2" : V.cream, border: section.danger ? "1px solid rgba(220,38,38,0.15)" : "1px solid rgba(14,59,46,0.08)" }}>
            {section.items.map((item, i) => (
              <button key={item.label} className="w-full flex items-center gap-4 px-5 py-4 text-left hover:opacity-80 transition-opacity"
                style={{ borderTop: i > 0 ? `1px solid ${section.danger ? "rgba(220,38,38,0.08)" : "rgba(14,59,46,0.07)"}` : "none" }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: section.danger ? "#FEE2E2" : "#EAF1E5", color: section.danger ? "#DC2626" : V.primary }}>
                  {item.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: section.danger ? "#DC2626" : V.ink }}>{item.label}</p>
                  <p className="text-xs mt-0.5" style={{ color: V.muted }}>{item.desc}</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0" style={{ color: V.sage }} />
              </button>
            ))}
          </div>
        </section>
      ))}

      <p className="text-center text-xs pb-4" style={{ color: V.muted }}>Vesta © 2026 · Versão 1.0</p>
    </div>
  );
}
