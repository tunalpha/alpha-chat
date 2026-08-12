import React from 'react';

const chainColors: Record<string, string> = {
  "🔵": "border-blue-500/30 bg-blue-500/5",
  "⬡":  "border-slate-500/30 bg-slate-500/5",
  "🟡": "border-yellow-500/30 bg-yellow-500/5",
  "🟠": "border-orange-500/30 bg-orange-500/5",
};

export default function WalletDeepDiveSection({ dict }: { dict: any }) {
  const d = dict.alphaWallet;

  return (
    <section className="relative rounded-3xl overflow-hidden">
      {/* Dark gradient bg */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#050210] via-[#0a0520] to-[#080318]" />
      <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-violet-600/12 blur-[100px] rounded-full pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-blue-600/8 blur-[80px] rounded-full pointer-events-none" />
      <div className="absolute inset-0 rounded-3xl border border-primary/25 pointer-events-none" />

      <div className="relative z-10 p-8 md:p-14">
        {/* Header */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 mb-5 px-3 py-1 rounded-full bg-primary/15 border border-primary/30">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-semibold text-primary tracking-widest uppercase">Self-Custodial · BIP-39/44</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-serif text-white mb-3">{d.title}</h2>
          <p className="text-xl text-primary/90 font-light">{d.subtitle}</p>
        </div>

        {/* Lead */}
        <p className="text-base md:text-lg text-white/65 leading-relaxed max-w-2xl mb-12 border-l-2 border-primary/40 pl-5">
          {d.desc}
        </p>

        {/* Security pillars */}
        <h3 className="text-xs uppercase tracking-[0.2em] text-primary/60 font-semibold mb-5">{d.securityTitle}</h3>
        <div className="grid sm:grid-cols-2 gap-4 mb-12">
          {d.security.map((item: any, i: number) => (
            <div
              key={i}
              className="bg-white/4 border border-white/8 rounded-2xl p-5 hover:border-primary/35 hover:bg-primary/5 transition-all duration-300 group"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <h4 className="text-white font-semibold text-sm leading-snug group-hover:text-primary/90 transition-colors">{item.title}</h4>
                <span className="flex-shrink-0 text-[10px] font-mono bg-primary/12 text-primary/80 border border-primary/20 px-2 py-0.5 rounded-full whitespace-nowrap">{item.spec}</span>
              </div>
              <p className="text-xs text-white/50 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>

        {/* Chains */}
        <h3 className="text-xs uppercase tracking-[0.2em] text-primary/60 font-semibold mb-5">{d.chainsTitle}</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          {d.chains.map((chain: any, i: number) => (
            <div
              key={i}
              className={`rounded-2xl border p-5 ${chainColors[chain.icon] ?? 'border-white/10 bg-white/4'}`}
            >
              <div className="text-2xl mb-2">{chain.icon}</div>
              <div className="text-white font-semibold text-sm mb-0.5">{chain.name}</div>
              <div className="text-xs font-mono text-white/40 mb-2">{chain.symbol}</div>
              <div className="text-xs text-white/55 leading-relaxed">{chain.desc}</div>
            </div>
          ))}
        </div>

        {/* Platform fee */}
        <div className="rounded-2xl bg-white/4 border border-primary/20 p-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <h4 className="text-xs uppercase tracking-widest text-white/50 font-semibold">{d.platformFeeTitle}</h4>
          </div>
          <p className="text-sm text-white/60 leading-relaxed">{d.platformFeeDesc}</p>
        </div>

        {/* Bottom strip */}
        <div className="mt-10 pt-8 border-t border-white/8 flex flex-wrap gap-6 text-xs text-white/35 font-mono uppercase tracking-widest">
          <span>BIP-39</span>
          <span>BIP-44 / BIP-84</span>
          <span>secp256k1</span>
          <span>P2WPKH SegWit</span>
          <span>PSBT</span>
          <span>AES-256-GCM IndexedDB</span>
          <span>WebAuthn Face ID</span>
        </div>
      </div>
    </section>
  );
}
