import React from 'react';
import { UserAvatar } from './MediaAndUser';
import { ProfileModule } from '../../../../src/modules/Profile';

export interface NavigationProps {
    config: any;
    currentTab: 'feed' | 'friends' | 'messages' | 'rooms' | 'profile' | 'admin' | 'mesh';
    setCurrentTab: (tab: 'feed' | 'friends' | 'messages' | 'rooms' | 'profile' | 'admin' | 'mesh') => void;
    unreadCounts: { feed: number; friends: number; messages: number; rooms: number };
    isAdmin: boolean;
    isConnected: boolean;
    toggleConnection: () => void;
    meshStats: { connectedPeers: number };
    setShowPairing: (show: boolean) => void;
    sync: (manual?: boolean) => Promise<void>;
    syncing: boolean;
    logout: () => void;
    handleConnectRemote: () => void;
    profileModule: ProfileModule | null;
    lastSyncTime?: string | null;
    profileCache: Record<string, any>;
    setProfileCache: React.Dispatch<React.SetStateAction<Record<string, any>>>;
}

export const Navigation: React.FC<NavigationProps> = ({
    config,
    currentTab,
    setCurrentTab,
    unreadCounts,
    isAdmin,
    isConnected,
    toggleConnection,
    meshStats,
    setShowPairing,
    sync,
    syncing,
    logout,
    handleConnectRemote,
    profileModule,
    lastSyncTime,
    profileCache,
    setProfileCache
}) => {
    return (
        <>
            <nav className="navbar navbar-expand-lg navbar-light bg-white shadow-sm sticky-top px-3">
                <a className="navbar-brand text-primary fw-bold fs-3" href="#">
                    sov
                    {config.syncMode === 'webrtc' ? (
                        <span className="badge bg-info ms-2 fs-6 align-middle fw-normal" title="WebRTC Mesh (Local)">P2P Local</span>
                    ) : config.syncMode === 'peerjs' ? (
                        <span className="badge bg-success ms-2 fs-6 align-middle fw-normal" title="PeerJS (Global)">P2P Global</span>
                    ) : (
                        <span className="badge bg-secondary ms-2 fs-6 align-middle fw-normal" title="S3 Cloud">S3</span>
                    )}
                </a>
                <div className="mx-auto d-flex align-items-center mobile-hide">
                    <button data-testid="nav-home" className={`btn mx-2 position-relative ${currentTab === 'feed' ? 'btn-light text-primary' : ''}`} onClick={() => setCurrentTab('feed')}>
                        Home
                        {unreadCounts.feed > 0 && <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">{unreadCounts.feed}</span>}
                    </button>
                    <button data-testid="nav-friends" className={`btn mx-2 position-relative ${currentTab === 'friends' ? 'btn-light text-primary' : ''}`} onClick={() => setCurrentTab('friends')}>
                        Friends
                        {unreadCounts.friends > 0 && <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">{unreadCounts.friends}</span>}
                    </button>
                    <button data-testid="nav-messages" className={`btn mx-2 position-relative ${currentTab === 'messages' ? 'btn-light text-primary' : ''}`} onClick={() => setCurrentTab('messages')}>
                        Messages
                        {unreadCounts.messages > 0 && <span data-testid="unread-badge" className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">{unreadCounts.messages}</span>}
                    </button>
                    <button data-testid="nav-rooms" className={`btn mx-2 position-relative ${currentTab === 'rooms' ? 'btn-light text-primary' : ''}`} onClick={() => setCurrentTab('rooms')}>
                        Rooms
                        {unreadCounts.rooms > 0 && <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">{unreadCounts.rooms}</span>}
                    </button>
                    <button data-testid="nav-profile" className={`btn mx-2 ${currentTab === 'profile' ? 'btn-light text-primary' : ''}`} onClick={() => setCurrentTab('profile')}>
                        Profile
                    </button>
                    <button data-testid="nav-mesh" className={`btn mx-2 ${currentTab === 'mesh' ? 'btn-light text-primary' : ''}`} onClick={() => setCurrentTab('mesh')}>
                        Mesh
                    </button>
                    {isAdmin && (
                        <button data-testid="nav-admin" className={`btn mx-2 ${currentTab === 'admin' ? 'btn-light text-primary' : ''}`} onClick={() => setCurrentTab('admin')}>
                            Admin
                        </button>
                    )}
                </div>
                <div className="d-flex align-items-center">
                    {!isConnected && (
                        <span className="badge bg-secondary rounded-pill me-2">Offline Mode</span>
                    )}
                    {config.syncMode === 'offline' && (
                        <button className="btn btn-sm btn-primary rounded-pill me-2 mobile-hide" onClick={handleConnectRemote}>
                            <i className="bi bi-cloud-upload me-1"></i> Connect Remote
                        </button>
                    )}
                    <button
                        className={`btn btn-link px-2 me-1 d-flex align-items-center gap-1 text-decoration-none ${isConnected ? 'text-success' : 'text-danger'}`}
                        onClick={toggleConnection}
                        title={isConnected ? 'Connected' : 'Disconnected'}
                    >
                        <i className={`bi ${isConnected ? 'bi-cloud-check-fill' : 'bi-cloud-slash-fill'}`} style={{ fontSize: '1.2rem' }}></i>
                        {isConnected && (config.syncMode === 'webrtc' || config.syncMode === 'peerjs') && (
                            <span className="small fw-bold mobile-hide">
                                {meshStats.connectedPeers} peers
                            </span>
                        )}
                    </button>

                    {config.enableP2PPairing && (config.syncMode === 'webrtc' || config.syncMode === 'peerjs') && (
                        <button
                            className="btn btn-sm btn-outline-primary rounded-pill me-2"
                            onClick={() => setShowPairing(true)}
                            title="Direct QR Pair"
                        >
                            <i className="bi bi-qr-code-scan"></i> <span className="mobile-hide">Pair</span>
                        </button>
                    )}
                    <div className="d-flex align-items-center">
                        <UserAvatar
                            userId={config.userId}
                            size={32}
                            profileModule={profileModule}
                            lastSyncTime={lastSyncTime}
                            profileCache={profileCache}
                            setProfileCache={setProfileCache}
                        />
                    </div>

                    <button className="btn btn-sm btn-outline-secondary ms-2 p-1 px-2 rounded-circle d-md-none" onClick={() => sync(true)} disabled={syncing || config.syncMode === 'offline'} title="Sync Now">
                        <i className={`bi bi-arrow-repeat ${syncing ? 'spin' : ''}`}></i>
                    </button>

                    <button className="btn btn-sm btn-outline-secondary ms-2 mobile-hide" onClick={() => sync(true)} disabled={syncing || config.syncMode === 'offline'}>
                        {syncing ? '...' : config.syncMode === 'offline' ? 'Offline' : 'Sync'}
                    </button>
                    <button className="btn btn-sm btn-outline-danger ms-2 mobile-hide" onClick={logout}>Logout</button>
                </div>
            </nav>

            <div className="bottom-nav d-md-none">
                <a href="#" className={`bottom-nav-item ${currentTab === 'feed' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setCurrentTab('feed'); }}>
                    <i className="bi bi-house"></i>
                    <span>Home</span>
                    {unreadCounts.feed > 0 && <span className="badge rounded-pill bg-danger">{unreadCounts.feed}</span>}
                </a>
                <a href="#" className={`bottom-nav-item ${currentTab === 'friends' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setCurrentTab('friends'); }}>
                    <i className="bi bi-people"></i>
                    <span>Friends</span>
                    {unreadCounts.friends > 0 && <span className="badge rounded-pill bg-danger">{unreadCounts.friends}</span>}
                </a>
                <a href="#" className={`bottom-nav-item ${currentTab === 'messages' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setCurrentTab('messages'); }}>
                    <i className="bi bi-chat-dots"></i>
                    <span>Chat</span>
                    {unreadCounts.messages > 0 && <span className="badge rounded-pill bg-danger">{unreadCounts.messages}</span>}
                </a>
                <a href="#" className={`bottom-nav-item ${currentTab === 'rooms' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setCurrentTab('rooms'); }}>
                    <i className="bi bi-grid"></i>
                    <span>Rooms</span>
                    {unreadCounts.rooms > 0 && <span className="badge rounded-pill bg-danger">{unreadCounts.rooms}</span>}
                </a>
                <a href="#" className={`bottom-nav-item ${currentTab === 'profile' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setCurrentTab('profile'); }}>
                    <i className="bi bi-person"></i>
                    <span>Profile</span>
                </a>
                <a href="#" className={`bottom-nav-item ${currentTab === 'mesh' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setCurrentTab('mesh'); }}>
                    <i className="bi bi-node-plus"></i>
                    <span>Mesh</span>
                </a>
                {isAdmin && (
                    <a href="#" className={`bottom-nav-item ${currentTab === 'admin' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setCurrentTab('admin'); }}>
                        <i className="bi bi-shield-lock"></i>
                        <span>Admin</span>
                    </a>
                )}
            </div>
        </>
    );
};
