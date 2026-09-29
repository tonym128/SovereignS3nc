import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { SovereignS3nc } from '../../../src/SovereignS3nc';
import { FeedModule, Post } from '../../../src/modules/Feed';
import { MessagingModule, Message } from '../../../src/modules/Messaging';
import { ProfileModule, Profile } from '../../../src/modules/Profile';
import { ModerationModule, Report } from '../../../src/modules/Moderation';
import { WebRTCRemoteAdapter } from '../../../src/adapters/WebRTCRemoteAdapter';
import { IRemoteAdapter, DownloadResult } from '../../../src/interfaces/IRemoteAdapter';
import crypto from 'crypto';
import { Buffer } from 'buffer';
import Peer from 'peerjs';

import { MediaUtils } from '../../../src/utils/MediaUtils';
import { PairingModal } from './PairingModal';
import { ErrorBoundary } from './ErrorBoundary';
import { InspectorModal } from './components/InspectorModal';
import { UserAvatar, UserName, BlobImage } from './components/MediaAndUser';
import { LoginView } from './components/LoginView';
import { Navigation } from './components/Navigation';
import { FeedTab } from './components/FeedTab';
import { FriendsTab } from './components/FriendsTab';
import { MessagesTab } from './components/MessagesTab';
import { RoomsTab } from './components/RoomsTab';
import { ProfileTab } from './components/ProfileTab';
import { MeshTab } from './components/MeshTab';
import { AdminTab } from './components/AdminTab';
import { ConflictResolutionModal } from './components/ConflictResolutionModal';
import { MemberManagementModal } from './components/MemberManagementModal';
import { Dialog } from './components/Dialog';
import { PostItem } from './components/PostItem';
import { SocialContext, SocialContextType } from './context/SocialContext';

const DEBUG = true;

// Proxy adapter to simulate S3 path isolation for WebRTC
class PrefixProxyAdapter implements IRemoteAdapter {
    constructor(private baseAdapter: WebRTCRemoteAdapter, private prefix: string) {}
    private getKey(path: string) { return `${this.prefix}/${path}`; }
    uploadFile(path: string, data: Uint8Array, hash?: string) { return this.baseAdapter.uploadFile(this.getKey(path), data, hash); }
    downloadFile(path: string, ifNoneMatch?: string, timeout?: number) { return this.baseAdapter.downloadFile(this.getKey(path), ifNoneMatch, timeout); }
    getFileHash(path: string) { return this.baseAdapter.getFileHash(this.getKey(path)); }
    getFileEtag(path: string) { return this.baseAdapter.getFileEtag(this.getKey(path)); }
}

const App = () => {
    const [config, setConfig] = useState({
        syncMode: 's3', // Default to s3 for existing tests
        region: 'ap-southeast-1',
        endpoint: '',
        accessKeyId: '',
        secretAccessKey: '',
        bucketName: '',
        appId: 'sov-social',
        userId: 'user-' + Math.random().toString(36).substring(7),
        password: 'password123',
        admins: [] as string[], // List of User IDs with admin privileges
        adminPublicKey: '', // Public key of the official admin
        enableP2PPairing: new URLSearchParams(window.location.search).has('pairing') // Enable QR code and Bluetooth pairing functionality
    });

    const [isAdmin, setIsAdmin] = useState(false);
    const [adminKeyPublished, setAdminKeyPublished] = useState(false);

    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const getStorageKey = (key: string) => `sov_${config.userId}_${key}`;

    const [autoLogin, setAutoLogin] = useState(localStorage.getItem('sov_auto_login') === 'true');
    const [autoSync, setAutoSync] = useState(localStorage.getItem('sov_auto_sync') !== 'false');
    const [showPairing, setShowPairing] = useState(false);
    const [showInspector, setShowInspector] = useState(() => new URLSearchParams(window.location.search).get('debug') === 'inspect');
    const [useWebWorkers, setUseWebWorkers] = useState(localStorage.getItem('sov_use_workers') !== 'false');
    const [rememberedUsers, setRememberedUsers] = useState<any[]>(() => {
        const saved = localStorage.getItem('sov_remembered_users');
        return saved ? JSON.parse(saved) : [];
    });
    
    const [profileCache, setProfileCache] = useState<Record<string, any>>({});
    const [blobCache, setBlobCache] = useState<Record<string, string>>({});
    const [lastViewed, setLastViewed] = useState<Record<string, any>>({ feed: Date.now(), friends: Date.now(), messages: Date.now(), rooms: Date.now(), chat: {}, roomChat: {} });
    const [highlights, setHighlights] = useState<Record<string, number>>({ feed: 0, friends: 0 });
    const [discoveryMap, setDiscoveryMap] = useState<Record<string, number>>({});

    const [sov, setSov] = useState<SovereignS3nc | null>(null);
    const [feed, setFeed] = useState<FeedModule | null>(null);
    const [messaging, setMessaging] = useState<MessagingModule | null>(null);
    const [profileModule, setProfileModule] = useState<ProfileModule | null>(null);
    const [moderation, setModeration] = useState<ModerationModule | null>(null);
    const [reports, setReports] = useState<Report[]>([]);
    const [previewPost, setPreviewPost] = useState<Post | null>(null);
    const [posts, setPosts] = useState<Post[]>([]);
    const [following, setFollowing] = useState<any[]>([]);
    const [allUsers, setAllUsers] = useState<any[]>([]);
    const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
    const [newPost, setNewPost] = useState('');
    const [newImage, setNewPostImage] = useState<Uint8Array | null>(null);
    const [newImagePreview, setNewImagePreview] = useState<string | null>(null);
    const [msgImage, setMsgImage] = useState<Uint8Array | null>(null);
    const [msgImagePreview, setMsgImagePreview] = useState<string | null>(null);
    const postFileRef = useRef<HTMLInputElement>(null);
    const msgFileRef = useRef<HTMLInputElement>(null);
    const [profile, setProfile] = useState<any>(null);
    const [syncing, setSyncing] = useState(false);
    const [currentTab, setCurrentTab] = useState<'feed' | 'friends' | 'messages' | 'rooms' | 'profile' | 'admin'>('feed');
    const [messages, setMessages] = useState<Message[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [selectedGroup, setSelectedGroup] = useState<any | null>(null);
    const [groupPosts, setGroupPosts] = useState<Post[]>([]);
    const [groupInput, setGroupInput] = useState('');
    const [groupImage, setGroupImage] = useState<Uint8Array | null>(null);
    const [groupImagePreview, setGroupImagePreview] = useState<string | null>(null);
    const groupFileRef = useRef<HTMLInputElement>(null);
    const [msgInput, setMsgInput] = useState('');
    const [selectedUser, setSelectedUser] = useState<string | null>(null);
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [lookbackDays, setLookbackDays] = useState(5);
    const [isConnected, setIsConnected] = useState(true);
    const [manualDisconnect, setManualDisconnect] = useState(false);
    const [reconnectDelay, setReconnectDelay] = useState(1000);
    const [unreadCounts, setUnreadCounts] = useState({ feed: 0, friends: 0, messages: 0, rooms: 0 });
    const [userUnreadCounts, setUserUnreadCounts] = useState<Record<string, number>>({});
    const [exportAllPosts, setExportAllPosts] = useState(false);
    const [meshStats, setMeshStats] = useState({ connectedPeers: 0, peerIds: [] as string[] });
    const [meshLog, setMeshLog] = useState<{ time: number, msg: string }[]>([]);
    const [conflict, setConflict] = useState<{ id: string, path: string, resolve: (choice: 'local' | 'remote' | 'abort') => void } | null>(null);

    const lastViewedRef = useRef(lastViewed);
    const discoveryMapRef = useRef(discoveryMap);
    const currentTabRef = useRef(currentTab);
    const selectedUserRef = useRef(selectedUser);

    useEffect(() => { lastViewedRef.current = lastViewed; }, [lastViewed]);
    useEffect(() => { discoveryMapRef.current = discoveryMap; }, [discoveryMap]);
    useEffect(() => { currentTabRef.current = currentTab; }, [currentTab]);
    useEffect(() => { selectedUserRef.current = selectedUser; }, [selectedUser]);

    useEffect(() => {
        if (!sov) return;
        const interval = setInterval(() => {
            setMeshStats(sov.getMeshStats());
        }, 3000);

        const handleUpdate = (data: any) => {
            setMeshLog(prev => [{ time: Date.now(), msg: `Mesh Update: ${data.path || data.moduleName}` }, ...prev].slice(0, 20));
        };
        sov.on('update', handleUpdate);

        return () => {
            clearInterval(interval);
            sov.off('update', handleUpdate);
        };
    }, [sov]);

    const [dialog, setDialog] = useState<{
        title: string;
        message: string;
        type: 'alert' | 'confirm' | 'prompt' | 'multiselect' | 'config';
        defaultValue?: string;
        options?: { value: string, label: string }[];
        onConfirm: (value?: any) => void;
        onCancel: () => void;
    } | null>(null);

    const showAlert = (message: string, title: string = 'Notice') => {
        setDialog({ title, message, type: 'alert', onConfirm: () => setDialog(null), onCancel: () => setDialog(null) });
    };
    const showConfirm = (message: string, onConfirm: () => void | Promise<void>, title: string = 'Confirm') => {
        setDialog({ 
            title, 
            message, 
            type: 'confirm', 
            onConfirm: async () => { 
                setDialog(null); 
                await onConfirm(); 
            }, 
            onCancel: () => setDialog(null) 
        });
    };
    const showPrompt = (message: string, onConfirm: (val: string) => void | Promise<void>, defaultValue: string = '', title: string = 'Input') => {
        setDialog({ 
            title, 
            message, 
            type: 'prompt', 
            defaultValue, 
            onConfirm: async (val) => { 
                setDialog(null); 
                if (val !== undefined) await onConfirm(val || ''); 
            }, 
            onCancel: () => setDialog(null) 
        });
    };
    const showMultiSelect = (message: string, options: { value: string, label: string }[], onConfirm: (vals: string[]) => void | Promise<void>, title: string = 'Select Members') => {
        setDialog({
            title,
            message,
            type: 'multiselect',
            options,
            onConfirm: async (vals) => {
                setDialog(null);
                if (vals !== undefined) await onConfirm(vals);
            },
            onCancel: () => setDialog(null)
        });
    };

    const toggleConnection = () => {
        setIsConnected(prev => !prev);
    };

    useEffect(() => {
        if (!isLoggedIn) return;
        localStorage.setItem(getStorageKey('profile_cache'), JSON.stringify(profileCache));
    }, [profileCache, isLoggedIn]);

    useEffect(() => {
        if (!isLoggedIn) return;
        localStorage.setItem(getStorageKey('blob_cache'), JSON.stringify(blobCache));
    }, [blobCache, isLoggedIn]);

    useEffect(() => {
        if (!isLoggedIn) return;
        localStorage.setItem(getStorageKey('discovery_map'), JSON.stringify(discoveryMap));
    }, [discoveryMap, isLoggedIn]);

    useEffect(() => {
        if (!isLoggedIn) return;
        localStorage.setItem(getStorageKey('last_viewed_v2'), JSON.stringify(lastViewed));
    }, [lastViewed, isLoggedIn]);

    useEffect(() => {
        if (!isLoggedIn) return;
        localStorage.setItem(getStorageKey('highlights'), JSON.stringify(highlights));
    }, [highlights, isLoggedIn]);

    useEffect(() => {
        const savedConfig = localStorage.getItem('sov_social_config');
        if (savedConfig && autoLogin) {
            try {
                const parsed = JSON.parse(savedConfig);
                const sessionToken = localStorage.getItem('sov_session_token');
                if (sessionToken) {
                    parsed.password = atob(sessionToken);
                }
                setConfig(parsed);
                performLogin(parsed);
                return;
            } catch (e) {}
        }

        const isLocalHost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
        const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
        const requestedMode = urlParams.get('mode');

        fetch('config.json')
            .then(res => res.json())
            .then(data => {
                const endpointIsLocal = data.endpoint && (data.endpoint.includes('127.0.0.1') || data.endpoint.includes('localhost'));
                let defaultMode = data.syncMode || (isLocalHost ? 's3' : 'webrtc');
                if (requestedMode) defaultMode = requestedMode;
                if (!isLocalHost && endpointIsLocal && !requestedMode) {
                    defaultMode = 'webrtc';
                }
                setConfig(prev => ({ ...prev, ...data, syncMode: defaultMode }));
            })
            .catch(() => {
                if (!isLocalHost) {
                    setConfig(prev => ({ ...prev, syncMode: requestedMode || 'webrtc' }));
                }
            });
    }, []);

    const performLogin = async (currentConfig: any) => {
        try {
            setConfig(currentConfig);
            const s3Config = {
                region: currentConfig.region,
                endpoint: currentConfig.endpoint,
                credentials: {
                    accessKeyId: currentConfig.accessKeyId,
                    secretAccessKey: currentConfig.secretAccessKey
                },
                bucketName: currentConfig.bucketName,
                forcePathStyle: true
            };

            let remoteAdapter;
            let factory;

            if (currentConfig.syncMode === 'webrtc' || currentConfig.syncMode === 'peerjs') {
                const adapter = new WebRTCRemoteAdapter(currentConfig.userId);
                
                if (currentConfig.syncMode === 'webrtc') {
                    const bc = new BroadcastChannel('sov-webrtc-mesh');
                    const peer = adapter.connectPeer((msg) => bc.postMessage(msg));
                    if (peer) {
                        bc.onmessage = (e) => peer.receive(e.data);
                    }
                } else if (currentConfig.syncMode === 'peerjs') {
                    // Start PeerJS connection to public free cloud
                    const peerId = `${currentConfig.appId}-${currentConfig.userId}`;
                    const peer = new Peer(peerId);
                    
                    const activeConnections = new Set<string>();

                    const setupConnection = (conn: any) => {
                        if (activeConnections.has(conn.peer)) return;
                        activeConnections.add(conn.peer);
                        
                        let peerInterface: any = null;
                        
                        conn.on('open', () => {
                            if (DEBUG) console.log(`[PeerJS] Connected to ${conn.peer}`);
                            peerInterface = adapter.connectPeer((msg) => {
                                if (conn.open) conn.send(msg);
                            });
                            
                            // Re-broadcast our known state to the new peer so they catch up
                            setTimeout(async () => {
                                if (instance && instance.getStorage()) {
                                    // Hacky but effective: tell the new peer about our profile, registry, and latest DBs
                                    try {
                                        const globalRemotePath = `${getPrefix('global', 'users')}/users.json`;
                                        const registry = await instance.getPublicRegistry();
                                        if (registry.length > 0) {
                                            adapter.uploadFile(globalRemotePath, new TextEncoder().encode(JSON.stringify(registry)));
                                        }

                                        const publicProfile = await instance.getStorage().getPublicUserFile();
                                        if (publicProfile) {
                                            adapter.uploadFile(`${getPrefix(currentConfig.userId, 'social')}/public/user.json`, publicProfile);
                                        }
                                        
                                        const today = SovereignS3nc.getDateStr(new Date());
                                        const publicDb = await instance.getStorage().getFile(instance.getModulePath('social', `${today}.db`, 'public'));
                                        if (publicDb) {
                                            adapter.uploadFile(`${getPrefix(currentConfig.userId, 'social')}/public/modules/social/${today}.db`, publicDb);
                                        }
                                    } catch (e) {}
                                }
                            }, 1000);
                        });
                        conn.on('data', (data: any) => {
                            if (peerInterface) peerInterface.receive(data as string);
                        });
                        conn.on('close', () => {
                            if (DEBUG) console.log(`[PeerJS] Connection closed: ${conn.peer}`);
                            activeConnections.delete(conn.peer);
                        });
                        conn.on('error', (err: any) => {
                            if (DEBUG) console.warn(`[PeerJS] Connection error with ${conn.peer}:`, err);
                            activeConnections.delete(conn.peer);
                        });
                    };

                    peer.on('connection', setupConnection);
                    
                    peer.on('error', (err: any) => {
                        if (DEBUG) console.warn(`[PeerJS] Global Peer Error:`, err);
                    });

                    // Auto-connect to other peers periodically
                    setInterval(() => {
                        try {
                            const knownUsers = JSON.parse(localStorage.getItem('sov_remembered_users') || '[]');
                            const discovery = JSON.parse(localStorage.getItem('sov_discovery_map') || '{}');
                            
                            const peersToConnect = new Set<string>();
                            knownUsers.forEach((u: any) => peersToConnect.add(`${currentConfig.appId}-${u.userId}`));
                            Object.keys(discovery).forEach((uid: string) => peersToConnect.add(`${currentConfig.appId}-${uid}`));

                            peersToConnect.forEach(targetPeerId => {
                                if (targetPeerId !== peerId && !activeConnections.has(targetPeerId)) {
                                    const conn = peer.connect(targetPeerId);
                                    setupConnection(conn);
                                }
                            });
                        } catch (e) {}
                    }, 5000);
                }

                const getPrefix = (uid: string, sid: string) => `${currentConfig.appId}/${uid}/${sid}`;
                remoteAdapter = new PrefixProxyAdapter(adapter, getPrefix(currentConfig.userId, 'social'));
                factory = (uid: string) => {
                    if (uid === 'global') return new PrefixProxyAdapter(adapter, getPrefix('global', 'users'));
                    return new PrefixProxyAdapter(adapter, getPrefix(uid, 'social'));
                };
            }

            const instance = new SovereignS3nc({
                s3: currentConfig.syncMode === 's3' ? s3Config : undefined,
                offline: currentConfig.syncMode === 'offline',
                paths: { appId: currentConfig.appId, userId: currentConfig.userId, storeId: 'social' },
                password: currentConfig.password,
                autoFollowDiscoveredUsers: false,
                useWorker: useWebWorkers,
                workerUrl: 'sync-worker.js',
                debug: DEBUG
            }, remoteAdapter, factory);

            await instance.init();
            instance.on('conflict', (data: any) => {
                setConflict(data);
            });
            setSov(instance);

            // Update config with discovered admin key
            const finalConfig = instance.getConfig();
            if (finalConfig.adminPublicKey) {
                setConfig(prev => ({ ...prev, adminPublicKey: finalConfig.adminPublicKey! }));
            }
            
            const fm = new FeedModule(instance);
            setFeed(fm);
            const mm = new MessagingModule(instance);
            setMessaging(mm);
            const pm = new ProfileModule(instance);
            setProfileModule(pm);
            const mod = new ModerationModule(instance);
            setModeration(mod);
            
            // Real probe for admin permissions - Automatically detected via S3 credentials
            const isUserAdmin = await mod.isAdmin();
            setIsAdmin(isUserAdmin);

            if (isUserAdmin) {
                // Check if admin key is already published
                try {
                    const adminRemote = (instance as any).adminRemote;
                    const keyFile = await adminRemote?.downloadFile('public_key.json');
                    setAdminKeyPublished(!!(keyFile && keyFile.data));
                } catch (e) {
                    setAdminKeyPublished(false);
                }
            }

            // Load user-scoped caches
            const loadCache = (key: string, defaultVal: any) => {
                const s = localStorage.getItem(`sov_${currentConfig.userId}_${key}`);
                return s ? JSON.parse(s) : defaultVal;
            };

            setProfileCache(loadCache('profile_cache', {}));
            setBlobCache(loadCache('blob_cache', {}));
            setDiscoveryMap(loadCache('discovery_map', {}));
            setHighlights(loadCache('highlights', { feed: 0, friends: 0 }));
            setLastViewed(loadCache('last_viewed_v2', { feed: Date.now(), friends: Date.now(), messages: Date.now(), chat: {} }));
            
            const profileData = await pm.getProfile();
            setProfile(profileData);

            setIsLoggedIn(true);
            
            // Task #34: Secure password handling
            const persistentConfig = { ...currentConfig };
            delete persistentConfig.password;
            localStorage.setItem('sov_social_config', JSON.stringify(persistentConfig));
            localStorage.setItem('sov_auto_login', autoLogin.toString());
            
            if (autoLogin) {
                // If auto-login is on, we still need to store it somewhere to survive refreshes.
                // localStorage is the only place. We'll store it as an obfuscated 'session_token'.
                localStorage.setItem('sov_session_token', btoa(currentConfig.password));
            } else {
                localStorage.removeItem('sov_session_token');
            }

            await loadData(instance, fm, mm, pm);

            const newUser = { userId: currentConfig.userId, name: profileData?.name || currentConfig.userId, avatar: profileData?.avatar, config: persistentConfig };
            setRememberedUsers(prev => {
                const updated = [newUser, ...prev.filter(u => u.userId !== currentConfig.userId)];
                localStorage.setItem('sov_remembered_users', JSON.stringify(updated));
                return updated;
            });
            
            setTimeout(() => {
                instance.sync().then(() => {
                    loadData(instance, fm, mm, pm);
                }).catch(e => {
                    loadData(instance, fm, mm, pm); 
                });
            }, 100);
        } catch (e: any) {
            showAlert('Login initialization failed: ' + e.message, 'Login Error');
        }
    };

    const login = () => performLogin(config);

    const handleConnectRemote = async () => {
        setDialog({
            title: 'Connect to Remote Storage',
            message: 'Configure your remote backend to enable cross-device sync and social discovery.',
            type: 'config',
            onConfirm: async (newRemoteConfig: any) => {
                if (!sov) return;
                try {
                    setSyncing(true);
                    setDialog(null);
                    
                    if (newRemoteConfig.syncMode === 's3') {
                        await sov.connectRemote({
                            region: newRemoteConfig.region,
                            endpoint: newRemoteConfig.endpoint,
                            credentials: {
                                accessKeyId: newRemoteConfig.accessKeyId,
                                secretAccessKey: newRemoteConfig.secretAccessKey
                            },
                            bucketName: newRemoteConfig.bucketName,
                            forcePathStyle: true
                        });
                    } else if (newRemoteConfig.syncMode === 'webrtc') {
                        // For WebRTC we need to set up the adapter same as in login
                        const adapter = new WebRTCRemoteAdapter(config.userId);
                        const bc = new BroadcastChannel('sov-webrtc-mesh');
                        const peer = adapter.connectPeer((msg) => bc.postMessage(msg));
                        bc.onmessage = (e) => peer.receive(e.data);
                        
                        const getPrefix = (uid: string, sid: string) => `${config.appId}/${uid}/${sid}`;
                        const remoteAdapter = new PrefixProxyAdapter(adapter, getPrefix(config.userId, 'social'));
                        // Note: SovereignS3nc doesn't currently support updating the factory after init, 
                        // but connectRemote can take an IRemoteAdapter.
                        await sov.connectRemote(remoteAdapter);
                    }
                    
                    setConfig({ ...config, ...newRemoteConfig });
                    localStorage.setItem('sov_social_config', JSON.stringify({ ...config, ...newRemoteConfig }));
                    showAlert('Connected to remote successfully!', 'Success');
                    await loadData(sov, feed, messaging, profileModule);
                } catch (e: any) {
                    showAlert('Failed to connect: ' + e.message, 'Error');
                } finally {
                    setSyncing(false);
                }
            },
            onCancel: () => setDialog(null)
        });
    };

    const logout = () => {
        localStorage.removeItem('sov_social_config');
        setIsLoggedIn(false);
        setSov(null);
        setFeed(null);
        setMessaging(null);
        setProfileModule(null);
        setPosts([]);
        setFollowing([]);
        setMessages([]);
    };

    const handleChangePassword = async () => {
        if (!sov || !oldPassword || !newPassword) {
            showAlert('Please enter both old and new passwords.', 'Validation Error');
            return;
        }
        try {
            await sov.changePassword(oldPassword, newPassword);
            showAlert('Password changed successfully!', 'Success');
            setOldPassword('');
            setNewPassword('');
            // Update local config password if it was saved
            const savedConfig = localStorage.getItem('sov_social_config');
            if (savedConfig) {
                const parsed = JSON.parse(savedConfig);
                parsed.password = newPassword;
                localStorage.setItem('sov_social_config', JSON.stringify(parsed));
                setConfig(parsed);
            }
        } catch (e: any) {
            showAlert('Failed to change password: ' + e.message, 'Error');
        }
    };

    const resetLocalData = async () => {
        showConfirm('Clear all local data? This will forget your account and settings.', async () => {
            localStorage.clear();
            const dbs = await indexedDB.databases();
            for (const db of dbs) {
                if (db.name) indexedDB.deleteDatabase(db.name);
            }
            window.location.reload();
        });
    };

    const compressImage = async (file: File): Promise<Uint8Array> => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target?.result as string;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    const MAX_DIM = 1200;
                    if (width > MAX_DIM || height > MAX_DIM) {
                        const scale = Math.min(MAX_DIM / width, MAX_DIM / height);
                        width *= scale;
                        height *= scale;
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d')!;
                    ctx.drawImage(img, 0, 0, width, height);

                    let quality = 0.8;
                    const check = () => {
                        canvas.toBlob((b) => {
                            if (b && b.size > 200 * 1024 && quality > 0.1) {
                                quality -= 0.1;
                                check();
                            } else {
                                b?.arrayBuffer().then(ab => resolve(new Uint8Array(ab)));
                            }
                        }, 'image/jpeg', quality);
                    };
                    check();
                };
            };
        });
    };

    const handleImageChange = async (e: any, isMessage: boolean = false) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            setSyncing(true); // Show spinner while processing
            const dataUrl = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = (ev) => resolve(ev.target?.result as string);
                reader.readAsDataURL(file);
            });

            // Task #36: Image upload error feedback
            const compressed = await MediaUtils.compressImage(dataUrl, 500 * 1024);
            const data = MediaUtils.dataUrlToBytes(compressed);

            if (isMessage) {
                setMsgImage(data);
                setMsgImagePreview(compressed);
            } else {
                setNewPostImage(data);
                setNewImagePreview(compressed);
            }
        } catch (err: any) {
            showAlert('Image processing failed: ' + err.message + '. Try a smaller image.', 'Error');
        } finally {
            setSyncing(false);
        }
    };

    const handlePost = async () => {
        if (!feed || (!newPost && !newImage)) return;
        await feed.post(newPost, true, newImage || undefined);
        setNewPost('');
        setNewPostImage(null);
        setNewImagePreview(null);
        if (postFileRef.current) postFileRef.current.value = '';
        await sync(); 
    };

    const handlePostKeyDown = (e: React.KeyboardEvent) => {
        if (e.ctrlKey && e.key === 'Enter') {
            handlePost();
        }
    };

    const handleLike = async (postId: string) => {
        if (!feed || !profileModule) return;
        await feed.like(postId);
        await loadData(sov || undefined, feed || undefined, messaging || undefined, profileModule || undefined);
    };

    const handleComment = async (post: Post) => {
        if (!feed || !profileModule) return;
        showPrompt(`Replying to ${post.userId}:`, async (content) => {
            if (content) {
                await feed.comment(post.id, post.userId, content);
                await sync();
            }
        });
    };

    const handleEditPost = async (post: Post) => {
        if (!feed || !profileModule) return;
        showPrompt('Edit your post:', async (newContent) => {
            if (newContent !== null && newContent !== post.content) {
                const dateStr = new Date(post.timestamp).toISOString().split('T')[0];
                await feed.editPost(post.id, dateStr, newContent);
                await sync();
            }
        }, post.content);
    };

    const handleDeletePost = async (post: Post) => {
        if (!feed || !profileModule) return;
        showConfirm('Delete this post? Data will be removed but a placeholder will remain.', async () => {
            const dateStr = new Date(post.timestamp).toISOString().split('T')[0];
            await feed.deletePost(post.id, dateStr);
            await sync();
        });
    };

    const handleShare = async (post: Post) => {
        const text = `Post by ${post.userId}: ${post.content}`;
        try {
            await navigator.clipboard.writeText(text);
            showAlert('Post content copied to clipboard!', 'Success');
        } catch (e) {
            showAlert(text, 'Post Content');
        }
    };

    const [toast, setToast] = useState<{ message: string, type: string } | null>(null);
    const showToast = (message: string, type: string = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    const syncQueuedRef = useRef(false);

    const sync = async (force: boolean = false) => {
        const isForce = typeof force === 'boolean' ? force : false;
        if (!sov || !feed || !isConnected) {
            if (DEBUG) console.log(`[App] sync skipped: sov=${!!sov}, feed=${!!feed}, isConnected=${isConnected}`);
            return;
        }
        if (syncing) {
            if (DEBUG) console.log(`[App] sync queued: sync already in progress.`);
            syncQueuedRef.current = true;
            return;
        }
        setSyncing(true);
        try {
            if (DEBUG) console.log(`[App] Starting sync... (force=${isForce})`);
            await sov.sync(isForce);
            if (profileModule) await profileModule.syncOtherProfiles();
            setLastSyncTime(new Date().toLocaleTimeString());
            await loadData(sov, feed, messaging, profileModule);
            if (DEBUG) console.log('[App] Sync finished successfully.');
            
            // Task #30: Show notification on auto-sync (if not manual force sync)
            if (!isForce && isLoggedIn) {
                showToast('Sync complete: Your data is up to date.');
            }
        } catch (e: any) {
            if (DEBUG) console.error('[App] Sync failed:', e);
            showToast('Sync failed: ' + e.message, 'danger');
        } finally {
            setSyncing(false);
            if (syncQueuedRef.current) {
                syncQueuedRef.current = false;
                setTimeout(() => sync(), 200);
            }
        }
    };

    useEffect(() => {
        if (isLoggedIn) {
            sync();
            if (currentTab === 'feed' || currentTab === 'friends') {
                setHighlights(prev => ({ ...prev, [currentTab]: lastViewed[currentTab] || 0 }));
                setLastViewed(prev => ({ ...prev, [currentTab]: Date.now() }));
            }
        }
    }, [currentTab]);

    useEffect(() => {
        if (currentTab === 'messages' && selectedUser && messaging) {
            setLastViewed(prev => ({
                ...prev,
                chat: { ...(prev.chat || {}), [selectedUser]: Date.now() }
            }));
            setUserUnreadCounts(prev => ({ ...prev, [selectedUser]: 0 }));

            // Mark unread messages from this user as read
            const unreadFromUser = messages.filter(m => m.senderId === selectedUser && m.status !== 'read');
            if (unreadFromUser.length > 0) {
                (async () => {
                    const batch = unreadFromUser.map(m => ({ 
                        id: m.id, 
                        date: new Date(m.timestamp).toISOString().split('T')[0] 
                    }));
                    await messaging.markBatchAsRead(selectedUser, batch);
                    // Trigger a sync shortly after marking as read to push receipts
                    setTimeout(() => sync(), 1000);
                })();
            }
        }
    }, [selectedUser, currentTab, messaging]);

    useEffect(() => {
        if (!isLoggedIn || !sov || !feed || !autoSync) return;
        const interval = setInterval(() => {
            sync();
        }, 60000);
        return () => clearInterval(interval);
    }, [isLoggedIn, sov, feed, autoSync]);

    const lookbackDaysRef = useRef(lookbackDays);
    useEffect(() => { lookbackDaysRef.current = lookbackDays; }, [lookbackDays]);

    const loadData = async (v?: SovereignS3nc, fm?: FeedModule, mm?: MessagingModule, pm?: ProfileModule) => {
        const activeSov = v || sov;
        const activeFeed = fm || feed;
        const activeMessaging = mm || messaging;
        const activeProfile = pm || profileModule;
        
        if (!activeSov || !activeFeed || !activeMessaging || !activeProfile) return;

        const registry = await activeSov.getPublicRegistry();
        
        // In P2P mode, the global registry might be fragmented. 
        // We inject manually discovered users into the list so they can be followed.
        Object.keys(discoveryMapRef.current).forEach(uid => {
            if (!registry.find(u => u.userId === uid)) {
                // We don't have their public key yet, but adding them to the UI allows us to try following
                registry.push({ userId: uid, publicKey: '' });
            }
        });

        setAllUsers(registry);

        const now = Date.now();
        const curDiscoveryMap = discoveryMapRef.current;
        const newDiscoveryMap = { ...curDiscoveryMap };
        let discoveryChanged = false;
        registry.forEach(u => {
            if (!newDiscoveryMap[u.userId]) {
                newDiscoveryMap[u.userId] = now;
                discoveryChanged = true;
            }
        });
        if (discoveryChanged) {
            setDiscoveryMap(newDiscoveryMap);
            discoveryMapRef.current = newDiscoveryMap;
        }

        const followingList = await activeSov.getFollowing();
        setFollowing(followingList);

        const usersToFetchPosts = [...followingList];
        if (config.adminPublicKey && !usersToFetchPosts.find(u => u.userId === 'admin')) {
            usersToFetchPosts.push({ userId: 'admin' } as any);
        }

        const dates: string[] = [];
        const currentLookbackDays = lookbackDaysRef.current;
        for (let i = 0; i < currentLookbackDays; i++) {
            const d = new Date();
            d.setUTCDate(d.getUTCDate() - i);
            dates.push(SovereignS3nc.getDateStr(d));
        }

        let allPosts: Post[] = [];
        for (const date of dates) {
            allPosts = [...allPosts, ...(await activeFeed.getPosts(date, 'public'))];
            for (const user of usersToFetchPosts) {
                allPosts = [...allPosts, ...(await activeFeed.getPosts(`${user.userId}/${date}`, 'followed'))];
            }
        }

        allPosts.sort((a, b) => b.timestamp - a.timestamp);
        await activeFeed.enrichLikes(allPosts, currentLookbackDays);
        setPosts(allPosts);

        const newMessages = await activeMessaging.getInboxMessages(currentLookbackDays);
        setMessages(newMessages);

        const curLv = lastViewedRef.current;
        const curTab = currentTabRef.current;
        const curUser = selectedUserRef.current;

        let feedUnread = allPosts.filter(p => p.timestamp > curLv.feed && p.userId !== config.userId).length;
        if (curTab === 'feed') {
            feedUnread = 0;
            setLastViewed(prev => {
                const next = { ...prev, feed: Date.now() };
                lastViewedRef.current = next;
                return next;
            });
        }
        
        const userMsgUnreads: Record<string, number> = {};
        let totalMsgUnread = 0;
        newMessages.forEach(m => {
            if (m.senderId !== config.userId) {
                const userLastViewed = (curLv.chat || {})[m.senderId] || 0;
                if (m.timestamp > userLastViewed) {
                    userMsgUnreads[m.senderId] = (userMsgUnreads[m.senderId] || 0) + 1;
                    totalMsgUnread++;
                }
            }
        });
        if (DEBUG) console.log(`[App] loadData (${config.userId}): newMessages=${newMessages.length}, totalMsgUnread=${totalMsgUnread}, curTab=${curTab}`);

        if (curTab === 'messages' && curUser) {
            totalMsgUnread -= (userMsgUnreads[curUser] || 0);
            userMsgUnreads[curUser] = 0;
            setLastViewed(prev => {
                const next = {
                    ...prev,
                    chat: { ...(prev.chat || {}), [curUser]: Date.now() }
                };
                lastViewedRef.current = next;
                return next;
            });
        }

        let friendsUnread = registry.filter(u => (newDiscoveryMap[u.userId] || 0) > curLv.friends && u.userId !== config.userId).length;
        if (curTab === 'friends') {
            friendsUnread = 0;
            setLastViewed(prev => {
                const next = { ...prev, friends: Date.now() };
                lastViewedRef.current = next;
                return next;
            });
        }

        const groupsList = await activeSov.getGroups();
        setGroups(groupsList);

        if (isAdmin && moderation) {
            try {
                const pendingReports = await moderation.getReports();
                setReports(pendingReports);
            } catch (e) {}
        }

        // Refresh selected group from list to get updated member statuses
        if (selectedGroup) {
            const updated = groupsList.find(g => g.id === selectedGroup.id);
            if (updated) setSelectedGroup(updated);
        }

        // Auto-update group metadata if we receive an update DM
        for (const m of newMessages) {
            if (m.content.startsWith('INVITE_GROUP:')) {
                try {
                    const groupInfo = JSON.parse(m.content.substring(13));
                    const existing = groupsList.find(g => g.id === groupInfo.id);
                    if (existing) {
                        // Check if metadata actually changed or if we need to update our local role/status
                        // For simplicity, we just join/update if it's from a member
                        if (groupInfo.members.find((mb: any) => mb.userId === m.senderId)) {
                            await activeSov.joinGroup(groupInfo);
                        }
                    }
                } catch(e) {}
            }
        }

        let roomsUnread = 0;
        // This is a simplified unread for rooms - in a real app you'd check each room's posts
        // For demo, we'll just check if any groups are newer than lastViewed.rooms
        roomsUnread = groupsList.filter(g => g.createdAt > curLv.rooms).length;
        if (curTab === 'rooms') {
            roomsUnread = 0;
            setLastViewed(prev => {
                const next = { ...prev, rooms: Date.now() };
                lastViewedRef.current = next;
                return next;
            });
        }

        setUnreadCounts({
            feed: feedUnread,
            messages: totalMsgUnread,
            friends: friendsUnread,
            rooms: roomsUnread
        });
        setUserUnreadCounts(userMsgUnreads);
    };

    const handleSendMessage = async () => {
        if (!messaging || !selectedUser || (!msgInput && !msgImage)) return;
        await messaging.sendDirectMessage(selectedUser, msgInput, msgImage || undefined);
        setMsgInput('');
        setMsgImage(null);
        setMsgImagePreview(null);
        if (msgFileRef.current) msgFileRef.current.value = '';
        await sync(); 
    };

    const handleLoadMore = () => {
        setLookbackDays(prev => prev + 5);
    };

    useEffect(() => {
        if (isLoggedIn) loadData(sov || undefined, feed || undefined, messaging || undefined, profileModule || undefined);
    }, [lookbackDays]);

    const handleEditMessage = async (m: Message) => {
        if (!feed || !profileModule) return;
        showPrompt('Edit your message:', async (newContent) => {
            if (newContent !== null && newContent !== m.content) {
                const dateStr = new Date(m.timestamp).toISOString().split('T')[0];
                const otherUser = m.senderId === config.userId ? m.recipientId : m.senderId;
                await messaging.editMessage(otherUser, m.id, dateStr, newContent);
                await sync();
            }
        }, m.content);
    };

    const handleDeleteMessage = async (m: Message) => {
        if (!feed || !profileModule) return;
        showConfirm('Delete this message for everyone?', async () => {
            const dateStr = new Date(m.timestamp).toISOString().split('T')[0];
            const otherUser = m.senderId === config.userId ? m.recipientId : m.senderId;
            await messaging.deleteMessage(otherUser, m.id, dateStr);
            await sync();
        });
    };

    const handleNewChat = () => {
        showPrompt('Enter User ID to chat with:', (userId) => {
            if (userId) setSelectedUser(userId);
        });
    };

    const handleCreateGroup = async () => {
        if (!sov) return;
        showPrompt('Enter room name:', async (name) => {
            if (name) {
                // Prepare options from following list and sort alphabetically
                const options = following
                    .filter(f => !!f.publicKey)
                    .map(f => ({ value: f.userId, label: f.userId }))
                    .sort((a, b) => a.label.localeCompare(b.label));

                if (options.length === 0) {
                    // No friends to invite, just create with self
                    const group = await sov.createGroup(name, [
                        { userId: config.userId, publicKey: sov.getConfig().publicEncryptionKey!, role: 'owner' }
                    ]);
                    await sync();
                    return;
                }

                showMultiSelect('Select members to invite:', options, async (selectedUserIds) => {
                    const members: any[] = [
                        { userId: config.userId, publicKey: sov.getConfig().publicEncryptionKey!, role: 'owner' }
                    ];
                    
                    selectedUserIds.forEach(uid => {
                        const f = following.find(u => u.userId === uid);
                        if (f) members.push({ userId: f.userId, publicKey: f.publicKey, role: 'member' });
                    });

                    const group = await sov.createGroup(name, members);
                    
                    // Invite others via DM
                    for (const member of members) {
                        if (member.userId !== config.userId) {
                            await messaging?.sendDirectMessage(member.userId, `INVITE_GROUP:${JSON.stringify(group)}`);
                        }
                    }

                    await sync();
                });
            }
        });
    };

    const handlePostToGroup = async () => {
        if (!feed || !selectedGroup || (!groupInput && !groupImage)) return;
        await feed.postToGroup(selectedGroup.id, selectedGroup.sharedKey, groupInput, groupImage || undefined);
        setGroupInput('');
        setGroupImage(null);
        setGroupImagePreview(null);
        if (groupFileRef.current) groupFileRef.current.value = '';
        await sync();
    };

    const handleGroupImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            setSyncing(true);
            const dataUrl = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = (ev) => resolve(ev.target?.result as string);
                reader.readAsDataURL(file);
            });

            const compressed = await MediaUtils.compressImage(dataUrl, 500 * 1024);
            const data = MediaUtils.dataUrlToBytes(compressed);

            setGroupImage(data);
            setGroupImagePreview(compressed);
        } catch (err: any) {
            showAlert('Group image processing failed: ' + err.message, 'Error');
        } finally {
            setSyncing(false);
        }
    };
    const handleAcceptGroup = async (groupInfo: any) => {
        if (!sov) return;
        await sov.joinGroup(groupInfo);
        await sov.respondToGroup(groupInfo.id, 'joined');
        
        // Post a join message to the group
        await feed?.postToGroup(groupInfo.id, groupInfo.sharedKey, 'joined the room', undefined, 'system');
        
        await sync();
        setCurrentTab('rooms');
        
        // Refresh selected group from storage to ensure status is updated
        const updatedGroups = await sov.getGroups();
        const freshGroup = updatedGroups.find(g => g.id === groupInfo.id);
        setSelectedGroup(freshGroup || groupInfo);

        // Update last viewed to clear unread indicator
        setLastViewed(prev => ({
            ...prev,
            rooms: Date.now(),
            roomChat: { ...(prev.roomChat || {}), [groupInfo.id]: Date.now() }
        }));
        
        showAlert(`You have joined ${groupInfo.name}!`, 'Success');
    };

    const handleDeclineGroup = async (groupInfo: any) => {
        if (!sov) return;
        await sov.joinGroup(groupInfo); // We still save it to track that we declined
        await sov.respondToGroup(groupInfo.id, 'declined');
        await sync();

        // Update last viewed to clear unread indicator
        setLastViewed(prev => ({
            ...prev,
            rooms: Date.now(),
            roomChat: { ...(prev.roomChat || {}), [groupInfo.id]: Date.now() }
        }));

        showAlert(`You declined the invite to ${groupInfo.name}.`, 'Notice');
    };

    const handleLeaveGroup = async () => {
        if (!sov || !selectedGroup) return;
        
        showConfirm(`Are you sure you want to leave ${selectedGroup.name}?`, async () => {
            // Post leave message before losing access to key/metadata
            await feed?.postToGroup(selectedGroup.id, selectedGroup.sharedKey, 'left the room', undefined, 'system');
            
            await sov.leaveGroup(selectedGroup.id);
            await sync();
            
            setSelectedGroup(null);
            setShowMemberManagement(false);
            showAlert(`You left ${selectedGroup.name}.`, 'Notice');
        });
    };

    const handleManageMembers = async () => {
        if (!sov || !selectedGroup) return;
        const myRole = selectedGroup.members.find((m: any) => m.userId === config.userId)?.role;
        if (myRole !== 'owner' && myRole !== 'admin') {
            showAlert('Only admins can manage members.', 'Access Denied');
            return;
        }

        const members = [...selectedGroup.members];
        
        // We'll show a custom dialog for managing members
        // Since our Dialog component is simple, we'll use a specific state for this
        setShowMemberManagement(true);
    };

    const [showMemberManagement, setShowMemberManagement] = useState(false);

    const updateMemberRole = async (userId: string, newRole: 'admin' | 'member') => {
        if (!sov || !selectedGroup) return;
        const updatedMembers = selectedGroup.members.map((m: any) => 
            m.userId === userId ? { ...m, role: newRole } : m
        );
        const updatedGroup = { ...selectedGroup, members: updatedMembers };
        await sov.updateGroup(updatedGroup);
        setSelectedGroup(updatedGroup);
        
        // Notify members (reuse INVITE_GROUP to broadcast metadata)
        for (const member of updatedMembers) {
            if (member.userId !== config.userId) {
                await messaging?.sendDirectMessage(member.userId, `INVITE_GROUP:${JSON.stringify(updatedGroup)}`);
            }
        }
        await sync();
    };

    const removeMember = async (userId: string) => {
        if (!sov || !selectedGroup) return;
        const updatedMembers = selectedGroup.members.filter((m: any) => m.userId !== userId);
        const updatedGroup = { ...selectedGroup, members: updatedMembers };
        await sov.updateGroup(updatedGroup);
        setSelectedGroup(updatedGroup);

        // Notify remaining members
        for (const member of updatedMembers) {
            if (member.userId !== config.userId) {
                await messaging?.sendDirectMessage(member.userId, `INVITE_GROUP:${JSON.stringify(updatedGroup)}`);
            }
        }
        // Notify removed member (they won't get future updates)
        await messaging?.sendDirectMessage(userId, `INVITE_GROUP:${JSON.stringify(updatedGroup)}`);
        
        await sync();
    };

    const addMembersToGroup = async () => {
        if (!sov || !selectedGroup) return;
        
        const existingUserIds = selectedGroup.members.map((m: any) => m.userId);
        const options = following
            .filter(f => !!f.publicKey && !existingUserIds.includes(f.userId))
            .map(f => ({ value: f.userId, label: f.userId }))
            .sort((a, b) => a.label.localeCompare(b.label));

        if (options.length === 0) {
            showAlert('No more friends to invite.', 'Notice');
            return;
        }

        showMultiSelect('Select members to invite:', options, async (selectedUserIds) => {
            const newMembers = [...selectedGroup.members];
            selectedUserIds.forEach(uid => {
                const f = following.find(u => u.userId === uid);
                if (f) newMembers.push({ userId: f.userId, publicKey: f.publicKey, role: 'member', status: 'pending' });
            });

            const updatedGroup = { ...selectedGroup, members: newMembers };
            await sov.updateGroup(updatedGroup);
            setSelectedGroup(updatedGroup);

            // Notify all members
            for (const member of newMembers) {
                if (member.userId !== config.userId) {
                    await messaging?.sendDirectMessage(member.userId, `INVITE_GROUP:${JSON.stringify(updatedGroup)}`);
                }
            }
            await sync();
        });
    };

    const loadGroupPosts = async () => {
        if (!feed || !selectedGroup) return;
        const dates: string[] = [];
        for (let i = 0; i < lookbackDays; i++) {
            const d = new Date();
            d.setUTCDate(d.getUTCDate() - i);
            dates.push(SovereignS3nc.getDateStr(d));
        }
        let all: Post[] = [];
        for (const date of dates) {
            all = [...all, ...(await feed.getGroupPosts(selectedGroup.id, date))];
        }
        setGroupPosts(all);

        // Update last viewed for this room
        setLastViewed(prev => ({
            ...prev,
            roomChat: { ...(prev.roomChat || {}), [selectedGroup.id]: Date.now() }
        }));
    };

    const handleEditGroupPost = async (p: Post) => {
        if (!feed || !selectedGroup) return;
        showPrompt('Edit your post:', async (newContent) => {
            if (newContent !== null && newContent !== p.content) {
                const dateStr = new Date(p.timestamp).toISOString().split('T')[0];
                await feed.editGroupPost(selectedGroup.id, selectedGroup.sharedKey, p.id, dateStr, newContent);
                await sync();
            }
        }, p.content);
    };

    const handleDeleteGroupPost = async (p: Post) => {
        if (!feed || !selectedGroup) return;
        const msg = p.userId === config.userId ? 'Delete your post?' : `Delete ${p.userId}'s post? (Admin)`;
        showConfirm(msg, async () => {
            const dateStr = new Date(p.timestamp).toISOString().split('T')[0];
            await feed.deleteGroupPost(selectedGroup.id, selectedGroup.sharedKey, p.id, dateStr, p.userId);
            await sync();
        });
    };

    useEffect(() => {
        if (isLoggedIn && selectedGroup) {
            loadGroupPosts();
        }
    }, [selectedGroup, lastSyncTime, isLoggedIn]);

    const isUserAnAdmin = (userId: string) => {
        if (userId === 'admin') return true;
        if (!config.adminPublicKey) return false;
        const user = allUsers.find(u => u.userId === userId);
        return user && user.publicKey === config.adminPublicKey;
    };

    const handleReportPost = async (post: Post) => {
        showPrompt('Reason for reporting this post:', async (reason) => {
            if (reason && moderation) {
                try {
                    await moderation.reportContent(post.userId, post.id, 'post', reason, post);
                    showAlert('Post reported. Thank you for keeping the community safe.', 'Report Submitted');
                } catch (e: any) {
                    showAlert('Failed to submit report: ' + e.message, 'Error');
                }
            }
        });
    };

    const socialContextValue: SocialContextType = {
        sov,
        feed,
        messaging,
        profileModule,
        moderation,
        profileCache,
        setProfileCache,
        blobCache,
        setBlobCache,
        lastSyncTime,
        config
    };

    if (!isLoggedIn) {
        return (
            <SocialContext.Provider value={socialContextValue}>
                <LoginView
                    config={config}
                    setConfig={setConfig}
                    rememberedUsers={rememberedUsers}
                    performLogin={performLogin}
                    login={login}
                    resetLocalData={resetLocalData}
                    autoLogin={autoLogin}
                    setAutoLogin={setAutoLogin}
                    autoSync={autoSync}
                    setAutoSync={setAutoSync}
                    useWebWorkers={useWebWorkers}
                    setUseWebWorkers={setUseWebWorkers}
                    dialog={dialog}
                    setDialog={setDialog}
                    profileCache={profileCache}
                />
            </SocialContext.Provider>
        );
    }

    return (
        <SocialContext.Provider value={socialContextValue}>
            <div className="container-fluid p-0">
                <Navigation
                    config={config}
                    currentTab={currentTab as any}
                    setCurrentTab={setCurrentTab as any}
                    unreadCounts={unreadCounts}
                    isAdmin={isAdmin}
                    isConnected={isConnected}
                    toggleConnection={toggleConnection}
                    meshStats={meshStats}
                    setShowPairing={setShowPairing}
                    sync={sync}
                    syncing={syncing}
                    logout={logout}
                    handleConnectRemote={handleConnectRemote}
                    profileModule={profileModule}
                    lastSyncTime={lastSyncTime}
                    profileCache={profileCache}
                    setProfileCache={setProfileCache}
                />

                <div className="container mt-4">
                    <div className="row justify-content-center">
                        {currentTab === 'feed' && (
                            <FeedTab
                                config={config}
                                newPost={newPost}
                                setNewPost={setNewPost}
                                handlePostKeyDown={handlePostKeyDown}
                                newImagePreview={newImagePreview}
                                postFileRef={postFileRef}
                                handleImageChange={handleImageChange}
                                handlePost={handlePost}
                                posts={posts}
                                setCurrentTab={setCurrentTab as any}
                                handleLoadMore={handleLoadMore}
                                highlights={highlights}
                                isUserAnAdmin={isUserAnAdmin}
                                handleEditPost={handleEditPost}
                                handleDeletePost={handleDeletePost}
                                handleReportPost={handleReportPost}
                                handleLike={handleLike}
                                handleComment={handleComment}
                                handleShare={handleShare}
                            />
                        )}

                        {currentTab === 'friends' && (
                            <FriendsTab
                                allUsers={allUsers}
                                config={config}
                                discoveryMap={discoveryMap}
                                highlights={highlights}
                                following={following}
                                sov={sov}
                                loadData={loadData}
                                showPrompt={showPrompt}
                                setDiscoveryMap={setDiscoveryMap}
                                feed={feed}
                                messaging={messaging}
                                profileModule={profileModule}
                            />
                        )}

                        {currentTab === 'messages' && (
                            <MessagesTab
                                following={following}
                                messages={messages}
                                config={config}
                                selectedUser={selectedUser}
                                setSelectedUser={setSelectedUser}
                                isUserAnAdmin={isUserAnAdmin}
                                userUnreadCounts={userUnreadCounts}
                                handleNewChat={handleNewChat}
                                groups={groups}
                                handleAcceptGroup={handleAcceptGroup}
                                handleDeclineGroup={handleDeclineGroup}
                                handleEditMessage={handleEditMessage}
                                handleDeleteMessage={handleDeleteMessage}
                                msgImage={msgImage}
                                msgImagePreview={msgImagePreview}
                                msgFileRef={msgFileRef}
                                msgInput={msgInput}
                                setMsgInput={setMsgInput}
                                handleImageChange={handleImageChange}
                                handleSendMessage={handleSendMessage}
                            />
                        )}

                        {currentTab === 'rooms' && (
                            <RoomsTab
                                groups={groups}
                                selectedGroup={selectedGroup}
                                setSelectedGroup={setSelectedGroup}
                                config={config}
                                lastViewed={lastViewed}
                                handleCreateGroup={handleCreateGroup}
                                handleManageMembers={handleManageMembers}
                                handleAcceptGroup={handleAcceptGroup}
                                handleDeclineGroup={handleDeclineGroup}
                                groupPosts={groupPosts}
                                isUserAnAdmin={isUserAnAdmin}
                                handleEditGroupPost={handleEditGroupPost}
                                handleDeleteGroupPost={handleDeleteGroupPost}
                                groupImage={groupImage}
                                groupImagePreview={groupImagePreview}
                                setGroupImage={setGroupImage}
                                setGroupImagePreview={setGroupImagePreview}
                                groupFileRef={groupFileRef}
                                groupInput={groupInput}
                                setGroupInput={setGroupInput}
                                handleGroupImageChange={handleGroupImageChange}
                                handlePostToGroup={handlePostToGroup}
                            />
                        )}

                        {currentTab === 'profile' && (
                            <ProfileTab
                                profile={profile}
                                setProfile={setProfile}
                                config={config}
                                profileModule={profileModule}
                                sync={sync}
                                showAlert={showAlert}
                                posts={posts}
                                sov={sov}
                                allUsers={allUsers}
                                exportAllPosts={exportAllPosts}
                                setExportAllPosts={setExportAllPosts}
                                oldPassword={oldPassword}
                                setOldPassword={setOldPassword}
                                newPassword={newPassword}
                                setNewPassword={setNewPassword}
                                handleChangePassword={handleChangePassword}
                                handleConnectRemote={handleConnectRemote}
                                logout={logout}
                            />
                        )}

                        {currentTab === 'mesh' && (
                            <MeshTab
                                meshStats={meshStats}
                                config={config}
                                meshLog={meshLog}
                            />
                        )}

                        {currentTab === 'admin' && isAdmin && (
                            <AdminTab
                                isAdmin={isAdmin}
                                adminKeyPublished={adminKeyPublished}
                                setAdminKeyPublished={setAdminKeyPublished}
                                moderation={moderation}
                                sov={sov}
                                sync={sync}
                                loadData={loadData}
                                reports={reports}
                                setReports={setReports}
                                setPreviewPost={setPreviewPost}
                                config={config}
                                showAlert={showAlert}
                                showPrompt={showPrompt}
                                showConfirm={showConfirm}
                            />
                        )}
                    </div>
                </div>

                <Dialog dialog={dialog} setDialog={setDialog} profileCache={profileCache} />

                {/* Global Sync Indicator */}
                {syncing && (
                    <div className="position-fixed bottom-0 end-0 m-4 shadow-lg p-3 bg-white rounded-4 d-flex align-items-center border" style={{ zIndex: 9999, minWidth: '200px' }}>
                        <div className="spinner-border spinner-border-sm text-primary me-3" role="status"></div>
                        <div>
                            <div className="fw-bold small">Syncing...</div>
                            <div className="x-small text-muted">Updating with S3</div>
                        </div>
                    </div>
                )}

                {showPairing && (
                    <PairingModal
                        userId={config.userId}
                        onClose={() => setShowPairing(false)}
                        onConnected={(transport) => {
                            if (sov) {
                                sov.connectNativeRTC(transport);
                            }
                        }}
                    />
                )}

                {showInspector && sov && (
                    <InspectorModal
                        sov={sov}
                        onClose={() => setShowInspector(false)}
                    />
                )}

                {/* Floating button when ?debug=inspect is active */}
                {(new URLSearchParams(window.location.search).get('debug') === 'inspect') && sov && !showInspector && (
                    <div style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 9999 }}>
                        <button
                            onClick={() => setShowInspector(true)}
                            style={{
                                background: '#1e1e24',
                                color: '#2196f3',
                                border: '1px solid #333',
                                padding: '8px 16px',
                                borderRadius: '30px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                fontSize: '13px',
                                fontWeight: 600
                            }}
                        >
                            <span>🛠️</span>
                            <span>Storage Inspector</span>
                        </button>
                    </div>
                )}

                {conflict && (
                    <ConflictResolutionModal
                        conflict={conflict}
                        onResolve={(choice) => {
                            if (conflict) {
                                conflict.resolve(choice);
                                setConflict(null);
                            }
                        }}
                    />
                )}

                <MemberManagementModal
                    show={showMemberManagement}
                    onClose={() => setShowMemberManagement(false)}
                    group={selectedGroup}
                    profileCache={profileCache}
                    onUpdateRole={updateMemberRole}
                    onRemove={removeMember}
                    onAdd={addMembersToGroup}
                    onLeave={handleLeaveGroup}
                    currentUserId={config.userId}
                />

                {previewPost && (
                    <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 2000 }}>
                        <div className="modal-dialog modal-dialog-centered modal-lg">
                            <div className="modal-content shadow-lg border-0 rounded-4">
                                <div className="modal-header border-0 pb-0">
                                    <h5 className="modal-title fw-bold text-primary">Reported Content Preview</h5>
                                    <button type="button" className="btn-close" onClick={() => setPreviewPost(null)}></button>
                                </div>
                                <div className="modal-body py-4">
                                    <PostItem post={previewPost} allPosts={[]} />
                                </div>
                                <div className="modal-footer border-0 pt-0">
                                    <button type="button" className="btn btn-secondary rounded-pill px-4" onClick={() => setPreviewPost(null)}>Close</button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </SocialContext.Provider>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(
    <ErrorBoundary>
        <App />
    </ErrorBoundary>
);


