/**
 * ErrorBoundary — catches render errors and shows a fallback instead of crashing.
 * Use around payment bubbles / modals to prevent the "black screen" effect.
 */

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}
interface State { hasError: boolean; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Log silently — don't surface to user
    console.error("[ErrorBoundary]", error, info.componentStack?.slice(0, 300));
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}
