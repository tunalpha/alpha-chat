import React from 'react';

// Simple inline SVG bar chart
function BarChart({ bars }: { bars: { label: string; value: number; color: string; suffix?: string }[] }) {
  const max = Math.max(...bars.map(b => b.value));
  return (
    <div className="space-y-3 w-full">
      {bars.map((bar, i) => (
        <div key={i} className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{bar.label}</span>
            <span className="font-semibold" style={{ color: bar.color }}>
              {bar.value}{bar.suffix ?? ''}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${(bar.value / max) * 100}%`, background: bar.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// TAM/SAM/SOM funnel
function MarketFunnel({ tam, sam, som, currency }: { tam: string; sam: string; som: string; currency: string }) {
  return (
    <div className="space-y-2 w-full max-w-xs mx-auto">
      {[
        { label: 'TAM', value: tam, pct: 100, color: '#a855f7' },
        { label: 'SAM', value: sam, pct: 45, color: '#8b5cf6' },
        { label: 'SOM', value: som, pct: 18, color: '#7c3aed' },
      ].map((tier, i) => (
        <div key={i} className="flex items-center gap-3">
          <div
            className="h-10 rounded-lg flex items-center justify-center transition-all"
            style={{ width: `${tier.pct}%`, background: `${tier.color}25`, border: `1px solid ${tier.color}60` }}
          >
            <span className="text-xs font-bold" style={{ color: tier.color }}>{tier.label}</span>
          </div>
          <span className="text-sm font-semibold text-foreground whitespace-nowrap">{currency}{tier.value}</span>
        </div>
      ))}
    </div>
  );
}

const colorMap: Record<string, { border: string; text: string; dot: string; accent: string }> = {
  purple: { border: 'border-primary/30', text: 'text-primary', dot: 'bg-primary', accent: '#a855f7' },
  green: { border: 'border-emerald-500/30', text: 'text-emerald-400', dot: 'bg-emerald-400', accent: '#34d399' },
  blue: { border: 'border-blue-500/30', text: 'text-blue-400', dot: 'bg-blue-400', accent: '#60a5fa' },
};

const growthData = {
  messaging: [
    { label: 'WhatsApp', value: 2000, color: '#a855f7', suffix: 'M' },
    { label: 'Telegram', value: 900, color: '#8b5cf6', suffix: 'M' },
    { label: 'Signal', value: 40, color: '#7c3aed', suffix: 'M' },
    { label: 'AlphaChat', value: 12, color: '#6d28d9', suffix: 'M users by 2036' },
  ],
  stablecoins: [
    { label: 'USDT', value: 115, color: '#34d399', suffix: 'B' },
    { label: 'USDC', value: 35, color: '#10b981', suffix: 'B' },
    { label: 'DAI', value: 5, color: '#059669', suffix: 'B' },
    { label: 'USDA', value: 0.5, color: '#047857', suffix: 'B' },
  ],
  payments: [
    { label: 'Market 2024', value: 14, color: '#60a5fa', suffix: 'T' },
    { label: 'Market 2027', value: 20, color: '#3b82f6', suffix: 'T est.' },
    { label: 'Market 2030', value: 29, color: '#2563eb', suffix: 'T proj.' },
    { label: 'Crypto gateways', value: 2, color: '#1d4ed8', suffix: 'T' },
  ],
};

export default function MarketSection({ dict }: { dict: any }) {
  const m = dict.market;
  const lang = dict.nav?.readIt === 'IT' ? 'en' : 'it'; // detect lang
  const isIT = dict.nav?.download === 'Scarica PDF';

  const funnelLabels = {
    messaging: isIT
      ? { tam: '340B', sam: '85B', som: '2B', label: 'Messaggistica (2030)' }
      : { tam: '$340B', sam: '$85B', som: '$2B', label: 'Messaging (2030)' },
    stablecoins: { tam: '$2T', sam: '$400B', som: '$10B', label: 'Stablecoins' },
    payments: { tam: '$29T', sam: '$4T', som: '$200B', label: isIT ? 'Pagamenti Digitali (2030)' : 'Digital Payments (2030)' },
  };

  const chartData = [growthData.messaging, growthData.stablecoins, growthData.payments];
  const chartKeys = ['messaging', 'stablecoins', 'payments'] as const;

  return (
    <section>
      {/* Header */}
      <div className="text-center mb-16 space-y-4">
        <h2 className="text-4xl md:text-5xl font-serif text-foreground">{m.title}</h2>
        <p className="text-xl text-primary font-light">{m.subtitle}</p>
        <p className="text-lg text-muted-foreground font-light max-w-2xl mx-auto">{m.intro}</p>
      </div>

      {/* Big stat cards */}
      <div className="grid md:grid-cols-3 gap-4 mb-16">
        {m.segments.map((seg: any, i: number) => {
          const c = colorMap[seg.color] ?? colorMap.purple;
          return (
            <div key={i} className={`rounded-2xl border ${c.border} bg-muted/10 p-6 text-center`}>
              <div className="text-4xl mb-3">{seg.icon}</div>
              <div className={`text-4xl font-serif font-bold ${c.text} leading-none mb-1`}>{seg.stat}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-widest mb-2">{seg.unit}</div>
              <div className={`text-sm font-semibold ${c.text}`}>{seg.label}</div>
            </div>
          );
        })}
      </div>

      {/* Charts row */}
      <div className="grid md:grid-cols-3 gap-6 mb-16">
        {chartKeys.map((key, i) => {
          const seg = m.segments[i];
          const c = colorMap[seg.color] ?? colorMap.purple;
          const fl = funnelLabels[key];
          return (
            <div key={key} className={`rounded-2xl border ${c.border} bg-muted/5 p-6 space-y-6`}>
              {/* TAM/SAM/SOM */}
              <div>
                <div className={`text-xs font-semibold ${c.text} uppercase tracking-widest mb-3`}>
                  {isIT ? 'Mercato Indirizzabile' : 'Addressable Market'}
                </div>
                <MarketFunnel
                  tam={fl.tam.replace('$', '').replace('B','B').replace('T','T')}
                  sam={fl.sam.replace('$', '')}
                  som={fl.som.replace('$', '')}
                  currency={fl.tam.startsWith('$') ? '$' : ''}
                />
              </div>
              {/* Growth bar chart */}
              <div>
                <div className={`text-xs font-semibold ${c.text} uppercase tracking-widest mb-3`}>
                  {isIT ? 'Player di Mercato' : 'Market Players'}
                </div>
                <BarChart bars={chartData[i]} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Key stats strip */}
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center mb-6">
          {[
            { v: '420M+', l: isIT ? 'Utenti Crypto' : 'Crypto Users' },
            { v: '$10.8T', l: isIT ? 'Vol. Stablecoin/Anno' : 'Stablecoin Vol/Year' },
            { v: '16.5%', l: isIT ? 'CAGR Gateway Crypto' : 'Crypto Gateway CAGR' },
            { v: '60%', l: isIT ? 'Gen Z preferisce instant pay' : 'Gen Z prefers instant pay' },
          ].map((s, i) => (
            <div key={i}>
              <div className="text-2xl md:text-3xl font-serif font-bold text-primary">{s.v}</div>
              <div className="text-xs text-muted-foreground mt-1">{s.l}</div>
            </div>
          ))}
        </div>
        <p className="text-sm md:text-base text-foreground/80 leading-relaxed text-center font-light max-w-3xl mx-auto border-t border-primary/20 pt-6">
          {m.conclusion}
        </p>
      </div>
    </section>
  );
}
