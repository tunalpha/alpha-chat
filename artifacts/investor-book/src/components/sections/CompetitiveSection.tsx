import React from 'react';

export default function CompetitiveSection({ dict }: { dict: any }) {
  return (
    <section>
      <div className="text-center mb-16 space-y-4">
        <h2 className="text-4xl md:text-5xl font-serif text-foreground">{dict.competitive.title}</h2>
        <p className="text-xl text-muted-foreground font-light">{dict.competitive.subtitle}</p>
      </div>

      <div className="space-y-24">
        {/* Messaging Table */}
        <div className="space-y-6">
          <h3 className="text-2xl font-serif text-foreground">{dict.competitive.messaging.title}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr>
                  {dict.competitive.messaging.columns.map((col: string, i: number) => (
                    <th key={i} className="pb-4 border-b border-border text-sm font-medium text-muted-foreground uppercase tracking-wider">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {dict.competitive.messaging.rows.map((row: any, i: number) => (
                  <tr key={i} className={`hover:bg-muted/20 transition-colors ${row.name === 'AlphaChat' ? 'bg-primary/5' : ''}`}>
                    <td className={`py-5 font-medium ${row.name === 'AlphaChat' ? 'text-primary' : 'text-foreground'}`}>
                      {row.name}
                    </td>
                    <td className="py-5 text-sm text-foreground/80">{row.e2e}</td>
                    <td className="py-5 text-sm text-foreground/80">{row.ind}</td>
                    <td className="py-5 text-sm text-foreground/80">{row.pay}</td>
                    <td className="py-5 text-sm text-foreground/80">{row.rec}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Payments Table */}
        <div className="space-y-6">
          <h3 className="text-2xl font-serif text-foreground">{dict.competitive.payments.title}</h3>
          <p className="text-muted-foreground leading-relaxed max-w-3xl">{dict.competitive.payments.desc}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr>
                  {dict.competitive.payments.columns.map((col: string, i: number) => (
                    <th key={i} className="pb-4 border-b border-border text-sm font-medium text-muted-foreground uppercase tracking-wider pr-6">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {dict.competitive.payments.rows.map((row: any, i: number) => (
                  <tr key={i} className={`hover:bg-muted/20 transition-colors ${i === 0 ? 'bg-primary/5' : ''}`}>
                    <td className={`py-5 font-medium pr-6 ${i === 0 ? 'text-primary' : 'text-foreground'}`}>{row.name}</td>
                    <td className="py-5 text-sm text-foreground/80 pr-6">{row.surface}</td>
                    <td className="py-5 text-sm text-foreground/80 pr-6">{row.rail}</td>
                    <td className="py-5 text-sm text-foreground/80">{row.rel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Stablecoins Table */}
        <div className="space-y-6">
          <h3 className="text-2xl font-serif text-foreground">{dict.competitive.stablecoins.title}</h3>
          <p className="text-muted-foreground leading-relaxed max-w-3xl">{dict.competitive.stablecoins.desc}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr>
                  {dict.competitive.stablecoins.columns.map((col: string, i: number) => (
                    <th key={i} className="pb-4 border-b border-border text-sm font-medium text-muted-foreground uppercase tracking-wider pr-6">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {dict.competitive.stablecoins.rows.map((row: any, i: number) => (
                  <tr key={i} className={`hover:bg-muted/20 transition-colors ${row.name === 'USDA' ? 'bg-primary/5' : ''}`}>
                    <td className={`py-5 font-medium pr-6 ${row.name === 'USDA' ? 'text-primary' : 'text-foreground'}`}>{row.name}</td>
                    <td className="py-5 text-sm text-foreground/80 pr-6">{row.peg}</td>
                    <td className="py-5 text-sm text-foreground/80 pr-6">{row.role}</td>
                    <td className="py-5 text-sm text-foreground/80">{row.pos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}