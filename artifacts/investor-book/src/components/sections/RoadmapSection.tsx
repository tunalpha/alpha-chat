import React from 'react';

export default function RoadmapSection({ dict }: { dict: any }) {
  return (
    <section>
      <div className="flex items-center gap-4 mb-16">
        <div className="h-px bg-primary/50 w-12" />
        <h2 className="text-sm uppercase tracking-[0.2em] text-primary font-semibold">{dict.roadmap.title}</h2>
      </div>

      <div className="relative border-l border-white/10 ml-4 md:ml-6 space-y-12 pb-8">
        {dict.roadmap.phases.map((phase: any, i: number) => (
          <div key={i} className="relative pl-8 md:pl-12">
            {/* Timeline Dot */}
            <div className={`absolute -left-[5px] top-1.5 w-[9px] h-[9px] rounded-full ${i === 0 ? 'bg-primary shadow-[0_0_10px_rgba(168,85,247,0.8)]' : 'bg-white/20 border border-white/30'}`} />
            
            <h3 className={`text-xl font-medium mb-3 ${i === 0 ? 'text-primary' : 'text-white'}`}>
              {phase.name}
            </h3>
            <p className="text-muted-foreground leading-relaxed max-w-xl">
              {phase.desc}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}