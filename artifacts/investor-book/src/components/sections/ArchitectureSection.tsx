import React from 'react';

export default function ArchitectureSection({ dict }: { dict: any }) {
  const d = dict.architecture;
  const layers: Array<{ name: string; detail: string }> = d?.layers ?? [];

  const layerColors = [
    { border: 'border-violet-500/30', bg: 'bg-violet-500/6', dot: 'bg-violet-400', label: 'text-violet-300' },
    { border: 'border-primary/40',    bg: 'bg-primary/10',   dot: 'bg-primary',    label: 'text-primary'  },
    { border: 'border-slate-500/30',  bg: 'bg-slate-500/6',  dot: 'bg-slate-400',  label: 'text-slate-300' },
    { border: 'border-sky-500/30',    bg: 'bg-sky-500/6',    dot: 'bg-sky-400',    label: 'text-sky-300'  },
    { border: 'border-emerald-500/30',bg: 'bg-emerald-500/6',dot: 'bg-emerald-400',label: 'text-emerald-300'},
  ];

  return (
    <section>
      <div className="flex items-center gap-4 mb-12">
        <div className="h-px bg-primary/50 w-12" />
        <h2 className="text-sm uppercase tracking-[0.2em] text-primary font-semibold">{d.title}</h2>
      </div>

      <p className="text-2xl text-foreground/90 font-light mb-16 max-w-2xl leading-snug">
        {d.subtitle}
      </p>

      {/* Architecture layers diagram */}
      <div className="bg-background/80 border border-border rounded-3xl p-8 md:p-12 relative overflow-hidden">
        {/* Grid bg */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDQwIEwgNDAgNDAgNDAgMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMDQpIiBzdHJva2Utd2lkdGg9IjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-50" />

        <div className="relative z-10 flex flex-col gap-4">
          {layers.map((layer, i) => {
            const c = layerColors[i % layerColors.length];
            const isMiddle = i === 1; // Signal layer — glows more
            return (
              <React.Fragment key={i}>
                <div className={`relative w-full rounded-xl border ${c.border} ${c.bg} px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 backdrop-blur-md ${isMiddle ? 'shadow-[0_0_30px_rgba(168,85,247,0.15)]' : ''}`}>
                  <div className={`flex items-center gap-2 flex-shrink-0 min-w-[160px]`}>
                    <div className={`w-2 h-2 rounded-full ${c.dot} ${isMiddle ? 'shadow-[0_0_8px_rgba(168,85,247,0.9)] animate-pulse' : ''}`} />
                    <span className={`font-semibold text-sm ${c.label}`}>{layer.name}</span>
                  </div>
                  <div className="h-px w-full bg-white/5 hidden sm:block" />
                  <span className="text-xs text-muted-foreground font-mono">{layer.detail}</span>
                </div>

                {/* Connector arrow */}
                {i < layers.length - 1 && (
                  <div className="flex justify-center">
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="w-px h-3 bg-gradient-to-b from-primary/40 to-primary/20" />
                      <svg width="10" height="6" viewBox="0 0 10 6" className="text-primary/30">
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

      {/* Zero-knowledge callout */}
      <div className="mt-8 rounded-2xl border border-primary/25 bg-primary/5 px-7 py-5 flex gap-4 items-start">
        <span className="text-xl flex-shrink-0">🔒</span>
        <div>
          <div className="text-sm font-semibold text-primary mb-1">Zero Plaintext Guarantee</div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {dict.nav?.download === 'Scarica PDF'
              ? 'Il server non ha mai accesso al contenuto in chiaro dei messaggi in nessun code path — né in RAM, né su disco. MongoDB archivia ciphertext opachi. R2 archivia blob AES-GCM. Il WebSocket instrada senza ispezionare.'
              : 'The server never has access to message plaintext in any code path — neither in RAM nor on disk. MongoDB stores opaque ciphertext. R2 stores AES-GCM blobs. WebSocket routes without inspecting.'
            }
          </p>
        </div>
      </div>
    </section>
  );
}
