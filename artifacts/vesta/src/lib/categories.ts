export const CATEGORIES = [
  { id: "escola",      label: "Escola",      color: "bg-blue-100 text-blue-700",       dot: "bg-blue-500" },
  { id: "saude",       label: "Saúde",       color: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
  { id: "casa",        label: "Casa",        color: "bg-amber-100 text-amber-700",     dot: "bg-amber-500" },
  { id: "financeiro",  label: "Financeiro",  color: "bg-yellow-100 text-yellow-700",   dot: "bg-yellow-500" },
  { id: "compras",     label: "Compras",     color: "bg-orange-100 text-orange-700",   dot: "bg-orange-500" },
  { id: "familia",     label: "Família",     color: "bg-rose-100 text-rose-700",       dot: "bg-rose-500" },
  { id: "pets",        label: "Pets",        color: "bg-lime-100 text-lime-700",       dot: "bg-lime-500" },
  { id: "viagem",      label: "Viagem",      color: "bg-sky-100 text-sky-700",         dot: "bg-sky-500" },
  { id: "manutencao",  label: "Manutenção",  color: "bg-slate-100 text-slate-600",     dot: "bg-slate-400" },
  /* legacy ids kept for existing data */
  { id: "social",      label: "Social",      color: "bg-rose-100 text-rose-700",       dot: "bg-rose-500" },
  { id: "logistica",   label: "Logística",   color: "bg-sky-100 text-sky-700",         dot: "bg-sky-500" },
  { id: "refeicoes",   label: "Refeições",   color: "bg-orange-100 text-orange-700",   dot: "bg-orange-500" },
  { id: "servicos",    label: "Serviços",    color: "bg-slate-100 text-slate-600",     dot: "bg-slate-400" },
  { id: "outros",      label: "Outros",      color: "bg-stone-100 text-stone-600",     dot: "bg-stone-400" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export function getCategoryMeta(id: string) {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];
}
