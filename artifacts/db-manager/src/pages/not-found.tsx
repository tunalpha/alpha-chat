import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground">
      <h1 className="text-4xl font-bold mb-4">404</h1>
      <p className="text-muted-foreground mb-8">Pagina non trovata</p>
      <Link href="/" className="px-4 py-2 bg-secondary rounded-md hover:bg-secondary/80 transition-colors">
        Torna alla home
      </Link>
    </div>
  );
}