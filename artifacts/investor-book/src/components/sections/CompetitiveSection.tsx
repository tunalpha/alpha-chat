import React from 'react';

function Table({ columns, rows, highlightCol, highlightFields, keyField }: {
  columns: string[];
  rows: any[];
  highlightCol?: string;
  highlightFields?: string[];
  keyField?: string;
}) {
  const keys = highlightFields ?? [];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse" style={{ minWidth: '640px' }}>
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th key={i} className="pb-4 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider pr-5">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((row: any, i: number) => {
            const isAlpha = row.name === highlightCol || i === 0;
            return (
              <tr key={i} className={`transition-colors ${isAlpha ? 'bg-primary/6' : 'hover:bg-muted/15'}`}>
                {Object.values(row).map((val: any, j: number) => (
                  <td
                    key={j}
                    className={`py-4 pr-5 text-sm leading-snug align-top
                      ${isAlpha && j === 0 ? 'text-primary font-semibold' : ''}
                      ${!isAlpha && j === 0 ? 'text-foreground font-medium' : ''}
                      ${j > 0 ? (isAlpha ? 'text-foreground/75' : 'text-muted-foreground') : ''}
                      ${String(val).startsWith('✓') ? 'text-emerald-400' : ''}
                      ${String(val).startsWith('✗') ? 'text-red-400/70' : ''}
                    `}
                  >
                    {String(val)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function CompetitiveSection({ dict }: { dict: any }) {
  const c = dict.competitive;

  return (
    <section>
      <div className="text-center mb-16 space-y-4">
        <h2 className="text-4xl md:text-5xl font-serif text-foreground">{c.title}</h2>
        <p className="text-xl text-muted-foreground font-light max-w-2xl mx-auto">{c.subtitle}</p>
      </div>

      <div className="space-y-20">
        {/* Messaging */}
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="h-px bg-border flex-1" />
            <h3 className="text-base font-semibold text-foreground whitespace-nowrap">{c.messaging.title}</h3>
            <div className="h-px bg-border flex-1" />
          </div>
          <Table
            columns={c.messaging.columns}
            rows={c.messaging.rows}
            highlightCol="AlphaChat"
          />
        </div>

        {/* Payments */}
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="h-px bg-border flex-1" />
            <h3 className="text-base font-semibold text-foreground whitespace-nowrap">{c.payments.title}</h3>
            <div className="h-px bg-border flex-1" />
          </div>
          {c.payments.desc && (
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">{c.payments.desc}</p>
          )}
          <Table
            columns={c.payments.columns}
            rows={c.payments.rows}
          />
        </div>

        {/* Stablecoins */}
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="h-px bg-border flex-1" />
            <h3 className="text-base font-semibold text-foreground whitespace-nowrap">{c.stablecoins.title}</h3>
            <div className="h-px bg-border flex-1" />
          </div>
          {c.stablecoins.desc && (
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">{c.stablecoins.desc}</p>
          )}
          <Table
            columns={c.stablecoins.columns}
            rows={c.stablecoins.rows}
            highlightCol="USDA"
          />
        </div>
      </div>
    </section>
  );
}
