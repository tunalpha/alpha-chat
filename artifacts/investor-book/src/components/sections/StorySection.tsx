import React from 'react';

export default function StorySection({ dict }: { dict: any }) {
  return (
    <section>
      <div className="text-center mb-16 space-y-4">
        <h2 className="text-4xl md:text-5xl font-serif text-foreground">{dict.story.title}</h2>
        <p className="text-xl text-muted-foreground font-light">{dict.story.subtitle}</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {dict.story.sections.map((item: any, i: number) => (
          <div 
            key={i} 
            className="p-8 border border-border bg-muted/10 rounded-2xl hover:bg-muted/30 transition-colors group"
          >
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-mono text-sm mb-6 group-hover:bg-primary group-hover:text-foreground transition-colors">
              0{i + 1}
            </div>
            <h3 className="text-xl text-foreground font-medium mb-3">{item.title}</h3>
            <p className="text-muted-foreground leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}