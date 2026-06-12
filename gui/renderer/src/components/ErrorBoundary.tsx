import React from 'react';

type Props = { children: React.ReactNode };
type State = { error: Error | null; retryKey: number };

/** Catches render-time errors (including useQuery fetch failures re-thrown
 *  during render) so one broken screen doesn't blank the whole app. Remounts
 *  with its key, so navigating resets it. */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '24px' }}>
          <p className="warn">Something went wrong loading this screen.</p>
          <p className="dim">{this.state.error.message}</p>
          <button onClick={() => this.setState((s) => ({ error: null, retryKey: s.retryKey + 1 }))}>Retry</button>
        </div>
      );
    }
    // Keyed fragment: retry remounts children so stale hook state (e.g. the
    // thrown useQuery error) doesn't immediately re-throw.
    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}
