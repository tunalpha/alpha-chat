import React from 'react';

export default function ArchitectureSection({ dict }: { dict: any }) {
  return (
    <section>
      <div className="flex items-center gap-4 mb-12">
        <div className="h-px bg-primary/50 w-12" />
        <h2 className="text-sm uppercase tracking-[0.2em] text-primary font-semibold">{dict.architecture.title}</h2>
      </div>

      <p className="text-2xl text-foreground/90 font-light mb-16 max-w-2xl leading-snug">
        {dict.architecture.subtitle}
      </p>

      {/* Architecture Diagram */}
      <div className="bg-background/80 border border-border rounded-3xl p-8 md:p-12 relative overflow-hidden">
        {/* Decorative Grid */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDQwIEwgNDAgNDAgNDAgMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMDUpIiBzdHJva2Utd2lkdGg9IjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-50" />
        
        <div className="relative z-10 flex flex-col gap-8">
          {/* Top Level: Clients & Blockchain */}
          <div className="flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="w-full md:w-64 bg-muted/20 border border-border rounded-xl p-6 text-center backdrop-blur-md">
              <div className="text-foreground font-medium mb-1">{dict.architecture.labels.clients}</div>
              <div className="text-xs text-muted-foreground font-mono">PWA / Web / Desktop</div>
            </div>

            <div className="w-full md:w-64 bg-[#8247E5]/10 border border-[#8247E5]/30 rounded-xl p-6 text-center backdrop-blur-md">
              <div className="text-[#8247E5] font-medium mb-1">{dict.architecture.labels.blockchain}</div>
              <div className="text-xs text-[#8247E5]/70 font-mono">Polygon ERC-20 (USDA)</div>
            </div>
          </div>

          {/* Connectors Down */}
          <div className="flex flex-col md:flex-row justify-between items-center gap-8 px-32 hidden md:flex">
            <div className="w-px h-8 bg-gradient-to-b from-border to-primary/50" />
            <div className="w-px h-8 bg-gradient-to-b from-[#8247E5]/30 to-primary/50" />
          </div>

          {/* Middle Level: E2E */}
          <div className="w-full bg-primary/20 border border-primary/40 rounded-xl p-6 text-center backdrop-blur-md shadow-[0_0_30px_rgba(168,85,247,0.15)] relative">
            <div className="absolute -left-2 -right-2 top-1/2 -translate-y-1/2 h-px bg-primary/50 blur-[2px]" />
            <div className="relative z-10">
              <div className="text-primary font-semibold text-lg mb-1">{dict.architecture.labels.e2e}</div>
              <div className="text-sm text-primary/70 font-mono">X3DH • Double Ratchet • AES-256-GCM</div>
            </div>
          </div>

          {/* Connectors Down */}
          <div className="flex justify-center hidden md:flex">
            <div className="w-px h-8 bg-gradient-to-b from-primary/50 to-border" />
          </div>

          {/* Bottom Level: Backend & DB */}
          <div className="flex flex-col md:flex-row justify-center items-center gap-8">
            <div className="w-full md:w-72 bg-muted/20 border border-border rounded-xl p-6 text-center backdrop-blur-md">
              <div className="text-foreground font-medium mb-1">{dict.architecture.labels.backend}</div>
              <div className="text-xs text-muted-foreground font-mono">Blind Relays (No Plaintext)</div>
            </div>

            <div className="hidden md:block w-8 h-px bg-border" />

            <div className="w-full md:w-72 bg-muted/20 border border-border rounded-xl p-6 text-center backdrop-blur-md">
              <div className="text-foreground font-medium mb-1">{dict.architecture.labels.db}</div>
              <div className="text-xs text-muted-foreground font-mono">Encrypted Blobs & Metadata</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}