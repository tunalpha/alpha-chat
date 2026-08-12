import React from 'react';

export default function KpiSection({ dict }: { dict: any }) {
  const d = dict.kpi;
  const items: Array<{ label: string; value: string }> = d?.items ?? [];

  return (
    <section>
      <div className="text-center mb-12 space-y-2">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/5 mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-semibold text-primary tracking-widest uppercase">
            {d?.subtitle ?? 'Technical Specifications'}
          </span>
        </div>
        <h2 className="text-4xl md:text-5xl font-serif text-foreground">
          {d?.title ?? 'Built to Last'}
        </h2>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {items.map((item, i) => (
          <div
            key={i}
            className="relative rounded-2xl border border-border bg-muted/10 p-5 text-center overflow-hidden group hover:border-primary/40 hover:bg-primary/5 transition-all duration-300"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="relative z-10">
              <div className="text-2xl md:text-3xl font-serif font-bold text-primary mb-1.5 drop-shadow-[0_0_16px_rgba(168,85,247,0.5)]">
                {item.value}
              </div>
              <div className="text-xs font-semibold text-foreground/80 leading-snug">{item.label}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
