export const PLAN_LIMITS = {
  free: {
    adults: 2,
    children: 1,
    rules: 3,
  },
  premium: {
    adults: Infinity,
    children: Infinity,
    rules: Infinity,
  },
} as const;

export type Plan = keyof typeof PLAN_LIMITS;

export function getPlanLimits(plan: string) {
  if (plan === "premium") return PLAN_LIMITS.premium;
  return PLAN_LIMITS.free;
}
