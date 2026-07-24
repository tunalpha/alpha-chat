import React from 'react';

export default function FounderSection({ dict }: { dict: any }) {
  return (
    <section className="pt-20">
      <div className="flex items-center gap-4 mb-12">
        <div className="h-px bg-primary/50 w-12" />
        <h2 className="text-sm uppercase tracking-[0.2em] text-primary font-semibold">{dict.founder.title}</h2>
      </div>

      <div className="grid md:grid-cols-12 gap-12">
        <div className="md:col-span-5 space-y-6">
          <div>
            <h3 className="text-4xl md:text-5xl font-serif text-white mb-2">{dict.founder.name}</h3>
            <p className="text-lg text-muted-foreground font-mono text-sm">{dict.founder.alias}</p>
          </div>
          <div className="inline-block px-3 py-1 bg-white/5 border border-white/10 rounded text-sm text-primary">
            {dict.founder.role}
          </div>
        </div>

        <div className="md:col-span-7 space-y-6 text-lg text-muted-foreground leading-relaxed font-light">
          {dict.founder.paragraphs.map((p: string, i: number) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </div>

      <div className="mt-20 p-8 border border-white/10 bg-white/[0.02] rounded-2xl backdrop-blur-sm">
        <h4 className="text-xl font-serif text-white mb-8">{dict.founder.philosophyTitle}</h4>
        <div className="grid md:grid-cols-3 gap-8">
          {dict.founder.philosophy.map((item: any, i: number) => (
            <div key={i} className="space-y-3">
              <h5 className="text-primary font-medium">{item.title}</h5>
              <p className="text-sm text-muted-foreground">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-20 text-center">
        <blockquote className="text-2xl md:text-3xl font-serif italic text-white/90 leading-snug max-w-3xl mx-auto">
          "{dict.founder.quote}"
        </blockquote>
      </div>
    </section>
  );
}