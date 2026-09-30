import React from 'react';

export interface SyncStatusIndicatorProps {
  /** Whether a synchronization operation is currently in progress */
  syncing: boolean;
  /** Timestamp of the last successful sync */
  lastSync?: Date | string | number | null;
  /** Current synchronization mode (e.g. 's3', 'offline', 'webrtc') */
  syncMode?: string;
  /** Connection state */
  isConnected?: boolean;
  /** Optional error message from the last sync attempt */
  error?: string | null;
  /** Number of pending local changes waiting to be pushed */
  pendingCount?: number;
  /** Callback to trigger a manual sync */
  onSync?: () => void | Promise<void>;
  /** Render compact badge without verbose text */
  compact?: boolean;
  /** Additional CSS class names */
  className?: string;
  /** Custom inline style */
  style?: React.CSSProperties;
}

function formatRelativeTime(dateInput?: Date | string | number | null): string {
  if (!dateInput) return 'Never';
  const date = typeof dateInput === 'object' && dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(date.getTime())) return 'Never';

  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 10) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const SyncStatusIndicator: React.FC<SyncStatusIndicatorProps> = ({
  syncing,
  lastSync,
  syncMode = 's3',
  isConnected = true,
  error,
  pendingCount = 0,
  onSync,
  compact = false,
  className = '',
  style,
}) => {
  const isOffline = syncMode === 'offline' || !isConnected;

  let statusColor = '#198754'; // green
  let statusText = 'Synced';

  if (syncing) {
    statusColor = '#0d6efd'; // blue
    statusText = 'Syncing...';
  } else if (error) {
    statusColor = '#dc3545'; // red
    statusText = 'Sync Error';
  } else if (isOffline) {
    statusColor = '#996500'; // dark amber
    statusText = 'Offline';
  }

  const containerStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: compact ? '4px 8px' : '6px 12px',
    backgroundColor: 'var(--sov-surface, #ffffff)',
    border: '1px solid var(--sov-border, #dee2e6)',
    borderRadius: 'var(--sov-radius-pill, 9999px)',
    fontSize: '0.8125rem',
    color: 'var(--sov-text, #212529)',
    boxShadow: 'var(--sov-shadow-sm, 0 1px 2px rgba(0,0,0,0.05))',
    ...style,
  };

  const dotStyle: React.CSSProperties = {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: statusColor,
    flexShrink: 0,
    animation: syncing ? 'sov-pulse 1.2s infinite ease-in-out' : 'none',
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Sync status: ${statusText}`}
      className={`sov-sync-status ${className}`.trim()}
      style={containerStyle}
    >
      <span style={dotStyle} aria-hidden="true" />

      <span style={{ fontWeight: 600 }}>{statusText}</span>

      {!compact && (
        <>
          <span
            style={{
              padding: '2px 6px',
              borderRadius: '4px',
              backgroundColor: 'var(--sov-border-subtle, #e9ecef)',
              fontSize: '0.7rem',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {syncMode}
          </span>

          <span
            style={{ color: 'var(--sov-text-muted, #595959)' }}
            title={lastSync ? new Date(lastSync).toLocaleString() : 'Never synced'}
          >
            {syncing ? 'in progress' : formatRelativeTime(lastSync)}
          </span>

          {pendingCount > 0 && (
            <span
              style={{
                backgroundColor: 'var(--sov-warning-bg, #fff3cd)',
                color: 'var(--sov-warning, #996500)',
                padding: '2px 6px',
                borderRadius: '4px',
                fontWeight: 600,
                fontSize: '0.7rem',
              }}
              title={`${pendingCount} pending local changes`}
            >
              +{pendingCount}
            </span>
          )}
        </>
      )}

      {onSync && !compact && (
        <button
          type="button"
          onClick={() => onSync()}
          disabled={syncing}
          aria-label="Trigger manual synchronization"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--sov-primary, #1260cc)',
            cursor: syncing ? 'not-allowed' : 'pointer',
            padding: '2px 4px',
            borderRadius: '4px',
            fontWeight: 600,
            fontSize: '0.75rem',
            opacity: syncing ? 0.6 : 1,
            textDecoration: 'underline',
          }}
        >
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
      )}
    </div>
  );
};
