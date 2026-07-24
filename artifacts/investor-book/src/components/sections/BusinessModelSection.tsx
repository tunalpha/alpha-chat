import React from 'react';

export default function BusinessModelSection({ dict }: { dict: any }) {
  return (
    <section>
      <div className="flex items-center gap-4 mb-12">
        <div className="h-px bg-primary/50 w-12" />
        <h2 className="text-sm uppercase tracking-[0.2em] text-primary font-semibold">{dict.businessModel.title}</h2>
      </div>

      <p className="text-2xl text-white/90 font-light mb-16 max-w-2xl leading-snug">
        {dict.businessModel.subtitle}
      </p>

      <div className="grid md:grid-cols-3 gap-6">
        {dict.businessModel.points.map((point: any, i: number) => (
          <div key={i} className="p-8 border border-white/10 bg-white/[0.02] rounded-2xl">
            <div className="text-primary font-serif text-2xl mb-4">0{i + 1}</div>
            <h3 className="text-lg text-white font-medium mb-3">{point.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{point.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}