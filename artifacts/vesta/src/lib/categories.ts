export const CATEGORIES = [
  { id: "escola",    label: "Escola",    color: "bg-blue-100 text-blue-700",       dot: "bg-blue-500" },
  { id: "saude",     label: "Saúde",     color: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
  { id: "casa",      label: "Casa",      color: "bg-amber-100 text-amber-700",     dot: "bg-amber-500" },
  { id: "social",    label: "Social",    color: "bg-rose-100 text-rose-700",       dot: "bg-rose-500" },
  { id: "logistica", label: "Logística", color: "bg-violet-100 text-violet-700",   dot: "bg-violet-500" },
  { id: "refeicoes", label: "Refeições", color: "bg-orange-100 text-orange-700",   dot: "bg-orange-500" },
  { id: "servicos",  label: "Serviços",  color: "bg-slate-100 text-slate-600",     dot: "bg-slate-400" },
  { id: "outros",    label: "Outros",    color: "bg-stone-100 text-stone-600",     dot: "bg-stone-400" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export function getCategoryMeta(id: string) {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];
}
