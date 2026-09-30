import React, { useEffect, useRef, useId } from 'react';

export interface ModalDialogProps {
  /** Controls visibility */
  isOpen: boolean;
  /** Invoked when user requests closing (Esc, backdrop click, or close button) */
  onClose: () => void;
  /** Modal header title */
  title?: React.ReactNode;
  /** Modal body content */
  children?: React.ReactNode;
  /** Optional modal footer actions */
  footer?: React.ReactNode;
  /** Max-width size preset */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Close dialog on Escape key press (default: true) */
  closeOnEscape?: boolean;
  /** Close dialog when backdrop is clicked (default: true) */
  closeOnBackdropClick?: boolean;
  /** Custom accessible label if title is omitted */
  ariaLabel?: string;
  /** Element ID */
  id?: string;
  /** Additional CSS class names */
  className?: string;
}

const SIZE_MAP: Record<string, string> = {
  sm: '400px',
  md: '550px',
  lg: '750px',
  xl: '960px',
};

export const ModalDialog: React.FC<ModalDialogProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  closeOnEscape = true,
  closeOnBackdropClick = true,
  ariaLabel,
  id,
  className = '',
}) => {
  const generatedId = useId();
  const dialogId = id || `sov-dialog-${generatedId}`;
  const titleId = `${dialogId}-title`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedElementRef.current = document.activeElement as HTMLElement | null;

    // Focus the dialog container or first interactive element
    if (dialogRef.current) {
      dialogRef.current.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeOnEscape) {
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocusedElementRef.current && previouslyFocusedElementRef.current.focus) {
        previouslyFocusedElementRef.current.focus();
      }
    };
  }, [isOpen, closeOnEscape, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="sov-modal-backdrop"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1050,
        padding: '16px',
        boxSizing: 'border-box',
      }}
      onClick={(e) => {
        if (closeOnBackdropClick && e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel || 'Dialog' : undefined}
        tabIndex={-1}
        id={dialogId}
        className={`sov-modal-dialog ${className}`.trim()}
        style={{
          backgroundColor: 'var(--sov-surface, #ffffff)',
          color: 'var(--sov-text, #212529)',
          borderRadius: 'var(--sov-radius-lg, 12px)',
          border: '1px solid var(--sov-border, #dee2e6)',
          boxShadow: 'var(--sov-shadow-lg, 0 10px 15px -3px rgba(0,0,0,0.1))',
          width: '100%',
          maxWidth: SIZE_MAP[size] || SIZE_MAP.md,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
          position: 'relative',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--sov-border, #dee2e6)',
          }}
        >
          {title && (
            <h2
              id={titleId}
              style={{
                margin: 0,
                fontSize: '1.25rem',
                fontWeight: 600,
                color: 'var(--sov-text, #212529)',
              }}
            >
              {title}
            </h2>
          )}
          {!title && <div />}

          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '1.25rem',
              lineHeight: 1,
              color: 'var(--sov-text-muted, #595959)',
              cursor: 'pointer',
              padding: '6px 8px',
              borderRadius: 'var(--sov-radius-sm, 4px)',
            }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div
          style={{
            padding: '20px',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '10px',
              padding: '14px 20px',
              borderTop: '1px solid var(--sov-border, #dee2e6)',
              backgroundColor: 'var(--sov-surface-elevated, #fafafa)',
              borderBottomLeftRadius: 'var(--sov-radius-lg, 12px)',
              borderBottomRightRadius: 'var(--sov-radius-lg, 12px)',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
