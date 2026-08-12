import React from 'react';

export default function ProductSection({ dict }: { dict: any }) {
  const aw = dict.alphaWallet;

  return (
    <section>
      <div className="flex items-center gap-4 mb-12">
        <div className="h-px bg-primary/50 w-12" />
        <h2 className="text-sm uppercase tracking-[0.2em] text-primary font-semibold">{dict.product.title}</h2>
      </div>

      <p className="text-2xl text-foreground/90 font-light mb-12 max-w-2xl leading-snug">
        {dict.product.subtitle}
      </p>

      {/* ═══════════════════════════════════════════════════════════════
          ALPHA WALLET — Hero card prominente
          Viene prima delle tech facts perché è il differenziatore più
          rilevante per fiducia dell'investitore.
      ════════════════════════════════════════════════════════════════ */}
      <div className="relative mb-10 rounded-3xl overflow-hidden">
        {/* Dark background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#060215] via-[#0d0628] to-[#08051c]" />
        <div className="absolute top-0 right-0 w-80 h-80 bg-violet-600/15 blur-[90px] rounded-full pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-60 h-60 bg-blue-600/8 blur-[80px] rounded-full pointer-events-none" />
        <div className="absolute inset-0 rounded-3xl border border-violet-500/30 pointer-events-none" />

        <div className="relative z-10 p-7 md:p-10">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 mb-5 px-3 py-1 rounded-full bg-violet-500/15 border border-violet-400/30">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            <span className="text-[10px] font-mono font-semibold text-violet-300 tracking-widest uppercase">Wallet Self-Custodial · 4 Blockchain · BIP-39/44</span>
          </div>

          {/* Title */}
          <h3 className="text-3xl md:text-4xl font-serif text-white mb-3">{aw.title}</h3>
          <p className="text-lg text-violet-300/80 font-light mb-6">{aw.subtitle}</p>

          {/* Emotional statement */}
          <div className="rounded-2xl bg-white/5 border border-violet-400/15 px-6 py-5 mb-8">
            <p className="text-base md:text-lg text-white/80 leading-relaxed font-light">
              Le chiavi private non lasciano mai il tuo dispositivo.{" "}
              <span className="text-violet-300 font-medium">Matematicamente impossibile</span> per chiunque — incluso AlphaChat — accedere ai tuoi fondi senza la tua autorizzazione esplicita.
            </p>
          </div>

          {/* 3-column feature highlights */}
          <div className="grid sm:grid-cols-3 gap-4 mb-8">
            {[
              {
                icon: "🧬",
                title: "Frase Seme BIP-39",
                desc: "12–24 parole generate localmente con crypto.getRandomValues. Mai trasmessa al server. Mai nella rete.",
                badge: "Client-Side Only",
                badgeColor: "bg-emerald-500/15 border-emerald-400/20 text-emerald-300",
              },
              {
                icon: "🔑",
                title: "Firma Offline",
                desc: "La chiave privata viene derivata, usata per firmare la TX, e azzerata in memoria nel blocco try/finally. Zero esposizione.",
                badge: "Memory Zeroing",
                badgeColor: "bg-blue-500/15 border-blue-400/20 text-blue-300",
              },
              {
                icon: "🪪",
                title: "Face ID / PIN Seal",
                desc: "Il wallet è cifrato con AES-256-GCM in IndexedDB. Sbloccabile con Face ID via WebAuthn. Zero-trust anche sul dispositivo.",
                badge: "WebAuthn AES-GCM",
                badgeColor: "bg-violet-500/15 border-violet-400/20 text-violet-300",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl bg-white/4 border border-white/8 p-5 hover:border-violet-400/25 hover:bg-violet-500/5 transition-all duration-300">
                <div className="text-2xl mb-3">{item.icon}</div>
                <div className={`inline-flex mb-3 px-2 py-0.5 rounded-full border text-[9px] font-mono font-semibold ${item.badgeColor}`}>
                  {item.badge}
                </div>
                <h4 className="text-white font-semibold text-sm mb-2">{item.title}</h4>
                <p className="text-xs text-white/50 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* Derivation path + 4 chains side by side */}
          <div className="grid md:grid-cols-2 gap-4">

            {/* Derivation path */}
            <div className="rounded-xl bg-white/3 border border-white/6 p-4">
              <span className="text-[10px] uppercase tracking-widest text-white/30 font-mono block mb-3">Percorso HD Standard</span>
              <div className="font-mono text-[11px] text-white/60 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-violet-400">m</span>
                  <span className="text-white/25">→</span>
                  <span>BIP-39 Mnemonic <span className="text-white/30">(128–256 bit)</span></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-indigo-400 pl-3">44'</span>
                  <span className="text-white/25">→</span>
                  <span>BIP-44 HD Derivation</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-blue-400 pl-6">60'</span>
                  <span className="text-white/25">→</span>
                  <span>EVM <span className="text-white/30">(ETH/POL/BNB)</span></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-cyan-400 pl-6">84'</span>
                  <span className="text-white/25">→</span>
                  <span>BIP-84 <span className="text-white/30">(BTC SegWit)</span></span>
                </div>
              </div>
            </div>

            {/* 4 chains */}
            <div className="rounded-xl bg-white/3 border border-white/6 p-4">
              <span className="text-[10px] uppercase tracking-widest text-white/30 font-mono block mb-3">4 Blockchain Native</span>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { icon: "🔵", name: "Polygon PoS",  tag: "USDT · USDC · POL", color: "border-blue-500/20 bg-blue-500/5" },
                  { icon: "⬡",  name: "Ethereum L1",  tag: "ETH · USDT · USDC", color: "border-slate-500/20 bg-slate-500/5" },
                  { icon: "🟡", name: "BSC",           tag: "BNB · USDT · USDC", color: "border-yellow-500/20 bg-yellow-500/5" },
                  { icon: "🟠", name: "Bitcoin",       tag: "BTC Native SegWit", color: "border-orange-500/20 bg-orange-500/5" },
                ].map((c) => (
                  <div key={c.name} className={`rounded-xl border p-3 ${c.color}`}>
                    <div className="text-lg mb-1">{c.icon}</div>
                    <div className="text-white text-[11px] font-semibold mb-0.5">{c.name}</div>
                    <div className="text-[9px] text-white/35 font-mono">{c.tag}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom strip */}
          <div className="mt-8 pt-6 border-t border-white/8 flex flex-wrap gap-4 text-[9px] text-white/25 font-mono uppercase tracking-widest">
            <span>BIP-39/44/84</span>
            <span>secp256k1</span>
            <span>P2WPKH SegWit</span>
            <span>AES-256-GCM</span>
            <span>WebAuthn Face ID</span>
            <span>PSBT Bitcoin</span>
            <span>Platform Fee Model</span>
            <span>563 test verdi</span>
          </div>
        </div>
      </div>
      {/* ═══════════════════════════════════════════════════════════════ */}

      {/* Other technology facts */}
      <div className="grid md:grid-cols-2 gap-x-8 gap-y-12">
        {dict.product.facts.map((fact: any, i: number) => (
          <div key={i} className="relative pl-6 border-l border-border hover:border-primary/50 transition-colors">
            <h3 className="text-lg text-foreground font-medium mb-2">{fact.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{fact.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
