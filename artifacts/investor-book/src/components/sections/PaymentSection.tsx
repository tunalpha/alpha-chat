import React from 'react';

export default function PaymentSection({ dict }: { dict: any }) {
  return (
    <section className="relative rounded-3xl overflow-hidden">
      {/* Dark gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0d0520] via-[#110a2e] to-[#0a0618]" />
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-violet-600/10 blur-[80px] rounded-full pointer-events-none" />
      {/* Border glow */}
      <div className="absolute inset-0 rounded-3xl border border-primary/30 pointer-events-none" />

      <div className="relative z-10 p-8 md:p-14">
        {/* Header */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 mb-5 px-3 py-1 rounded-full bg-primary/20 border border-primary/30">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-semibold text-primary tracking-widest uppercase">Live on Polygon</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-serif text-white mb-3">{dict.paymentLayer.title}</h2>
          <p className="text-xl text-primary/90 font-light">{dict.paymentLayer.subtitle}</p>
        </div>

        {/* Lead paragraph */}
        <p className="text-base md:text-lg text-white/70 leading-relaxed max-w-2xl mb-12 border-l-2 border-primary/50 pl-5">
          {dict.paymentLayer.desc}
        </p>

        {/* Feature cards */}
        <div className="grid sm:grid-cols-2 gap-5">
          {dict.paymentLayer.features.map((feat: any, i: number) => (
            <div
              key={i}
              className="bg-white/5 border border-white/10 p-6 rounded-2xl backdrop-blur-sm hover:border-primary/40 hover:bg-primary/5 transition-all duration-300 group"
            >
              <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center mb-4 group-hover:bg-primary/30 transition-colors">
                <div className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_rgba(168,85,247,0.8)]" />
              </div>
              <h3 className="text-white font-semibold mb-2">{feat.title}</h3>
              <p className="text-sm text-white/60 leading-relaxed">{feat.desc}</p>
            </div>
          ))}
        </div>

        {/* Bottom strip */}
        <div className="mt-10 pt-8 border-t border-white/10 flex flex-wrap gap-6 text-xs text-white/40 font-mono uppercase tracking-widest">
          <span>ERC-20</span>
          <span>Polygon PoS</span>
          <span>On-chain Escrow</span>
          <span>WalletConnect v3</span>
          <span>getusda.xyz</span>
        </div>
      </div>
    </section>
  );
}
