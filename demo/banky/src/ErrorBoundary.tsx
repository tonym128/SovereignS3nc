import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="container mt-5">
          <div className="card shadow-lg border-0 rounded-4">
            <div className="card-body p-5 text-center">
              <h2 className="fw-bold mb-3">Banky Error</h2>
              <p className="text-secondary mb-4">
                Something went wrong with the banking dashboard.
              </p>
              <div className="d-flex justify-content-center gap-3">
                <button className="btn btn-primary px-4" onClick={() => window.location.reload()}>
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
