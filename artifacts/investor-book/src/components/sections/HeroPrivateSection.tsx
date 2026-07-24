import React from 'react';

export default function HeroPrivateSection({ dict }: { dict: any }) {
  const d = dict.heroPrivate;
  return (
    <section className="relative overflow-hidden py-0 my-0" style={{ pageBreakBefore: 'always' }}>
      {/* Full-bleed dark background */}
      <div className="absolute inset-0 bg-[#060410]" />
      <div className="absolute inset-0 bg-gradient-to-br from-violet-950/60 via-[#060410] to-[#060410]" />
      {/* Ambient glow */}
      <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-violet-600/15 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-purple-500/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-32 flex flex-col md:flex-row items-center gap-12 md:gap-20">
        {/* Left: headline */}
        <div className="flex-1 text-center md:text-left">
          <div className="inline-flex items-center gap-2 mb-8 px-3 py-1.5 rounded-full bg-violet-500/15 border border-violet-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            <span className="text-xs font-semibold text-violet-300 tracking-widest uppercase">{d.badge}</span>
          </div>

          <h2 className="text-5xl md:text-7xl font-serif text-white leading-tight mb-6">
            {d.headline}<br />
            <span className="text-violet-300">{d.headline2}</span>
          </h2>

          <p className="text-lg md:text-xl text-white/50 leading-relaxed max-w-md">
            {d.sub}
          </p>

          {/* Lock badge */}
          <div className="mt-10 inline-flex items-center gap-3 px-5 py-3 rounded-2xl bg-white/5 border border-white/10">
            <svg className="w-5 h-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span className="text-sm text-white/70 font-medium">{d.lock}</span>
          </div>
        </div>

        {/* Right: iPhone mockup */}
        <div className="flex-shrink-0 flex justify-center">
          <div className="relative">
            {/* Glow behind phone */}
            <div className="absolute inset-0 bg-violet-600/20 blur-3xl rounded-full scale-75" />
            {/* Phone shell */}
            <div className="relative w-[240px] md:w-[280px] bg-[#0f0c1a] border-2 border-white/10 rounded-[3rem] shadow-2xl overflow-hidden" style={{ aspectRatio: '9/19.5' }}>
              {/* Notch */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-6 bg-[#0f0c1a] rounded-b-2xl z-20" />
              {/* Status bar */}
              <div className="flex justify-between items-center px-6 pt-3 pb-1">
                <span className="text-white/50 text-[9px] font-semibold">9:41</span>
                <div className="flex gap-1 items-center">
                  <div className="w-3 h-1.5 bg-white/40 rounded-sm" />
                  <div className="w-3 h-1.5 bg-white/40 rounded-sm" />
                  <div className="w-4 h-2 bg-violet-400 rounded-sm" />
                </div>
              </div>
              {/* Header */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center text-[10px] text-white font-bold">A</div>
                <div>
                  <div className="text-white text-[11px] font-semibold">Alex</div>
                  <div className="text-green-400 text-[8px]">● Online</div>
                </div>
                <div className="ml-auto">
                  <svg className="w-3.5 h-3.5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                </div>
              </div>
              {/* Chat */}
              <div className="flex flex-col gap-2 px-3 py-3 flex-1 overflow-hidden">
                {(d.chat || []).map((msg: any, i: number) => (
                  <div key={i} className={`flex ${msg.side === 'right' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] px-2.5 py-1.5 rounded-2xl text-[9px] leading-tight ${msg.side === 'right' ? 'bg-violet-600 text-white rounded-br-sm' : 'bg-white/10 text-white/80 rounded-bl-sm'}`}>
                      {msg.text}
                    </div>
                  </div>
                ))}
                {/* E2E label */}
                <div className="text-center mt-1">
                  <span className="text-[7px] text-white/30">🔒 End-to-end encrypted</span>
                </div>
              </div>
              {/* Input bar */}
              <div className="flex items-center gap-2 px-3 py-2 border-t border-white/5 bg-white/3">
                <div className="flex-1 h-6 rounded-full bg-white/8 border border-white/10" />
                <div className="w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                </div>
              </div>
              {/* Home indicator */}
              <div className="flex justify-center pb-2 pt-1">
                <div className="w-16 h-1 bg-white/20 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
