import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
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
      if (this.fallback) return this.fallback;
      return (
        <div className="container mt-5">
          <div className="card shadow-lg border-0 rounded-4 overflow-hidden">
            <div className="card-body p-5 text-center">
              <div className="display-1 text-danger mb-4">
                <i className="bi bi-exclamation-octagon"></i>
              </div>
              <h2 className="fw-bold mb-3">Something went wrong</h2>
              <p className="text-secondary mb-4">
                An unexpected error occurred. You can try refreshing the page or clearing your local data.
              </p>
              {this.state.error && (
                <div className="alert alert-light border small text-start mb-4">
                  <pre className="mb-0" style={{ whiteSpace: 'pre-wrap' }}>
                    {this.state.error.message}
                  </pre>
                </div>
              )}
              <div className="d-flex justify-content-center gap-3">
                <button 
                  className="btn btn-primary rounded-pill px-4"
                  onClick={() => window.location.reload()}
                >
                  Refresh Page
                </button>
                <button 
                  className="btn btn-outline-danger rounded-pill px-4"
                  onClick={() => {
                    if (window.confirm('This will delete all local data. Are you sure?')) {
                      localStorage.clear();
                      window.location.reload();
                    }
                  }}
                >
                  Reset App
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
