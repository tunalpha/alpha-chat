import React from 'react';

export default function HeroWalletSection({ dict }: { dict: any }) {
  const d = dict.heroWallet;
  return (
    <section className="relative overflow-hidden py-0 my-0" style={{ pageBreakBefore: 'always' }}>
      <div className="absolute inset-0 bg-[#04080f]" />
      <div className="absolute inset-0 bg-gradient-to-br from-[#04080f] via-violet-950/20 to-[#04080f]" />
      <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-violet-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-blue-600/8 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-32 flex flex-col md:flex-row items-center gap-12 md:gap-20">
        {/* Left: iPhone wallet */}
        <div className="flex-shrink-0 flex justify-center">
          <div className="relative">
            <div className="absolute inset-0 bg-violet-500/15 blur-3xl rounded-full scale-75" />
            <div className="relative w-[260px] md:w-[300px] bg-[#0b0918] border-2 border-white/10 rounded-[3rem] shadow-2xl overflow-hidden" style={{ aspectRatio: '9/19.5' }}>
              {/* Notch */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-6 bg-[#0b0918] rounded-b-2xl z-20" />
              {/* Status */}
              <div className="flex justify-between items-center px-6 pt-3 pb-1">
                <span className="text-white/50 text-[9px] font-semibold">9:41</span>
                <div className="flex gap-1 items-center">
                  <div className="w-3 h-1.5 bg-white/40 rounded-sm" />
                  <div className="w-3 h-1.5 bg-white/40 rounded-sm" />
                  <div className="w-4 h-2 bg-violet-400 rounded-sm" />
                </div>
              </div>
              {/* Title */}
              <div className="px-5 pt-2 pb-1">
                <div className="text-white/40 text-[9px] uppercase tracking-widest">USDA Wallet</div>
              </div>
              {/* Balance card */}
              <div className="mx-3 rounded-2xl bg-gradient-to-br from-violet-600/30 to-violet-900/30 border border-violet-500/30 p-4 mb-3">
                <div className="text-white/50 text-[9px] mb-1">Total Balance</div>
                <div className="text-white text-2xl font-bold">{d.balance}</div>
                <div className="text-violet-300 text-[10px] font-semibold">{d.currency}</div>
                <div className="mt-2 h-px bg-white/10" />
                <div className="mt-2 text-[8px] text-white/30">0x7F3a...d42B · Polygon</div>
              </div>
              {/* Action buttons */}
              <div className="flex justify-around px-4 mb-3">
                {(d.actions || []).map((action: string, i: number) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <div className="w-9 h-9 rounded-full bg-violet-600/20 border border-violet-500/30 flex items-center justify-center">
                      <span className="text-xs text-violet-300">
                        {i === 0 ? '↑' : i === 1 ? '↓' : i === 2 ? '⟳' : '▣'}
                      </span>
                    </div>
                    <span className="text-[8px] text-white/50">{action}</span>
                  </div>
                ))}
              </div>
              {/* History */}
              <div className="px-3">
                <div className="text-[9px] text-white/30 uppercase tracking-widest mb-2">Recent</div>
                <div className="flex flex-col gap-1.5">
                  {(d.history || []).map((item: any, i: number) => (
                    <div key={i} className="flex justify-between items-center py-1.5 border-b border-white/5">
                      <div>
                        <div className="text-[9px] text-white/70">{item.label}</div>
                        <div className="text-[7px] text-white/30">{item.date}</div>
                      </div>
                      <div className={`text-[9px] font-semibold ${item.amount.startsWith('+') ? 'text-emerald-400' : 'text-red-400'}`}>
                        {item.amount}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Home bar */}
              <div className="flex justify-center py-3">
                <div className="w-16 h-1 bg-white/20 rounded-full" />
              </div>
            </div>
          </div>
        </div>

        {/* Right: headline */}
        <div className="flex-1 text-center md:text-left">
          <div className="inline-flex items-center gap-2 mb-8 px-3 py-1.5 rounded-full bg-violet-500/15 border border-violet-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            <span className="text-xs font-semibold text-violet-300 tracking-widest uppercase">{d.badge}</span>
          </div>

          <h2 className="text-5xl md:text-7xl font-serif text-white leading-tight mb-6">
            {d.headline}<br />
            <span className="text-violet-300">{d.headline2}</span>
          </h2>

          <p className="text-lg md:text-xl text-white/50 leading-relaxed max-w-md mb-10">{d.sub}</p>

          {/* Stats row */}
          <div className="flex flex-wrap gap-6">
            {[
              { label: 'Networks', value: 'Polygon L2' },
              { label: 'Standard', value: 'ERC-20' },
              { label: 'Custody', value: 'Non-custodial' },
            ].map((s, i) => (
              <div key={i}>
                <div className="text-2xl font-bold text-white">{s.value}</div>
                <div className="text-xs text-white/40 uppercase tracking-widest">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
