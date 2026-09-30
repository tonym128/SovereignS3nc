import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number; // ms, default 4000, 0 = sticky
}

export interface ToastContextValue {
  toasts: ToastMessage[];
  showToast: (toast: Omit<ToastMessage, 'id'> & { id?: string }) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
  success: (message: string, title?: string) => string;
  error: (message: string, title?: string) => string;
  warning: (message: string, title?: string) => string;
  info: (message: string, title?: string) => string;
}

// Global Event Emitter for toasts outside React tree
type ToastListener = (toasts: ToastMessage[]) => void;
class ToastManager {
  private activeToasts: ToastMessage[] = [];
  private listeners: Set<ToastListener> = new Set();
  private timerHandles: Map<string, any> = new Map();

  public subscribe(listener: ToastListener): () => void {
    this.listeners.add(listener);
    listener([...this.activeToasts]);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener([...this.activeToasts]);
    }
  }

  public show(toast: Omit<ToastMessage, 'id'> & { id?: string }): string {
    const id = toast.id || `toast-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const fullToast: ToastMessage = {
      id,
      duration: toast.duration ?? 4000,
      ...toast,
    };
    this.activeToasts = [...this.activeToasts, fullToast];
    this.notify();

    if (fullToast.duration && fullToast.duration > 0) {
      const handle = setTimeout(() => {
        this.dismiss(id);
      }, fullToast.duration);
      this.timerHandles.set(id, handle);
    }
    return id;
  }

  public dismiss(id: string) {
    const handle = this.timerHandles.get(id);
    if (handle) {
      clearTimeout(handle);
      this.timerHandles.delete(id);
    }
    this.activeToasts = this.activeToasts.filter((t) => t.id !== id);
    this.notify();
  }

  public clear() {
    for (const handle of this.timerHandles.values()) {
      clearTimeout(handle);
    }
    this.timerHandles.clear();
    this.activeToasts = [];
    this.notify();
  }

  public success(message: string, title = 'Success'): string {
    return this.show({ type: 'success', title, message });
  }

  public error(message: string, title = 'Error'): string {
    return this.show({ type: 'error', title, message, duration: 6000 });
  }

  public warning(message: string, title = 'Warning'): string {
    return this.show({ type: 'warning', title, message });
  }

  public info(message: string, title = 'Info'): string {
    return this.show({ type: 'info', title, message });
  }
}

export const toast = new ToastManager();

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    return toast.subscribe(setToasts);
  }, []);

  const showToast = useCallback((t: Omit<ToastMessage, 'id'> & { id?: string }) => toast.show(t), []);
  const dismissToast = useCallback((id: string) => toast.dismiss(id), []);
  const clearToasts = useCallback(() => toast.clear(), []);
  const success = useCallback((msg: string, title?: string) => toast.success(msg, title), []);
  const error = useCallback((msg: string, title?: string) => toast.error(msg, title), []);
  const warning = useCallback((msg: string, title?: string) => toast.warning(msg, title), []);
  const info = useCallback((msg: string, title?: string) => toast.info(msg, title), []);

  const value: ToastContextValue = {
    toasts,
    showToast,
    dismissToast,
    clearToasts,
    success,
    error,
    warning,
    info,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Graceful fallback to global toast manager if used outside provider
    return {
      toasts: [],
      showToast: (t) => toast.show(t),
      dismissToast: (id) => toast.dismiss(id),
      clearToasts: () => toast.clear(),
      success: (msg, title) => toast.success(msg, title),
      error: (msg, title) => toast.error(msg, title),
      warning: (msg, title) => toast.warning(msg, title),
      info: (msg, title) => toast.info(msg, title),
    };
  }
  return ctx;
};

export interface ToastContainerProps {
  toasts?: ToastMessage[];
  onDismiss?: (id: string) => void;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

const TYPE_CONFIG: Record<ToastType, { border: string; bg: string; icon: string; text: string }> = {
  success: { border: 'var(--sov-success, #198754)', bg: 'var(--sov-surface, #ffffff)', icon: '✓', text: 'var(--sov-success, #198754)' },
  error: { border: 'var(--sov-danger, #dc3545)', bg: 'var(--sov-surface, #ffffff)', icon: '✕', text: 'var(--sov-danger, #dc3545)' },
  warning: { border: 'var(--sov-warning, #996500)', bg: 'var(--sov-surface, #ffffff)', icon: '⚠', text: 'var(--sov-warning, #996500)' },
  info: { border: 'var(--sov-info, #0d6efd)', bg: 'var(--sov-surface, #ffffff)', icon: 'ℹ', text: 'var(--sov-info, #0d6efd)' },
};

export const ToastContainer: React.FC<ToastContainerProps> = ({
  toasts: propToasts,
  onDismiss,
  position = 'bottom-right',
}) => {
  const [internalToasts, setInternalToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    if (propToasts === undefined) {
      return toast.subscribe(setInternalToasts);
    }
  }, [propToasts]);

  const activeList = propToasts !== undefined ? propToasts : internalToasts;
  const handleDismiss = onDismiss || ((id: string) => toast.dismiss(id));

  if (activeList.length === 0) return null;

  const positionStyles: Record<string, React.CSSProperties> = {
    'top-right': { top: '20px', right: '20px' },
    'top-left': { top: '20px', left: '20px' },
    'bottom-right': { bottom: '20px', right: '20px' },
    'bottom-left': { bottom: '20px', left: '20px' },
  };

  return (
    <div
      role="region"
      aria-label="Notifications"
      style={{
        position: 'fixed',
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        maxWidth: '380px',
        width: 'calc(100vw - 40px)',
        pointerEvents: 'none',
        ...positionStyles[position],
      }}
    >
      {activeList.map((t) => {
        const conf = TYPE_CONFIG[t.type] || TYPE_CONFIG.info;
        const role = t.type === 'error' ? 'alert' : 'status';

        return (
          <div
            key={t.id}
            role={role}
            aria-live={t.type === 'error' ? 'assertive' : 'polite'}
            style={{
              pointerEvents: 'auto',
              backgroundColor: conf.bg,
              color: 'var(--sov-text, #212529)',
              borderLeft: `5px solid ${conf.border}`,
              borderTop: '1px solid var(--sov-border, #dee2e6)',
              borderRight: '1px solid var(--sov-border, #dee2e6)',
              borderBottom: '1px solid var(--sov-border, #dee2e6)',
              borderRadius: 'var(--sov-radius-md, 8px)',
              padding: '12px 16px',
              boxShadow: 'var(--sov-shadow-md, 0 4px 6px -1px rgba(0,0,0,0.1))',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              transition: 'all 200ms ease',
            }}
          >
            <span
              style={{
                color: conf.text,
                fontWeight: 'bold',
                fontSize: '1rem',
                lineHeight: 1.2,
                flexShrink: 0,
              }}
              aria-hidden="true"
            >
              {conf.icon}
            </span>

            <div style={{ flex: 1, minWidth: 0 }}>
              {t.title && (
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: '0.875rem',
                    marginBottom: '2px',
                    color: 'var(--sov-text, #212529)',
                  }}
                >
                  {t.title}
                </div>
              )}
              <div
                style={{
                  fontSize: '0.8125rem',
                  color: 'var(--sov-text-muted, #595959)',
                  lineHeight: 1.4,
                  wordBreak: 'break-word',
                }}
              >
                {t.message}
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleDismiss(t.id)}
              aria-label="Dismiss notification"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--sov-text-muted, #595959)',
                cursor: 'pointer',
                fontSize: '1rem',
                lineHeight: 1,
                padding: '2px 4px',
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
};
