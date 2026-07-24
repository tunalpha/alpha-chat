import React from 'react';

export default function HeroMerchantSection({ dict }: { dict: any }) {
  const d = dict.heroMerchant;
  const steps = d.steps || [];
  return (
    <section className="relative overflow-hidden py-0 my-0" style={{ pageBreakBefore: 'always' }}>
      <div className="absolute inset-0 bg-[#05080f]" />
      <div className="absolute inset-0 bg-gradient-to-br from-blue-950/25 via-[#05080f] to-violet-950/20" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[300px] bg-blue-600/8 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-32">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full bg-blue-500/15 border border-blue-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-xs font-semibold text-blue-300 tracking-widest uppercase">{d.badge}</span>
          </div>
          <h2 className="text-5xl md:text-7xl font-serif text-white leading-tight">
            {d.headline}<br />
            <span className="text-blue-300">{d.headline2}</span>
          </h2>
          <p className="mt-6 text-lg text-white/40 max-w-xl mx-auto">{d.sub}</p>
        </div>

        {/* Flow diagram — horizontal on desktop */}
        <div className="flex flex-col md:flex-row items-center justify-center gap-0">
          {steps.map((step: any, i: number) => {
            const colors = [
              'from-blue-500/20 to-blue-500/5 border-blue-500/40 text-blue-200',
              'from-violet-500/20 to-violet-500/5 border-violet-500/40 text-violet-200',
              'from-emerald-500/20 to-emerald-500/5 border-emerald-500/40 text-emerald-200',
              'from-amber-500/20 to-amber-500/5 border-amber-500/40 text-amber-200',
              'from-blue-500/20 to-blue-500/5 border-blue-500/40 text-blue-200',
              'from-emerald-500/25 to-emerald-600/10 border-emerald-500/50 text-emerald-200',
            ];
            const isLast = i === steps.length - 1;
            return (
              <React.Fragment key={i}>
                <div className="flex flex-col items-center gap-2">
                  <div className={`w-20 h-20 md:w-24 md:h-24 rounded-2xl bg-gradient-to-br border flex flex-col items-center justify-center gap-1 shadow-lg ${colors[i]}`}>
                    <span className="text-2xl md:text-3xl">{step.icon}</span>
                  </div>
                  <span className={`text-xs md:text-sm font-semibold ${colors[i].split(' ').pop()}`}>{step.label}</span>
                </div>
                {!isLast && (
                  <div className="flex items-center justify-center w-8 h-8 md:w-12 md:h-8 flex-shrink-0">
                    {/* Arrow */}
                    <svg className="w-5 h-5 text-white/20 rotate-90 md:rotate-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Note */}
        <div className="mt-16 text-center">
          <p className="text-sm text-white/30 max-w-lg mx-auto italic">{d.note}</p>
        </div>

        {/* Bottom strip */}
        <div className="mt-12 flex justify-center gap-8 text-xs text-white/20 font-mono uppercase tracking-widest flex-wrap">
          <span>On-Chain Escrow</span>
          <span>Anti-Replay</span>
          <span>Atomic Settlement</span>
          <span>Polygon PoS</span>
          <span>AlphaBit Pay</span>
        </div>
      </div>
    </section>
  );
}
