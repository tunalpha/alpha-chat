import React from 'react';

export default function HeroPaymentSection({ dict }: { dict: any }) {
  const d = dict.heroPayment;
  return (
    <section className="relative overflow-hidden py-0 my-0" style={{ pageBreakBefore: 'always' }}>
      <div className="absolute inset-0 bg-[#040812]" />
      <div className="absolute inset-0 bg-gradient-to-tl from-emerald-950/40 via-[#040812] to-violet-950/30" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] bg-emerald-600/8 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-violet-600/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-32 flex flex-col md:flex-row-reverse items-center gap-12 md:gap-20">
        {/* Right: headline */}
        <div className="flex-1 text-center md:text-left">
          <div className="inline-flex items-center gap-2 mb-8 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-semibold text-emerald-300 tracking-widest uppercase">{d.badge}</span>
          </div>

          <h2 className="text-5xl md:text-7xl font-serif text-white leading-tight mb-6">
            {d.headline}<br />
            <span className="bg-gradient-to-r from-emerald-300 to-violet-300 bg-clip-text text-transparent">{d.headline2}</span>
          </h2>

          {/* Taglines */}
          <div className="flex flex-col gap-2 mt-8 mb-8">
            {(d.tagline || []).map((t: string, i: number) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-xl md:text-2xl text-white/80 font-light">{t}</span>
              </div>
            ))}
          </div>

          <p className="text-base text-white/40 leading-relaxed max-w-md">{d.sub}</p>
        </div>

        {/* Left: iPhone with payment */}
        <div className="flex-shrink-0 flex justify-center">
          <div className="relative">
            <div className="absolute inset-0 bg-emerald-500/15 blur-3xl rounded-full scale-75" />
            <div className="relative w-[240px] md:w-[280px] bg-[#0a0f18] border-2 border-white/10 rounded-[3rem] shadow-2xl overflow-hidden" style={{ aspectRatio: '9/19.5' }}>
              {/* Notch */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-6 bg-[#0a0f18] rounded-b-2xl z-20" />
              {/* Status bar */}
              <div className="flex justify-between items-center px-6 pt-3 pb-1">
                <span className="text-white/50 text-[9px] font-semibold">9:41</span>
                <div className="flex gap-1 items-center">
                  <div className="w-3 h-1.5 bg-white/40 rounded-sm" />
                  <div className="w-3 h-1.5 bg-white/40 rounded-sm" />
                  <div className="w-4 h-2 bg-emerald-400 rounded-sm" />
                </div>
              </div>
              {/* Header */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-[10px] text-white font-bold">M</div>
                <div>
                  <div className="text-white text-[11px] font-semibold">Marco</div>
                  <div className="text-emerald-400 text-[8px]">● Online</div>
                </div>
              </div>
              {/* Chat bubbles */}
              <div className="flex flex-col gap-2 px-3 py-3">
                <div className="flex justify-start">
                  <div className="max-w-[80%] px-2.5 py-1.5 rounded-2xl rounded-bl-sm bg-white/10 text-white/80 text-[9px]">Puoi mandarmi i 250$?</div>
                </div>
                <div className="flex justify-end">
                  <div className="max-w-[80%] px-2.5 py-1.5 rounded-2xl rounded-br-sm bg-violet-600 text-white text-[9px]">Certo, mando subito!</div>
                </div>
                {/* USDA payment bubble */}
                <div className="flex justify-end">
                  <div className="bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 border border-emerald-500/40 rounded-2xl rounded-br-sm p-2.5 max-w-[85%]">
                    <div className="text-[8px] text-emerald-300/80 mb-1 uppercase tracking-widest">USDA Transfer</div>
                    <div className="text-emerald-300 text-sm font-bold">{d.amount}</div>
                    <div className="flex items-center gap-1 mt-1.5">
                      <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-[8px] text-emerald-300/70">{d.status}</span>
                    </div>
                  </div>
                </div>
                {/* Escrow badge */}
                <div className="flex justify-center">
                  <div className="px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30">
                    <span className="text-[8px] text-emerald-300">🔒 {d.escrow}</span>
                  </div>
                </div>
              </div>
              {/* Input bar */}
              <div className="absolute bottom-6 left-0 right-0 flex items-center gap-2 px-3 py-2 border-t border-white/5 bg-white/3">
                <div className="flex-1 h-6 rounded-full bg-white/8 border border-white/10" />
                <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                </div>
              </div>
              <div className="absolute bottom-1 left-0 right-0 flex justify-center">
                <div className="w-16 h-1 bg-white/20 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
