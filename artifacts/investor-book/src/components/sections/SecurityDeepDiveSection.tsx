import React from 'react';

// Seed words visibili ma privati (BIP-39 wordlist è pubblica — è la COMBINAZIONE il segreto)
const SEED_WORDS = ['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accuse'];

export default function SecurityDeepDiveSection({ dict }: { dict: any }) {
  const d  = dict.security;
  const aw = dict.alphaWallet;

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
      <div className="relative mb-14 rounded-2xl overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/15 via-primary/8 to-transparent" />
        <div className="absolute inset-0 rounded-2xl border border-primary/30" />
        <div className="relative z-10 px-8 py-7 flex gap-5 items-start">
          <div className="flex-shrink-0 mt-1 w-10 h-10 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-lg">🔐</div>
          <p className="text-base md:text-lg text-foreground/80 leading-relaxed font-light">
            {d.guarantee}
          </p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          ALPHA WALLET VAULT — blocco visivo prominente
      ════════════════════════════════════════════════════════════════ */}
      <div className="relative mb-14 rounded-3xl overflow-hidden">
        {/* Dark background */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#050210] via-[#0b0520] to-[#07041a]" />
        <div className="absolute top-0 right-0 w-72 h-72 bg-violet-600/15 blur-[90px] rounded-full pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-52 h-52 bg-indigo-600/10 blur-[70px] rounded-full pointer-events-none" />
        <div className="absolute inset-0 rounded-3xl border border-violet-500/25 pointer-events-none" />

        <div className="relative z-10 p-7 md:p-10">

          {/* Header */}
          <div className="flex items-center gap-3 mb-7">
            <div className="w-10 h-10 rounded-xl bg-violet-500/20 border border-violet-400/30 flex items-center justify-center text-xl flex-shrink-0">🗝️</div>
            <div>
              <div className="inline-flex items-center gap-2 mb-1 px-2.5 py-0.5 rounded-full bg-violet-500/15 border border-violet-400/25">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                <span className="text-[10px] font-mono font-semibold text-violet-300 tracking-widest uppercase">Self-Custodial · BIP-39/44</span>
              </div>
              <h3 className="text-xl md:text-2xl font-serif text-white leading-tight">{aw.title}</h3>
            </div>
          </div>

          <p className="text-sm md:text-base text-white/60 leading-relaxed mb-8 max-w-2xl border-l-2 border-violet-500/40 pl-4">
            {aw.subtitle} — {aw.desc}
          </p>

          {/* Two-column layout: seed phrase + derivation */}
          <div className="grid md:grid-cols-2 gap-6 mb-8">

            {/* Seed phrase visualization */}
            <div className="rounded-2xl bg-white/4 border border-white/8 p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[11px] uppercase tracking-widest text-white/35 font-mono">Frase Seme (12–24 parole)</span>
                <span className="text-[10px] bg-emerald-500/15 text-emerald-300 border border-emerald-400/20 px-2 py-0.5 rounded-full font-mono">Solo su dispositivo</span>
              </div>

              {/* 3×4 seed word grid — blurred to convey privacy */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                {SEED_WORDS.map((word, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 bg-white/5 border border-white/6 rounded-lg px-2.5 py-1.5"
                    style={{ filter: 'blur(4px)', userSelect: 'none' }}
                    aria-hidden="true"
                  >
                    <span className="text-[9px] text-white/30 font-mono flex-shrink-0 w-3">{i+1}.</span>
                    <span className="text-[11px] text-white/70 font-mono truncate">{word}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/6">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                <span className="text-[10px] text-white/40 font-mono">
                  Generata con <strong className="text-white/60">crypto.getRandomValues</strong> · Mai trasmessa al server
                </span>
              </div>
            </div>

            {/* Derivation chain */}
            <div className="rounded-2xl bg-white/4 border border-white/8 p-5">
              <span className="text-[11px] uppercase tracking-widest text-white/35 font-mono block mb-4">Percorso di Derivazione</span>

              {/* Chain visualization */}
              <div className="space-y-1.5">
                {[
                  { label: "BIP-39 Mnemonic", detail: "128–256 bit CSPRNG", color: "bg-violet-500/20 border-violet-400/30 text-violet-300" },
                  { label: "BIP-39 → Seed (512 bit)", detail: "PBKDF2-SHA512 · 2048 rounds", color: "bg-indigo-500/20 border-indigo-400/30 text-indigo-300" },
                  { label: "BIP-44 HD Derivation", detail: "m/44'/coin_type'/0'/0/n", color: "bg-blue-500/20 border-blue-400/30 text-blue-300" },
                  { label: "secp256k1 (EVM)", detail: "Polygon · Ethereum · BSC", color: "bg-cyan-500/20 border-cyan-400/30 text-cyan-300" },
                  { label: "P2WPKH BIP-84 (BTC)", detail: "bc1... Native SegWit", color: "bg-orange-500/20 border-orange-400/30 text-orange-300" },
                ].map((step, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && (
                      <div className="flex justify-center text-white/20 text-xs font-mono leading-none py-0.5">↓</div>
                    )}
                    <div className={`flex items-center justify-between px-3 py-1.5 rounded-lg border text-[10px] font-mono ${step.color}`}>
                      <span className="font-semibold">{step.label}</span>
                      <span className="opacity-70">{step.detail}</span>
                    </div>
                  </React.Fragment>
                ))}
              </div>

              {/* Try/finally zeroing */}
              <div className="mt-4 pt-3 border-t border-white/6 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                <span className="text-[10px] text-white/40 font-mono">
                  Chiave privata azzerata in <strong className="text-white/60">try/finally</strong> subito dopo la firma
                </span>
              </div>
            </div>
          </div>

          {/* 4-chain badges + key guarantees */}
          <div className="grid sm:grid-cols-2 gap-4 mb-7">

            {/* Chains */}
            <div className="rounded-xl bg-white/3 border border-white/6 p-4">
              <span className="text-[11px] uppercase tracking-widest text-white/30 font-mono block mb-3">4 Blockchain Supportate</span>
              <div className="flex flex-wrap gap-2">
                {[
                  { icon: "🔵", name: "Polygon",  color: "bg-blue-500/15 border-blue-400/25 text-blue-300" },
                  { icon: "⬡",  name: "Ethereum", color: "bg-slate-500/15 border-slate-400/25 text-slate-300" },
                  { icon: "🟡", name: "BSC",       color: "bg-yellow-500/15 border-yellow-400/25 text-yellow-300" },
                  { icon: "🟠", name: "Bitcoin",   color: "bg-orange-500/15 border-orange-400/25 text-orange-300" },
                ].map((c) => (
                  <div key={c.name} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-mono font-semibold ${c.color}`}>
                    <span>{c.icon}</span>
                    <span>{c.name}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Guarantees */}
            <div className="rounded-xl bg-white/3 border border-white/6 p-4">
              <span className="text-[11px] uppercase tracking-widest text-white/30 font-mono block mb-3">Garanzie Matematiche</span>
              <div className="space-y-2">
                {[
                  { icon: "✓", text: "Frase seme generata client-side · mai sul server" },
                  { icon: "✓", text: "AES-256-GCM in IndexedDB locale · Face ID seal" },
                  { icon: "✓", text: "Firma offline · il server riceve solo la TX firmata" },
                  { icon: "✓", text: "Zeroing immediato della chiave privata post-firma" },
                ].map((g, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-emerald-400 text-xs font-bold mt-0.5 flex-shrink-0">{g.icon}</span>
                    <span className="text-[11px] text-white/50 leading-relaxed">{g.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Biometric seal callout */}
          <div className="rounded-xl bg-violet-500/10 border border-violet-400/20 p-4 flex items-start gap-4">
            <div className="text-2xl flex-shrink-0">🪪</div>
            <div>
              <div className="text-sm font-semibold text-violet-200 mb-1">Face ID / WebAuthn Biometric Seal</div>
              <p className="text-xs text-white/50 leading-relaxed">
                Il PIN può essere sigillato con Face ID tramite WebAuthn. La chiave AES è cifrata con la credenziale biometrica e salvata in localStorage. Solo una verifica biometrica positiva sblocca il wallet — il PIN non viene mai esposto in chiaro. Su iOS PWA e Android Chrome.
              </p>
            </div>
          </div>

          {/* Bottom strip */}
          <div className="mt-8 pt-6 border-t border-white/8 flex flex-wrap gap-4 text-[10px] text-white/25 font-mono uppercase tracking-widest">
            <span>BIP-39</span>
            <span>BIP-44 / BIP-84</span>
            <span>secp256k1</span>
            <span>P2WPKH SegWit</span>
            <span>AES-256-GCM</span>
            <span>WebAuthn</span>
            <span>try/finally zeroing</span>
            <span>563 test verdi</span>
          </div>
        </div>
      </div>
      {/* ═══════════════════════════════════════════════════════════════ */}

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
              <p className="text-sm md:text-base text-muted-foreground leading-relaxed mb-5">
                {pillar.desc}
              </p>
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
