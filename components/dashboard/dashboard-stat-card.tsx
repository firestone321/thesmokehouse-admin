import { DashboardStat } from "@/lib/dashboard/types";

interface DashboardStatCardProps {
  stat: DashboardStat;
}

const toneClasses: Record<DashboardStat["tone"], string> = {
  neutral: "border-line bg-parchment text-ink",
  accent: "border-ember/20 bg-[#fff3ea] text-ink",
  success: "border-moss/20 bg-[#f2f8ef] text-ink"
};

export function DashboardStatCard({ stat }: DashboardStatCardProps) {
  return (
    <article className={`surface-card rounded-3xl p-5 ${toneClasses[stat.tone]}`}>
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">{stat.label}</p>
      <p className="font-display pt-4 text-3xl text-walnut">{stat.value}</p>
      <p className="pt-3 text-sm leading-6 text-stone-600">{stat.supportingText}</p>
    </article>
  );
}
