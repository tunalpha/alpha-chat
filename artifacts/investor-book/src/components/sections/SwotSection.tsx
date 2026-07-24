import React from 'react';

export default function SwotSection({ dict }: { dict: any }) {
  const quadrants = [
    { key: 's', color: 'border-primary/40 bg-primary/5' },
    { key: 'w', color: 'border-border bg-muted/20' },
    { key: 'o', color: 'border-border bg-muted/20' },
    { key: 't', color: 'border-border bg-muted/20' },
  ];

  return (
    <section>
      <div className="text-center mb-16">
        <h2 className="text-4xl md:text-5xl font-serif text-foreground">{dict.swot.title}</h2>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {quadrants.map((quad, i) => {
          const data = dict.swot[quad.key];
          return (
            <div key={i} className={`p-8 border rounded-2xl ${quad.color}`}>
              <h3 className="text-xl font-serif text-foreground mb-6 uppercase tracking-widest">{data.title}</h3>
              <ul className="space-y-3">
                {data.items.map((item: string, j: number) => (
                  <li key={j} className="flex items-start text-muted-foreground text-sm">
                    <span className="mr-3 text-primary mt-0.5">•</span>
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}