/**
 * ErrorBoundary — cattura crash React e mostra un messaggio leggibile
 * invece di una pagina completamente bianca.
 */
import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props  { children: ReactNode; }
interface State  { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AdminPanel] ErrorBoundary caught:", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-8">
          <div className="max-w-md w-full space-y-4 text-center">
            <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7 text-red-600" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">
              Errore imprevisto
            </h2>
            <p className="text-sm text-muted-foreground">
              La pagina ha incontrato un errore. Torna alla dashboard e riprova.
            </p>
            {this.state.error && (
              <pre className="text-xs text-left bg-muted rounded-lg p-3 overflow-auto max-h-32 text-muted-foreground">
                {this.state.error.message}
              </pre>
            )}
            <Button onClick={this.handleReset} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              Torna alla dashboard
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
