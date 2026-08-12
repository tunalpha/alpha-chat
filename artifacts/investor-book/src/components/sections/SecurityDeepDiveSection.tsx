import React from 'react';

export default function SecurityDeepDiveSection({ dict }: { dict: any }) {
  const d = dict.security;

  return (
    <section className="relative">
      {/* Section label */}
      <div className="flex items-center gap-4 mb-12">
        <div className="h-px bg-primary/50 w-12" />
        <h2 className="text-sm uppercase tracking-[0.2em] text-primary font-semibold">{d.title}</h2>
      </div>

      <p className="text-2xl md:text-3xl text-foreground/90 font-light mb-8 max-w-3xl leading-snug">
        {d.subtitle}
      </p>

      {/* Guarantee block */}
      <div className="relative mb-16 rounded-2xl overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/15 via-primary/8 to-transparent" />
        <div className="absolute inset-0 rounded-2xl border border-primary/30" />
        <div className="relative z-10 px-8 py-7 flex gap-5 items-start">
          <div className="flex-shrink-0 mt-1 w-10 h-10 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-lg">🔐</div>
          <p className="text-base md:text-lg text-foreground/80 leading-relaxed font-light">
            {d.guarantee}
          </p>
        </div>
      </div>

      {/* Pillars */}
      <div className="space-y-6">
        {d.pillars.map((pillar: any, i: number) => (
          <div
            key={i}
            className="group rounded-2xl border border-border bg-muted/10 hover:border-primary/30 hover:bg-primary/5 transition-all duration-300 overflow-hidden"
          >
            {/* Pillar header */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-7 pt-7 pb-4">
              <div className="flex items-center gap-3 flex-1">
                <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center flex-shrink-0">
                  <span className="text-primary font-bold font-mono text-xs">0{i + 1}</span>
                </div>
                <h3 className="text-base md:text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
                  {pillar.title}
                </h3>
              </div>
              <span className="self-start sm:self-auto inline-flex items-center px-3 py-1 rounded-full text-xs font-mono font-semibold bg-primary/10 text-primary border border-primary/20 whitespace-nowrap">
                {pillar.badge}
              </span>
            </div>

            <div className="px-7 pb-7">
              {/* Description */}
              <p className="text-sm md:text-base text-muted-foreground leading-relaxed mb-5">
                {pillar.desc}
              </p>

              {/* Specs */}
              {pillar.specs && pillar.specs.length > 0 && (
                <div className="grid sm:grid-cols-2 gap-2">
                  {pillar.specs.map((spec: string, si: number) => (
                    <div key={si} className="flex items-start gap-2.5">
                      <div className="flex-shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-primary/70" />
                      <span className="text-xs font-mono text-foreground/60 leading-relaxed">{spec}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom strip */}
      <div className="mt-10 pt-8 border-t border-border flex flex-wrap gap-6 text-xs text-muted-foreground font-mono uppercase tracking-widest">
        <span>Signal Protocol</span>
        <span>X3DH + Double Ratchet</span>
        <span>AES-256-GCM</span>
        <span>argon2id</span>
        <span>WebAuthn / Face ID</span>
        <span>BIP-39 Client-Only</span>
      </div>
    </section>
  );
}
