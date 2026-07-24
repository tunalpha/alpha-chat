import React from 'react';

export default function LetterSection({ dict }: { dict: any }) {
  return (
    <section className="relative">
      <div className="absolute -left-12 top-0 text-9xl font-serif text-foreground/[0.03] select-none pointer-events-none">
        "
      </div>
      
      <div className="max-w-3xl mx-auto">
        <h2 className="text-sm uppercase tracking-[0.2em] text-primary font-semibold mb-12 text-center">
          {dict.founderLetter.title}
        </h2>
        
        <div className="space-y-8 font-serif text-lg md:text-xl text-foreground/80 leading-relaxed">
          <p className="font-semibold text-foreground">{dict.founderLetter.greeting}</p>
          
          {dict.founderLetter.paragraphs.map((p: string, i: number) => {
            const isHighlight = p.includes("same space") || p.includes("stesso spazio");
            return (
              <p 
                key={i} 
                className={isHighlight ? "text-2xl text-foreground font-medium my-12 border-l-2 border-primary pl-6" : ""}
              >
                {p}
              </p>
            );
          })}
        </div>
      </div>
    </section>
  );
}