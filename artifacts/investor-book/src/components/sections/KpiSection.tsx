import React from 'react';

const kpis = [
  { value: 'E2E', label: 'Encrypted by Default', sub: 'Signal Protocol' },
  { value: 'X3DH', label: 'Key Exchange', sub: 'Double Ratchet' },
  { value: '256', label: 'Bit AES-GCM', sub: 'Media Encryption' },
  { value: '10', label: 'Languages', sub: 'Localized PWA' },
  { value: 'L2', label: 'Polygon Network', sub: '< 2s Settlement' },
  { value: 'PWA', label: 'Cross-Platform', sub: 'No App Store needed' },
];

export default function KpiSection({ dict }: { dict: any }) {
  return (
    <section>
      <div className="text-center mb-12 space-y-2">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/5 mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-semibold text-primary tracking-widest uppercase">
            {dict.lang === 'it' ? 'Specifiche Tecniche' : 'Technical Specifications'}
          </span>
        </div>
        <h2 className="text-4xl md:text-5xl font-serif text-foreground">
          {dict.lang === 'it' ? 'Costruito per resistere' : 'Built to Last'}
        </h2>
        <p className="text-lg text-muted-foreground font-light max-w-xl mx-auto">
          {dict.lang === 'it'
            ? 'Ogni componente è stato scelto per massima sicurezza, scalabilità e sovranità dell\'utente.'
            : 'Every component chosen for maximum security, scalability, and user sovereignty.'}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {kpis.map((kpi, i) => (
          <div
            key={i}
            className="relative rounded-2xl border border-border bg-muted/10 p-6 text-center overflow-hidden group hover:border-primary/40 hover:bg-primary/5 transition-all duration-300"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="relative z-10">
              <div className="text-4xl md:text-5xl font-serif font-bold text-primary mb-2 drop-shadow-[0_0_20px_rgba(168,85,247,0.4)]">
                {kpi.value}
              </div>
              <div className="text-sm font-semibold text-foreground">{kpi.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{kpi.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
