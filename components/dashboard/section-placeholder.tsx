interface SectionPlaceholderProps {
  title: string;
  description: string;
}

export function SectionPlaceholder({ title, description }: SectionPlaceholderProps) {
  return (
    <section className="surface-card rounded-4xl p-8">
      <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Phase 1</p>
      <h1 className="font-display pt-3 text-3xl text-walnut">{title}</h1>
      <p className="max-w-2xl pt-4 text-base leading-7 text-stone-600">{description}</p>
      <div className="mt-6 rounded-3xl bg-sand p-5 text-sm leading-6 text-stone-600">
        This section is scaffolded intentionally so navigation is stable, but it is not yet wired to live operational data or mutations.
      </div>
    </section>
  );
}
