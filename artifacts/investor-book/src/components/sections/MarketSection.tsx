import React from 'react';

const colorMap: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  purple: {
    bg: 'bg-primary/10',
    border: 'border-primary/30',
    text: 'text-primary',
    dot: 'bg-primary',
  },
  green: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
    dot: 'bg-emerald-400',
  },
  blue: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
    dot: 'bg-blue-400',
  },
};

export default function MarketSection({ dict }: { dict: any }) {
  const m = dict.market;

  return (
    <section>
      {/* Header */}
      <div className="text-center mb-16 space-y-4">
        <h2 className="text-4xl md:text-5xl font-serif text-foreground">{m.title}</h2>
        <p className="text-xl text-primary font-light">{m.subtitle}</p>
        <p className="text-lg text-muted-foreground font-light max-w-2xl mx-auto mt-4">{m.intro}</p>
      </div>

      {/* Market Segments */}
      <div className="space-y-8">
        {m.segments.map((seg: any, i: number) => {
          const c = colorMap[seg.color] ?? colorMap.purple;
          return (
            <div
              key={i}
              className={`rounded-2xl border ${c.border} ${c.bg} p-6 md:p-8`}
            >
              <div className="flex flex-col md:flex-row md:items-start gap-6 md:gap-10">
                {/* Stat Block */}
                <div className="flex-shrink-0 text-center md:text-left md:w-48">
                  <div className="text-4xl mb-2">{seg.icon}</div>
                  <div className={`text-4xl md:text-5xl font-serif font-bold ${c.text} leading-none`}>
                    {seg.stat}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 font-medium uppercase tracking-wide">
                    {seg.unit}
                  </div>
                  <div className={`text-base font-semibold ${c.text} mt-2`}>{seg.label}</div>
                </div>

                {/* Divider */}
                <div className={`hidden md:block w-px self-stretch ${c.border} border-l`} />

                {/* Points */}
                <ul className="flex-1 space-y-3">
                  {seg.points.map((point: string, j: number) => (
                    <li key={j} className="flex items-start gap-3">
                      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} />
                      <span className="text-foreground/90 leading-relaxed text-sm md:text-base">{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>

      {/* Conclusion callout */}
      <div className="mt-12 rounded-2xl border border-primary/40 bg-primary/5 p-6 md:p-8 text-center">
        <p className="text-base md:text-lg text-foreground/90 leading-relaxed font-light max-w-3xl mx-auto">
          {m.conclusion}
        </p>
      </div>
    </section>
  );
}
