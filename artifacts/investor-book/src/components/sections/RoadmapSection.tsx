import React from 'react';

const statusStyle: Record<string, { dot: string; label: string; name: string }> = {
  complete: {
    dot: 'bg-primary shadow-[0_0_10px_rgba(168,85,247,0.8)]',
    label: '',
    name: 'text-primary',
  },
  active: {
    dot: 'bg-primary/80 ring-2 ring-primary/40 ring-offset-1 ring-offset-background animate-pulse',
    label: 'bg-primary/20 text-primary border border-primary/40',
    name: 'text-primary',
  },
  upcoming: {
    dot: 'bg-muted-foreground/30 border border-border',
    label: '',
    name: 'text-foreground',
  },
};

export default function RoadmapSection({ dict }: { dict: any }) {
  return (
    <section>
      <div className="text-center mb-16 space-y-4">
        <h2 className="text-4xl md:text-5xl font-serif text-foreground">{dict.roadmap.title}</h2>
        {dict.roadmap.subtitle && (
          <p className="text-xl text-primary font-light">{dict.roadmap.subtitle}</p>
        )}
      </div>

      <div className="relative border-l border-border ml-4 md:ml-6 space-y-12 pb-8">
        {dict.roadmap.phases.map((phase: any, i: number) => {
          const status: string = phase.status ?? (i === 0 ? 'complete' : 'upcoming');
          const styles = statusStyle[status] ?? statusStyle.upcoming;

          return (
            <div key={i} className="relative pl-8 md:pl-12">
              {/* Timeline Dot */}
              <div className={`absolute -left-[5px] top-2 w-[10px] h-[10px] rounded-full ${styles.dot}`} />

              <div className="flex flex-wrap items-center gap-3 mb-3">
                <h3 className={`text-xl font-medium ${styles.name}`}>{phase.name}</h3>
                {status === 'active' && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${styles.label}`}>
                    In Progress
                  </span>
                )}
              </div>

              <p className="text-muted-foreground leading-relaxed max-w-2xl">
                {phase.desc}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
