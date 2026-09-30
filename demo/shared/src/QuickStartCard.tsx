import React from 'react';

export interface QuickStartCardProps {
  /** Card title */
  title?: string;
  /** Subtitle or headline */
  subtitle?: string;
  /** Explanatory description */
  description?: string;
  /** Key bullet points highlighting offline-first benefits */
  features?: string[];
  /** Button label */
  buttonText?: string;
  /** Callback fired when user clicks the quick start action */
  onLaunch: () => void;
  /** Disabled state */
  disabled?: boolean;
  /** Optional badge text */
  badgeText?: string;
  /** Additional CSS class names */
  className?: string;
  /** Custom inline style */
  style?: React.CSSProperties;
}

export const QuickStartCard: React.FC<QuickStartCardProps> = ({
  title = '⚡ Quick Start (Offline Mode)',
  subtitle = 'Instant local sandbox — zero credentials required',
  description = 'Experience the full offline-first capabilities immediately in your browser. All data is encrypted locally using IndexedDB and can be synced to S3 or paired with other peers at any time.',
  features = [
    'Zero AWS/S3 setup or credentials needed',
    'Instant local AES-256-GCM + X25519 encryption',
    'Connect to S3 or peer devices whenever you are ready',
  ],
  buttonText = 'Launch Offline Demo',
  onLaunch,
  disabled = false,
  badgeText = 'Recommended for First-Time Users',
  className = '',
  style,
}) => {
  return (
    <div
      className={`sov-quick-start-card ${className}`.trim()}
      style={{
        backgroundColor: 'var(--sov-surface, #ffffff)',
        border: '1.5px solid var(--sov-primary, #1260cc)',
        borderRadius: 'var(--sov-radius-lg, 12px)',
        padding: '24px',
        boxShadow: 'var(--sov-shadow-md, 0 4px 6px -1px rgba(0,0,0,0.1))',
        position: 'relative',
        ...style,
      }}
    >
      {badgeText && (
        <span
          style={{
            position: 'absolute',
            top: '-12px',
            right: '20px',
            backgroundColor: 'var(--sov-primary, #1260cc)',
            color: '#ffffff',
            padding: '3px 10px',
            borderRadius: 'var(--sov-radius-pill, 9999px)',
            fontSize: '0.725rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          {badgeText}
        </span>
      )}

      <h3
        style={{
          margin: '0 0 6px 0',
          fontSize: '1.25rem',
          fontWeight: 700,
          color: 'var(--sov-text, #212529)',
        }}
      >
        {title}
      </h3>

      {subtitle && (
        <p
          style={{
            margin: '0 0 12px 0',
            fontSize: '0.875rem',
            color: 'var(--sov-primary, #1260cc)',
            fontWeight: 600,
          }}
        >
          {subtitle}
        </p>
      )}

      {description && (
        <p
          style={{
            margin: '0 0 16px 0',
            fontSize: '0.875rem',
            color: 'var(--sov-text-muted, #595959)',
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      )}

      {features && features.length > 0 && (
        <ul
          style={{
            margin: '0 0 20px 0',
            paddingLeft: '20px',
            fontSize: '0.85rem',
            color: 'var(--sov-text, #212529)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          {features.map((feat, idx) => (
            <li key={idx}>{feat}</li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onLaunch}
        disabled={disabled}
        aria-label={buttonText}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          padding: '12px 20px',
          backgroundColor: 'var(--sov-primary, #1260cc)',
          color: '#ffffff',
          border: 'none',
          borderRadius: 'var(--sov-radius-md, 8px)',
          fontWeight: 700,
          fontSize: '0.95rem',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          transition: 'var(--sov-transition-fast, 150ms ease)',
        }}
      >
        {buttonText}
      </button>
    </div>
  );
};
