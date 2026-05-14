import { getCategoryMeta } from "@/lib/categories";

export default function CategoryBadge({ category, className = "" }: { category: string; className?: string }) {
  const meta = getCategoryMeta(category);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${meta.color} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}
