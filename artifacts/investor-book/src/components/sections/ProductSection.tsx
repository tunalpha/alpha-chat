import React from 'react';

export default function ProductSection({ dict }: { dict: any }) {
  return (
    <section>
      <div className="flex items-center gap-4 mb-12">
        <div className="h-px bg-primary/50 w-12" />
        <h2 className="text-sm uppercase tracking-[0.2em] text-primary font-semibold">{dict.product.title}</h2>
      </div>

      <p className="text-2xl text-white/90 font-light mb-16 max-w-2xl leading-snug">
        {dict.product.subtitle}
      </p>

      <div className="grid md:grid-cols-2 gap-x-8 gap-y-12">
        {dict.product.facts.map((fact: any, i: number) => (
          <div key={i} className="relative pl-6 border-l border-white/10 hover:border-primary/50 transition-colors">
            <h3 className="text-lg text-white font-medium mb-2">{fact.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{fact.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}