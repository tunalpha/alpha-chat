import React from 'react';

/* ─── small inline SVG: lightning bolt ─────────────────────────────────── */
const BoltIcon = ({ size = 16, className = '' }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
  </svg>
);

/* ─── BOLT11 flow steps ─────────────────────────────────────────────────── */
const flowColors = [
  { border: 'border-violet-500/40', bg: 'bg-violet-500/10', dot: 'bg-violet-400', text: 'text-violet-300' },
  { border: 'border-primary/40',    bg: 'bg-primary/10',    dot: 'bg-primary',    text: 'text-primary'   },
  { border: 'border-amber-500/40',  bg: 'bg-amber-500/10',  dot: 'bg-amber-400',  text: 'text-amber-300' },
  { border: 'border-emerald-500/40',bg: 'bg-emerald-500/10',dot: 'bg-emerald-400',text: 'text-emerald-300'},
];

export default function LightningSection({ dict }: { dict: any }) {
  const d = dict.lightning;

  return (
    <section className="relative rounded-3xl overflow-hidden">
      {/* ── Dark gradient background ── */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#060112] via-[#0c0525] to-[#09031a]" />
      {/* Amber/gold glow top-right (Lightning brand colour) */}
      <div className="absolute top-0 right-0 w-[450px] h-[450px] bg-amber-500/8 blur-[110px] rounded-full pointer-events-none" />
      {/* Violet glow bottom-left */}
      <div className="absolute bottom-0 left-0 w-[320px] h-[320px] bg-violet-600/10 blur-[90px] rounded-full pointer-events-none" />
      {/* Border */}
      <div className="absolute inset-0 rounded-3xl border border-amber-500/20 pointer-events-none" />

      <div className="relative z-10 p-8 md:p-14">

        {/* ── Header ── */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 mb-5 px-3 py-1 rounded-full bg-amber-500/12 border border-amber-500/30">
            <BoltIcon size={12} className="text-amber-400" />
            <span className="text-xs font-semibold text-amber-300 tracking-widest uppercase">
              Bitcoin Lightning · Breez SDK Spark
            </span>
          </div>
          <h2 className="text-4xl md:text-5xl font-serif text-white mb-3">{d.title}</h2>
          <p className="text-xl text-amber-300/80 font-light">{d.subtitle}</p>
        </div>

        {/* ── Lead ── */}
        <p className="text-base md:text-lg text-white/60 leading-relaxed max-w-2xl mb-12 border-l-2 border-amber-500/35 pl-5">
          {d.desc}
        </p>

        {/* ── Network architecture diagram ── */}
        <h3 className="text-xs uppercase tracking-[0.2em] text-amber-400/60 font-semibold mb-6">
          {d.architectureTitle}
        </h3>

        <div className="mb-12 bg-black/30 border border-white/6 rounded-2xl p-6 md:p-8 relative overflow-hidden">
          {/* subtle grid */}
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDQwIEwgNDAgNDAgNDAgMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMDMpIiBzdHJva2Utd2lkdGg9IjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-50" />
          <div className="relative z-10 flex flex-col gap-3">
            {d.architectureLayers.map((layer: any, i: number) => {
              const c = flowColors[i % flowColors.length];
              const isLightning = i === 1;
              return (
                <React.Fragment key={i}>
                  <div className={`rounded-xl border ${c.border} ${c.bg} px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 ${isLightning ? 'shadow-[0_0_24px_rgba(245,158,11,0.12)]' : ''}`}>
                    <div className="flex items-center gap-2 flex-shrink-0 min-w-[170px]">
                      <div className={`w-2 h-2 rounded-full ${c.dot} ${isLightning ? 'animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.9)]' : ''}`} />
                      <span className={`font-semibold text-sm ${c.text}`}>{layer.name}</span>
                    </div>
                    <div className="h-px w-full bg-white/5 hidden sm:block" />
                    <span className="text-xs text-white/40 font-mono">{layer.detail}</span>
                  </div>
                  {i < d.architectureLayers.length - 1 && (
                    <div className="flex justify-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="w-px h-3 bg-gradient-to-b from-amber-500/30 to-amber-500/10" />
                        <svg width="10" height="6" viewBox="0 0 10 6" className="text-amber-500/25">
                          <path d="M0 0L5 6L10 0" fill="currentColor" />
                        </svg>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* ── BOLT11 payment flow ── */}
        <h3 className="text-xs uppercase tracking-[0.2em] text-amber-400/60 font-semibold mb-6">
          {d.bolt11Title}
        </h3>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-12">
          {d.bolt11Steps.map((step: any, i: number) => {
            const c = flowColors[i % flowColors.length];
            return (
              <div key={i} className={`rounded-2xl border ${c.border} ${c.bg} p-5 flex flex-col gap-3`}>
                <div className="flex items-center justify-between">
                  <span className={`font-mono text-[10px] uppercase tracking-widest ${c.text} opacity-70`}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="text-lg">{step.icon}</span>
                </div>
                <div className={`font-semibold text-sm text-white`}>{step.name}</div>
                <p className="text-xs text-white/45 leading-relaxed">{step.desc}</p>
              </div>
            );
          })}
        </div>

        {/* ── Spark SDK technical pillars ── */}
        <h3 className="text-xs uppercase tracking-[0.2em] text-amber-400/60 font-semibold mb-5">
          {d.sparkTitle}
        </h3>

        <div className="grid sm:grid-cols-2 gap-4 mb-12">
          {d.sparkFeatures.map((feat: any, i: number) => (
            <div
              key={i}
              className="bg-white/4 border border-white/7 rounded-2xl p-5 hover:border-amber-500/25 hover:bg-amber-500/5 transition-all duration-300 group"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <h4 className="text-white font-semibold text-sm leading-snug group-hover:text-amber-300/90 transition-colors">
                  {feat.title}
                </h4>
                <span className="flex-shrink-0 text-[10px] font-mono bg-amber-500/10 text-amber-400/80 border border-amber-500/20 px-2 py-0.5 rounded-full whitespace-nowrap">
                  {feat.spec}
                </span>
              </div>
              <p className="text-xs text-white/48 leading-relaxed">{feat.desc}</p>
            </div>
          ))}
        </div>

        {/* ── Lightning vs On-chain comparison ── */}
        <h3 className="text-xs uppercase tracking-[0.2em] text-amber-400/60 font-semibold mb-5">
          {d.comparisonTitle}
        </h3>

        <div className="grid sm:grid-cols-2 gap-4 mb-12">
          {/* Lightning */}
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/6 p-6">
            <div className="flex items-center gap-2 mb-4">
              <BoltIcon size={14} className="text-amber-400" />
              <span className="text-sm font-semibold text-amber-300">⚡ Lightning</span>
            </div>
            <ul className="space-y-2">
              {d.comparisonLightning.map((point: string, i: number) => (
                <li key={i} className="flex items-start gap-2 text-xs text-white/55 leading-relaxed">
                  <span className="text-amber-400 mt-0.5 flex-shrink-0">✓</span>
                  {point}
                </li>
              ))}
            </ul>
          </div>

          {/* On-chain */}
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">⛓️</span>
              <span className="text-sm font-semibold text-primary/90">{d.comparisonOnchainLabel}</span>
            </div>
            <ul className="space-y-2">
              {d.comparisonOnchain.map((point: string, i: number) => (
                <li key={i} className="flex items-start gap-2 text-xs text-white/55 leading-relaxed">
                  <span className="text-primary/70 mt-0.5 flex-shrink-0">✓</span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ── Callout: WASM isolation ── */}
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-6 py-5 flex gap-4 items-start mb-10">
          <span className="text-xl flex-shrink-0">🔒</span>
          <div>
            <div className="text-sm font-semibold text-amber-300 mb-1">{d.wasmCalloutTitle}</div>
            <p className="text-sm text-white/50 leading-relaxed">{d.wasmCalloutDesc}</p>
          </div>
        </div>

        {/* ── Bottom spec strip ── */}
        <div className="pt-8 border-t border-white/6 flex flex-wrap gap-6 text-xs text-white/28 font-mono uppercase tracking-widest">
          <span>Bitcoin Lightning</span>
          <span>BOLT11</span>
          <span>HTLC</span>
          <span>Breez SDK Spark</span>
          <span>WASM Threads</span>
          <span>COOP / COEP</span>
          <span>crossOriginIsolated</span>
          <span>IDB alpha-lightning-v1</span>
          <span>expirySecs 3600</span>
        </div>
      </div>
    </section>
  );
}
