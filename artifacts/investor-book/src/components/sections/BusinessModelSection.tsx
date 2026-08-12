import React from 'react';

const revenueIcons = ['💼', '🏪', '🔁', '⚡', '🛠️'];

export default function BusinessModelSection({ dict }: { dict: any }) {
  const d = dict.businessModel;

  return (
    <section>
      <div className="flex items-center gap-4 mb-12">
        <div className="h-px bg-primary/50 w-12" />
        <h2 className="text-sm uppercase tracking-[0.2em] text-primary font-semibold">{d.title}</h2>
      </div>

      <p className="text-2xl text-foreground/90 font-light mb-16 max-w-2xl leading-snug">
        {d.subtitle}
      </p>

      <div className="grid md:grid-cols-2 gap-5">
        {d.points.map((point: any, i: number) => (
          <div
            key={i}
            className={`relative p-7 border rounded-2xl transition-all duration-300 hover:border-primary/40 hover:bg-primary/5 group overflow-hidden
              ${i === 0 ? 'md:col-span-2 border-primary/30 bg-primary/8' : 'border-border bg-muted/10'}`}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="relative z-10">
              <div className="flex items-start gap-4 mb-4">
                <span className="text-2xl flex-shrink-0">{revenueIcons[i]}</span>
                <div>
                  <div className="text-xs font-mono uppercase tracking-widest text-primary/60 mb-1">
                    Revenue Stream {String(i + 1).padStart(2, '0')}
                  </div>
                  <h3 className="text-base md:text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
                    {point.title}
                  </h3>
                </div>
              </div>
              <p className={`text-sm leading-relaxed ${i === 0 ? 'text-foreground/70' : 'text-muted-foreground'}`}>
                {point.desc}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Business model callout */}
      <div className="mt-8 grid sm:grid-cols-3 gap-4">
        {[
          { icon: '📈', label: dict.nav?.download === 'Scarica PDF' ? 'Scalabile' : 'Scalable', desc: dict.nav?.download === 'Scarica PDF' ? 'Revenue proporzionale al volume transazioni, non agli utenti registrati' : 'Revenue proportional to transaction volume, not registered users' },
          { icon: '🔄', label: dict.nav?.download === 'Scarica PDF' ? 'Ricorrente' : 'Recurring', desc: dict.nav?.download === 'Scarica PDF' ? 'Ogni pagamento genera fee. Ogni rilascio escrow genera fee.' : 'Every payment generates a fee. Every escrow release generates a fee.' },
          { icon: '🌍', label: dict.nav?.download === 'Scarica PDF' ? 'Globale' : 'Global', desc: dict.nav?.download === 'Scarica PDF' ? 'Nessun confine geografico. Quattro blockchain. Qualsiasi stablecoin.' : 'No geographic boundaries. Four blockchains. Any stablecoin.' },
        ].map((item, i) => (
          <div key={i} className="rounded-2xl border border-border bg-muted/5 p-5">
            <span className="text-2xl block mb-3">{item.icon}</span>
            <div className="text-sm font-semibold text-foreground mb-1">{item.label}</div>
            <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
