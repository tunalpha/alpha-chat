import React from 'react';

export default function HeroTransferSection({ dict }: { dict: any }) {
  const d = dict.heroTransfer;
  return (
    <section className="relative overflow-hidden py-0 my-0" style={{ pageBreakBefore: 'always' }}>
      <div className="absolute inset-0 bg-[#06040f]" />
      <div className="absolute inset-0 bg-gradient-to-b from-violet-950/30 via-[#06040f] to-[#06040f]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-violet-600/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-32">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full bg-violet-500/15 border border-violet-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            <span className="text-xs font-semibold text-violet-300 tracking-widest uppercase">{d.badge}</span>
          </div>
          <h2 className="text-5xl md:text-7xl font-serif text-white leading-tight">
            {d.headline}<br />
            <span className="text-violet-300">{d.headline2}</span>
          </h2>
          <p className="mt-6 text-lg text-white/40 max-w-xl mx-auto">{d.sub}</p>
        </div>

        {/* Two phones + flow */}
        <div className="flex flex-col md:flex-row items-center justify-center gap-6 md:gap-10">
          {/* Phone 1 — Sender */}
          <div className="flex flex-col items-center gap-4">
            <div className="text-xs text-white/40 uppercase tracking-widest font-semibold">{d.fromLabel}</div>
            <div className="relative">
              <div className="absolute inset-0 bg-violet-500/15 blur-2xl rounded-full" />
              <div className="relative w-[160px] bg-[#100d1e] border-2 border-violet-500/30 rounded-[2.5rem] overflow-hidden shadow-xl" style={{ aspectRatio: '9/19.5' }}>
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-4 bg-[#100d1e] rounded-b-xl z-10" />
                <div className="px-3 pt-6 pb-2">
                  <div className="flex items-center gap-1.5 mb-3">
                    <div className="w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center text-[8px] text-white font-bold">A</div>
                    <span className="text-white/60 text-[9px] font-semibold">AlphaChat</span>
                  </div>
                  {/* Outgoing payment */}
                  <div className="bg-gradient-to-br from-violet-600/25 to-violet-600/10 border border-violet-500/30 rounded-xl p-2 mb-2">
                    <div className="text-[7px] text-violet-300/70 uppercase tracking-widest mb-0.5">Sending</div>
                    <div className="text-violet-200 text-xs font-bold">$250 USDA</div>
                    <div className="w-full bg-white/10 rounded-full h-1 mt-1.5 overflow-hidden">
                      <div className="bg-violet-500 h-1 rounded-full" style={{ width: '75%' }} />
                    </div>
                    <div className="text-[7px] text-violet-300/50 mt-1">On-chain confirmation...</div>
                  </div>
                  <div className="flex justify-center">
                    <div className="px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/30">
                      <span className="text-[7px] text-violet-300">🔒 Escrow locked</span>
                    </div>
                  </div>
                </div>
                <div className="absolute bottom-2 left-0 right-0 flex justify-center">
                  <div className="w-10 h-0.5 bg-white/15 rounded-full" />
                </div>
              </div>
            </div>
          </div>

          {/* Middle: flow diagram */}
          <div className="flex flex-col items-center gap-3 min-w-[160px]">
            {/* Steps */}
            {(d.steps || []).map((step: string, i: number) => (
              <React.Fragment key={i}>
                <div className={`px-4 py-2 rounded-xl border text-xs font-semibold text-center min-w-[110px] ${
                  i === 0 ? 'bg-violet-600/20 border-violet-500/40 text-violet-200' :
                  i === 1 ? 'bg-amber-500/15 border-amber-500/40 text-amber-200' :
                  'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
                }`}>
                  {step}
                </div>
                {i < (d.steps?.length ?? 0) - 1 && (
                  <div className="flex flex-col items-center gap-0.5">
                    <div className="w-px h-4 bg-white/15" />
                    <svg className="w-3 h-3 text-white/30" fill="currentColor" viewBox="0 0 24 24"><path d="M12 16l-4-4h8z"/></svg>
                  </div>
                )}
              </React.Fragment>
            ))}
            {/* Network badge */}
            <div className="mt-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-violet-500" />
              <span className="text-[9px] text-white/50 font-mono">{d.network}</span>
            </div>
          </div>

          {/* Phone 2 — Receiver */}
          <div className="flex flex-col items-center gap-4">
            <div className="text-xs text-white/40 uppercase tracking-widest font-semibold">{d.toLabel}</div>
            <div className="relative">
              <div className="absolute inset-0 bg-emerald-500/15 blur-2xl rounded-full" />
              <div className="relative w-[160px] bg-[#0a100e] border-2 border-emerald-500/30 rounded-[2.5rem] overflow-hidden shadow-xl" style={{ aspectRatio: '9/19.5' }}>
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-4 bg-[#0a100e] rounded-b-xl z-10" />
                <div className="px-3 pt-6 pb-2">
                  <div className="flex items-center gap-1.5 mb-3">
                    <div className="w-5 h-5 rounded-full bg-emerald-600 flex items-center justify-center text-[8px] text-white font-bold">M</div>
                    <span className="text-white/60 text-[9px] font-semibold">AlphaChat</span>
                  </div>
                  {/* Incoming payment */}
                  <div className="bg-gradient-to-br from-emerald-600/25 to-emerald-600/10 border border-emerald-500/30 rounded-xl p-2 mb-2">
                    <div className="text-[7px] text-emerald-300/70 uppercase tracking-widest mb-0.5">Received</div>
                    <div className="text-emerald-200 text-xs font-bold">+$250 USDA</div>
                    <div className="flex items-center gap-1 mt-1.5">
                      <div className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span className="text-[7px] text-emerald-300">Payment completed</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-[7px]">
                      <span className="text-white/40">Balance</span>
                      <span className="text-emerald-300 font-semibold">2,480 USDA</span>
                    </div>
                  </div>
                </div>
                <div className="absolute bottom-2 left-0 right-0 flex justify-center">
                  <div className="w-10 h-0.5 bg-white/15 rounded-full" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
