import React from 'react';
import { Dialog as DefaultDialog } from './Dialog';

export interface LoginViewProps {
    config: any;
    setConfig: React.Dispatch<React.SetStateAction<any>>;
    rememberedUsers: any[];
    performLogin: (customConfig?: any) => Promise<void>;
    login: () => Promise<void>;
    resetLocalData: () => Promise<void>;
    autoLogin: boolean;
    setAutoLogin: React.Dispatch<React.SetStateAction<boolean>>;
    autoSync: boolean;
    setAutoSync: React.Dispatch<React.SetStateAction<boolean>>;
    useWebWorkers: boolean;
    setUseWebWorkers: React.Dispatch<React.SetStateAction<boolean>>;
    dialog: any;
    setDialog: React.Dispatch<React.SetStateAction<any>>;
    profileCache: Record<string, any>;
    DialogComponent?: React.ComponentType<{ dialog: any; setDialog: any; profileCache: any }>;
}

export const LoginView: React.FC<LoginViewProps> = ({
    config,
    setConfig,
    rememberedUsers,
    performLogin,
    login,
    resetLocalData,
    autoLogin,
    setAutoLogin,
    autoSync,
    setAutoSync,
    useWebWorkers,
    setUseWebWorkers,
    dialog,
    setDialog,
    profileCache,
    DialogComponent = DefaultDialog
}) => {
    return (
        <div className="container mt-5" style={{ maxWidth: '500px' }}>
            <div className="card p-4 shadow-sm border-0 mb-4">
                <h2 className="text-primary text-center fw-bold mb-4">Sovereign Social</h2>

                {rememberedUsers.length > 0 && (
                    <div className="mb-4">
                        <label className="form-label small fw-bold text-muted text-uppercase">Switch Account</label>
                        <div className="list-group">
                            {rememberedUsers.map(u => (
                                <button
                                    key={u.userId}
                                    className="list-group-item list-group-item-action d-flex align-items-center py-2"
                                    onClick={() => performLogin(u.config)}
                                >
                                    {u.avatar ? (
                                        <img src={u.avatar} alt={`${u.name || u.userId} avatar`} style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} className="me-2" />
                                    ) : (
                                        <div className="bg-secondary text-white rounded-circle d-flex align-items-center justify-content-center me-2" style={{ width: '32px', height: '32px' }}>
                                            {u.userId[0]?.toUpperCase() || '?'}
                                        </div>
                                    )}
                                    <div className="flex-grow-1 overflow-hidden">
                                        <div className="fw-bold text-truncate">
                                            {u.name}
                                            {u.config?.syncMode === 'webrtc' ? (
                                                <span className="badge bg-info ms-2 fw-normal" title="WebRTC Mesh (Local)">P2P Local</span>
                                            ) : u.config?.syncMode === 'peerjs' ? (
                                                <span className="badge bg-success ms-2 fw-normal" title="PeerJS (Global)">P2P Global</span>
                                            ) : (
                                                <span className="badge bg-secondary ms-2 fw-normal" title="S3 Cloud">S3</span>
                                            )}
                                        </div>
                                        <div className="x-small text-muted text-truncate">{u.userId}</div>
                                    </div>
                                    <span className="text-primary small">Login →</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Quick Start Card */}
                <div className="card bg-primary bg-opacity-10 border-primary border-opacity-25 p-3 mb-4 text-center rounded-3">
                    <div className="d-flex align-items-center justify-content-center mb-1">
                        <span className="fs-5 me-2" aria-hidden="true">🚀</span>
                        <span className="fw-bold" style={{ color: '#0952ba' }}>Instant Quick Start</span>
                    </div>
                    <p className="text-muted small mb-3">
                        Try Sovereign Social instantly with 1-click offline mode. Runs 100% locally in your browser using IndexedDB. No S3 or cloud credentials needed!
                    </p>
                    <button
                        type="button"
                        className="btn btn-primary w-100 py-2 fw-bold shadow-sm"
                        onClick={() => {
                            const guestConfig = {
                                ...config,
                                syncMode: 'offline',
                                userId: config.userId || ('guest-' + Math.random().toString(36).substring(7)),
                                password: config.password || 'password123'
                            };
                            performLogin(guestConfig);
                        }}
                    >
                        ⚡ Start Instantly (Offline Mode)
                    </button>
                </div>

                <div className="d-flex align-items-center my-3">
                    <hr className="flex-grow-1 my-0 text-muted" />
                    <span className="px-2 text-muted x-small text-uppercase fw-bold">Or Configure Workspace</span>
                    <hr className="flex-grow-1 my-0 text-muted" />
                </div>

                <div className="d-flex justify-content-between align-items-center mb-1">
                    <label className="form-label small fw-bold text-muted text-uppercase mb-0">Sync Mode</label>
                    <span className="badge bg-light text-muted border small">Select Architecture</span>
                </div>
                <div className="btn-group w-100 mb-3 flex-wrap">
                    <input type="radio" className="btn-check" name="syncMode" id="modeOffline" autoComplete="off" checked={config.syncMode === 'offline'} onChange={() => setConfig({ ...config, syncMode: 'offline' })} />
                    <label className="btn btn-outline-primary" htmlFor="modeOffline">Offline-First</label>

                    <input type="radio" className="btn-check" name="syncMode" id="modeS3" autoComplete="off" checked={config.syncMode === 's3'} onChange={() => setConfig({ ...config, syncMode: 's3' })} />
                    <label className="btn btn-outline-primary" htmlFor="modeS3">S3 Cloud</label>

                    <input type="radio" className="btn-check" name="syncMode" id="modeWebrtc" autoComplete="off" checked={config.syncMode === 'webrtc'} onChange={() => setConfig({ ...config, syncMode: 'webrtc' })} />
                    <label className="btn btn-outline-primary" htmlFor="modeWebrtc">WebRTC Mesh</label>
                </div>

                {config.syncMode === 'offline' && (
                    <div className="alert alert-info py-2 small mb-3">
                        <strong>Offline-First Mode:</strong> All data is stored securely in your browser's IndexedDB. You can connect to S3 cloud storage or P2P WebRTC at any time from the settings panel.
                    </div>
                )}

                {config.syncMode === 'webrtc' && (
                    <div className="alert alert-success py-2 small mb-3">
                        <strong>WebRTC P2P Mesh:</strong> Synchronizes directly between browser tabs and devices without storing data on any centralized server.
                    </div>
                )}

                {config.syncMode === 's3' && (
                    <div className="border rounded p-3 mb-3 bg-light">
                        <div className="d-flex justify-content-between align-items-center mb-2">
                            <label className="form-label small fw-bold text-muted text-uppercase mb-0">S3 Cloud Credentials</label>
                            <span className="badge bg-secondary small">Advanced</span>
                        </div>
                        <input className="form-control mb-2" placeholder="S3 Endpoint" aria-label="S3 Endpoint" value={config.endpoint} onChange={e => setConfig({ ...config, endpoint: e.target.value })} />
                        <input className="form-control mb-2" placeholder="Access Key" aria-label="S3 Access Key" value={config.accessKeyId} onChange={e => setConfig({ ...config, accessKeyId: e.target.value })} />
                        <input className="form-control mb-2" type="password" placeholder="Secret Key" aria-label="S3 Secret Access Key" value={config.secretAccessKey} onChange={e => setConfig({ ...config, secretAccessKey: e.target.value })} />
                        <input className="form-control mb-0" placeholder="Bucket Name" aria-label="S3 Bucket Name" value={config.bucketName} onChange={e => setConfig({ ...config, bucketName: e.target.value })} />
                    </div>
                )}

                <label className="form-label small fw-bold text-muted text-uppercase">Account Credentials</label>
                <input className="form-control mb-2" placeholder="User ID" aria-label="Account User ID" value={config.userId} onChange={e => setConfig({ ...config, userId: e.target.value })} />
                <input className="form-control mb-3" type="password" placeholder="Password" aria-label="Account Password" value={config.password} onChange={e => setConfig({ ...config, password: e.target.value })} />

                <div className="form-check mb-2">
                    <input className="form-check-input" type="checkbox" id="autoLogin" checked={autoLogin} onChange={e => { setAutoLogin(e.target.checked); localStorage.setItem('sov_auto_login', e.target.checked.toString()); }} />
                    <label className="form-check-label small" htmlFor="autoLogin">Auto-login next time</label>
                </div>

                <div className="form-check mb-2">
                    <input className="form-check-input" type="checkbox" id="autoSyncCheck" checked={autoSync} onChange={e => { setAutoSync(e.target.checked); localStorage.setItem('sov_auto_sync', e.target.checked.toString()); }} />
                    <label className="form-check-label small" htmlFor="autoSyncCheck">Enable Background Sync (60s)</label>
                </div>

                <div className="form-check mb-4">
                    <input className="form-check-input" type="checkbox" id="useWebWorkers" checked={useWebWorkers} onChange={e => { setUseWebWorkers(e.target.checked); localStorage.setItem('sov_use_workers', e.target.checked.toString()); }} />
                    <label className="form-check-label small" htmlFor="useWebWorkers">Use Web Workers (Performance)</label>
                </div>

                <button className="btn btn-sov w-100 py-2 fs-5 mb-3" onClick={login}>Log In</button>

                <div className="text-center mt-3">
                    <button className="btn btn-link btn-sm text-danger text-decoration-none" onClick={resetLocalData}>Reset Local Data</button>
                </div>
            </div>
            <DialogComponent dialog={dialog} setDialog={setDialog} profileCache={profileCache} />
        </div>
    );
};
