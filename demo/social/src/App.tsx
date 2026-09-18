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

        fetch('config.json')
            .then(res => res.json())
            .then(data => {
                setConfig(prev => ({ ...prev, ...data }));
            })
            .catch(() => {});
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

    const BlobImage = ({ path, userId }: { path: string, userId: string }) => {
        const [src, setSrc] = useState<string | null>(blobCache[path]);
        useEffect(() => {
            if (!src && sov) {
                sov.getBlob(path, userId).then(data => {
                    if (data) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            const base64data = reader.result as string;
                            setSrc(base64data);
                            setBlobCache(prev => ({ ...prev, [path]: base64data }));
                        };
                        reader.readAsDataURL(new Blob([data]));
                    }
                });
            }
        }, [path, userId, sov]);

        if (!src) return <div className="bg-light p-5 text-center text-muted">Loading image...</div>;
        return <img src={src} className="img-fluid rounded" style={{maxHeight: '500px'}} />;
    };

    const UserAvatar = ({ userId, size = 40 }: { userId: string, size?: number }) => {
        const [userData, setUserData] = useState<any>(profileCache[userId]);
        useEffect(() => {
            if (profileModule) {
                profileModule.getProfile(userId).then(p => {
                    if (p && (!userData || p.updatedAt > (userData.updatedAt || 0) || p.name !== userData.name || p.avatar !== userData.avatar)) {
                        setUserData(p);
                        setProfileCache(prev => ({ ...prev, [userId]: p }));
                    }
                });
            }
        }, [userId, profileModule, lastSyncTime]);
        const p = userData || { name: userId };
        return (
            <div className="d-flex align-items-center">
                {p.avatar ? (
                    <img src={p.avatar} style={{width: size+'px', height: size+'px', borderRadius: '50%', objectFit: 'cover'}} className="me-2" />
                ) : (
                    <div className="bg-secondary text-white rounded-circle d-flex align-items-center justify-content-center me-2" style={{width: size+'px', height: size+'px'}}>
                        {userId[0].toUpperCase()}
                    </div>
                )}
                {size > 30 && (
                    <div className="d-flex flex-column">
                        <span className="fw-bold">{p.name || userId}</span>
                        {p.name && p.name !== userId && <small className="text-muted" style={{fontSize: '0.75rem'}}>@{userId}</small>}
                    </div>
                )}
            </div>
        );
    };

    const UserName = ({ userId, className }: { userId: string, className?: string }) => {
        const [userData, setUserData] = useState<any>(profileCache[userId]);
        useEffect(() => {
            if (profileModule) {
                profileModule.getProfile(userId).then(p => {
                    if (p && (!userData || p.updatedAt > (userData.updatedAt || 0) || p.name !== userData.name)) {
                        setUserData(p);
                        setProfileCache(prev => ({ ...prev, [userId]: p }));
                    }
                });
            }
        }, [userId, profileModule, lastSyncTime]);
        return <span className={className || 'fw-bold'}>{userData?.name || userId}</span>;
    };

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

    const PostItem = ({ post, allPosts, depth = 0 }: { post: Post, allPosts: Post[], depth?: number }) => {
        const replies = allPosts.filter(p => p.parentId === post.id);
        const isNew = post.timestamp > highlights.feed && post.userId !== config.userId;
        const isAdminPost = post.userId !== config.userId && isUserAnAdmin(post.userId);
        
        return (
            <div className={`mb-3 ${depth > 0 ? 'ms-4 border-start ps-3 mt-2' : ''}`}>
                <div key={post.id} className={`card post-card p-3 ${isAdminPost ? 'border-danger shadow-sm' : isNew ? 'border-primary shadow-sm' : ''}`} style={isAdminPost ? {borderWidth: '2px'} : isNew ? {borderWidth: '2px', backgroundColor: '#f0f7ff'} : {}}>
                    <div className="d-flex align-items-center mb-3">
                        <UserAvatar userId={post.userId} />
                        {isAdminPost && <span className="ms-2 badge bg-danger"><i className="bi bi-shield-check me-1"></i>Admin Action</span>}
                        <div className="ms-2 flex-grow-1">
                            <div className="text-muted x-small">
                                {new Date(post.timestamp).toLocaleString()}
                                {post.isEdited && <span className="ms-1 badge bg-light text-muted fw-normal">Edited</span>}
                                {post.parentUserId && (
                                    <span className="ms-1">
                                        replied to <UserName userId={post.parentUserId} className="fw-normal text-primary" />
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="dropdown">
                            <button className="btn btn-sm btn-light rounded-circle" data-bs-toggle="dropdown">⋮</button>
                            <ul className="dropdown-menu dropdown-menu-end">
                                {post.userId === config.userId && !post.isDeleted && (
                                    <>
                                        <li><button className="dropdown-item" onClick={() => handleEditPost(post)}>Edit</button></li>
                                        <li><button className="dropdown-item text-danger" onClick={() => handleDeletePost(post)}>Delete</button></li>
                                    </>
                                )}
                                {post.userId !== config.userId && (
                                    <li><button className="dropdown-item text-warning" onClick={() => handleReportPost(post)}>Report Abuse</button></li>
                                )}
                            </ul>
                        </div>
                    </div>
                    <div className="mb-3">
                        {post.isDeleted ? (
                            <i className="text-muted small">This post was deleted</i>
                        ) : (
                            post.content
                        )}
                    </div>
                    {post.image && !post.isDeleted && <BlobImage path={post.image} userId={post.userId} />}
                    <div className="border-top mt-3 pt-2 d-flex justify-content-around">
                        <button 
                            className={`btn btn-link text-decoration-none ${post.likedByMe ? 'text-primary fw-bold' : 'text-muted'}`} 
                            onClick={() => handleLike(post.id)}
                            disabled={post.isDeleted}
                        >
                            Like {post.likesCount ? `(${post.likesCount})` : ''}
                        </button>
                        <button className="btn btn-link text-muted text-decoration-none" onClick={() => handleComment(post)} disabled={post.isDeleted}>Comment</button>
                        <button className="btn btn-link text-muted text-decoration-none" onClick={() => handleShare(post)} disabled={post.isDeleted}>Share</button>
                    </div>
                </div>
                {replies.sort((a,b) => a.timestamp - b.timestamp).map(reply => (
                    <PostItem key={reply.id} post={reply} allPosts={allPosts} depth={depth + 1} />
                ))}
            </div>
        );
    };

    if (!isLoggedIn) {
        return (
            <div className="container mt-5" style={{maxWidth: '500px'}}>
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
                                            <img src={u.avatar} style={{width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover'}} className="me-2" />
                                        ) : (
                                            <div className="bg-secondary text-white rounded-circle d-flex align-items-center justify-content-center me-2" style={{width: '32px', height: '32px'}}>
                                                {u.userId[0].toUpperCase()}
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

                    <label className="form-label small fw-bold text-muted text-uppercase">Sync Mode</label>
                    <div className="btn-group w-100 mb-4 flex-wrap">
                        <input type="radio" className="btn-check" name="syncMode" id="modeOffline" autoComplete="off" checked={config.syncMode === 'offline'} onChange={() => setConfig({...config, syncMode: 'offline'})} />
                        <label className="btn btn-outline-primary" htmlFor="modeOffline">Offline-First</label>

                        <input type="radio" className="btn-check" name="syncMode" id="modeS3" autoComplete="off" checked={config.syncMode === 's3'} onChange={() => setConfig({...config, syncMode: 's3'})} />
                        <label className="btn btn-outline-primary" htmlFor="modeS3">S3 Cloud</label>
                        
                        <input type="radio" className="btn-check" name="syncMode" id="modeWebrtc" autoComplete="off" checked={config.syncMode === 'webrtc'} onChange={() => setConfig({...config, syncMode: 'webrtc'})} />
                        <label className="btn btn-outline-primary" htmlFor="modeWebrtc">WebRTC Mesh</label>
                    </div>

                    {config.syncMode === 's3' && (
                        <>
                            <label className="form-label small fw-bold text-muted text-uppercase">Connection Settings</label>
                            <input className="form-control mb-2" placeholder="S3 Endpoint" value={config.endpoint} onChange={e => setConfig({...config, endpoint: e.target.value})} />
                            <input className="form-control mb-2" placeholder="Access Key" value={config.accessKeyId} onChange={e => setConfig({...config, accessKeyId: e.target.value})} />
                            <input className="form-control mb-2" type="password" placeholder="Secret Key" value={config.secretAccessKey} onChange={e => setConfig({...config, secretAccessKey: e.target.value})} />
                            <input className="form-control mb-4" placeholder="Bucket Name" value={config.bucketName} onChange={e => setConfig({...config, bucketName: e.target.value})} />
                        </>
                    )}
                    
                    <label className="form-label small fw-bold text-muted text-uppercase">Account Credentials</label>
                    <input className="form-control mb-2" placeholder="User ID" value={config.userId} onChange={e => setConfig({...config, userId: e.target.value})} />
                    <input className="form-control mb-3" type="password" placeholder="Password" value={config.password} onChange={e => setConfig({...config, password: e.target.value})} />
                    
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
                <Dialog dialog={dialog} setDialog={setDialog} profileCache={profileCache} />
            </div>
        );
    }

    return (
        <div className="container-fluid p-0">
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
                        <i className={`bi ${isConnected ? 'bi-cloud-check-fill' : 'bi-cloud-slash-fill'}`} style={{fontSize: '1.2rem'}}></i>
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
                        <UserAvatar userId={config.userId} size={32} />
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

            <div className="container mt-4">
                <div className="row justify-content-center">
                    {currentTab === 'feed' && (
                        <div className="feed-container mobile-full-width">
                            <div className="card post-card p-3 mb-4">
                                <div className="d-flex mb-3">
                                    <UserAvatar userId={config.userId} />
                                    <div className="ms-2 flex-grow-1">
                                        <textarea className="post-input w-100" rows={1} placeholder={`What's on your mind?`} value={newPost} onChange={e => setNewPost(e.target.value)} onKeyDown={handlePostKeyDown} />
                                    </div>
                                </div>
                                {newImagePreview && <img src={newImagePreview} className="img-fluid rounded mb-2" style={{maxHeight: '300px'}} />}
                                <div className="d-flex justify-content-between border-top pt-2">
                                    <input type="file" ref={postFileRef} className="form-control form-control-sm border-0 w-auto" onChange={(e) => handleImageChange(e, false)} />
                                    <button className="btn btn-sov px-4" onClick={handlePost}>Post</button>
                                </div>
                            </div>

                            {posts.length === 0 ? (
                                <div className="text-center py-5 card border-0 shadow-sm rounded-4 mb-4">
                                    <div className="card-body">
                                        <div className="display-1 text-muted mb-4 opacity-25">
                                            <i className="bi bi-chat-square-text"></i>
                                        </div>
                                        <h4 className="fw-bold text-secondary">No posts yet</h4>
                                        <p className="text-muted mb-4">Follow some friends or create your first post to get started!</p>
                                        <button className="btn btn-primary rounded-pill px-4 shadow-sm" onClick={() => setCurrentTab('friends')}>
                                            Find People to Follow
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                posts
                                    .filter(post => !post.parentId || !posts.some(p => p.id === post.parentId))
                                    .map(post => (
                                        <PostItem key={post.id} post={post} allPosts={posts} />
                                    ))
                            )}

                            <div className="text-center mt-4 mb-5">
                                <button className="btn btn-outline-secondary" onClick={handleLoadMore}>Load more history</button>
                            </div>
                        </div>
                    )}

                    {currentTab === 'friends' && (
                        <div className="col-md-8 mobile-full-width">
                            <div className="card p-3 mb-4 shadow-sm border-0">
                                <div className="d-flex justify-content-between align-items-center mb-3">
                                    <h5 className="fw-bold mb-0">Discover People</h5>
                                    <button className="btn btn-sm btn-outline-primary rounded-pill" onClick={() => {
                                        showPrompt('Enter exact User ID to discover:', (uid) => {
                                            if (uid) {
                                                setDiscoveryMap(prev => {
                                                    const next = {...prev, [uid]: Date.now()};
                                                    // Trigger a sync shortly after adding them to discovery map
                                                    setTimeout(() => loadData(sov || undefined, feed || undefined, messaging || undefined, profileModule || undefined), 500);
                                                    return next;
                                                });
                                            }
                                        });
                                    }}>+ Add by ID</button>
                                </div>
                                <div className="list-group list-group-flush">
                                    {allUsers.filter(u => u.userId !== config.userId).map(u => {
                                        const isNew = (discoveryMap[u.userId] || 0) > highlights.friends;
                                        return (
                                            <div key={u.userId} data-testid={`user-item-${u.userId}`} className={`list-group-item d-flex justify-content-between align-items-center border-0 py-3 rounded-3 mb-1 ${isNew ? 'border-start border-primary' : ''}`} style={isNew ? {backgroundColor: '#f0f7ff', borderLeftWidth: '4px'} : {}}>
                                                <UserAvatar userId={u.userId} />
                                                {following.find(f => f.userId === u.userId) ? (
                                                    <button className="btn btn-light btn-sm rounded-pill px-3" onClick={async () => { await sov?.unfollow(u.userId); await loadData(); }}>Following</button>
                                                ) : (
                                                    <button className="btn btn-primary btn-sm rounded-pill px-3" onClick={async () => { await sov?.follow(u.userId, u.publicKey); await loadData(); }}>Follow</button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    {currentTab === 'messages' && (
                        <div className="col-md-10">
                            <div className="card shadow-sm border-0 mobile-full-width" style={{height: '75vh'}}>
                                <div className="row g-0 h-100">
                                    <div className={`col-md-4 border-end overflow-y-auto h-100 ${selectedUser ? 'mobile-hide' : ''}`}>
                                        <div className="p-3 border-bottom bg-light d-flex justify-content-between align-items-center">
                                            <h5 className="mb-0">Chats</h5>
                                            <button className="btn btn-sm btn-outline-primary rounded-circle" onClick={handleNewChat} style={{display:'none'}}>+</button>
                                        </div>
                                        <div className="list-group list-group-flush">
                                            {(() => {
                                                const chatUsers = [...following];
                                                messages.forEach(m => {
                                                    const otherId = m.senderId === config.userId ? m.recipientId : m.senderId;
                                                    if (!chatUsers.find(u => u.userId === otherId)) {
                                                        chatUsers.push({ userId: otherId } as any);
                                                    }
                                                });
                                                if (chatUsers.length === 0) return <div className="p-4 text-center text-muted small">No conversations yet. Follow someone to start chatting!</div>;
                                                return chatUsers.map(user => (
                                                    <button key={user.userId} data-testid={`chat-item-${user.userId}`} className={`list-group-item list-group-item-action border-0 d-flex justify-content-between align-items-center py-3 ${selectedUser === user.userId ? 'bg-light' : ''}`} onClick={() => setSelectedUser(user.userId)}>
                                                        <div className="d-flex align-items-center flex-grow-1 overflow-hidden">
                                                            <UserAvatar userId={user.userId} />
                                                            {isUserAnAdmin(user.userId) && <span className="ms-1 badge bg-danger" style={{fontSize: '0.6rem'}}>Admin</span>}
                                                        </div>
                                                        {userUnreadCounts[user.userId] > 0 && <span className="badge rounded-pill bg-primary">{userUnreadCounts[user.userId]}</span>}
                                                    </button>
                                                ));
                                            })()}
                                        </div>
                                    </div>
                                    <div className={`col-md-8 d-flex flex-column h-100 overflow-hidden ${!selectedUser ? 'mobile-hide' : ''}`}>
                                        {selectedUser ? (
                                            <>
                                                <div className="p-3 border-bottom bg-light d-flex align-items-center">
                                                    <button className="btn btn-sm btn-light rounded-circle me-3 d-md-none" onClick={() => setSelectedUser(null)}>
                                                        <i className="bi bi-arrow-left"></i>
                                                    </button>
                                                    <UserAvatar userId={selectedUser} />
                                                    {isUserAnAdmin(selectedUser) && <span className="ms-2 badge bg-danger mobile-hide">Official Administrator</span>}
                                                </div>
                                                <div className="flex-grow-1 p-3 overflow-y-auto bg-white d-flex flex-column-reverse">
                                                    {messages
                                                        .filter(m => (m.senderId === selectedUser && m.recipientId === config.userId) || (m.senderId === config.userId && m.recipientId === selectedUser))
                                                        .sort((a,b) => b.timestamp - a.timestamp)
                                                        .map((m) => {
                                                            const isAdminMsg = m.senderId !== config.userId && isUserAnAdmin(m.senderId);
                                                            return (
                                                                <div key={m.id} data-testid="message-bubble" className={`d-flex mb-2 ${m.senderId === config.userId ? 'justify-content-end' : 'justify-content-start'}`}>
                                                                    <div className={`p-2 rounded-4 px-3 ${m.senderId === config.userId ? 'bg-primary text-white' : isAdminMsg ? 'border border-danger bg-light text-dark shadow-sm' : 'bg-light text-dark'}`} style={{maxWidth: '85%', ...(isAdminMsg ? {borderWidth: '2px'} : {})}}>
                                                                        {isAdminMsg && <div className="badge bg-danger mb-1" style={{fontSize: '0.65rem'}}><i className="bi bi-shield-check me-1"></i>Admin Action</div>}
                                                                        {m.isDeleted ? (
                                                                            <i className="small opacity-75">Message deleted</i>
                                                                        ) : m.content.startsWith('INVITE_GROUP:') ? (
                                                                            <div className="p-2 border rounded bg-white text-dark">
                                                                                <div className="fw-bold text-primary mb-1">Group Invitation</div>
                                                                                {(() => {
                                                                                    try {
                                                                                        const info = JSON.parse(m.content.substring(13));
                                                                                        const localGroup = groups.find(g => g.id === info.id);
                                                                                        const localStatus = localGroup?.members.find((mb: any) => mb.userId === config.userId)?.status;
                                                                                        
                                                                                        return (
                                                                                            <>
                                                                                                <div className="small mb-2">
                                                                                                    <b>{m.senderId}</b> invited you to join <b>{info.name}</b>.
                                                                                                </div>
                                                                                                {localStatus === 'joined' ? (
                                                                                                    <span className="badge bg-success w-100">Joined</span>
                                                                                                ) : localStatus === 'declined' ? (
                                                                                                    <span className="badge bg-secondary w-100">Declined</span>
                                                                                                ) : (
                                                                                                    <div className="d-flex gap-2">
                                                                                                        <button className="btn btn-sm btn-success flex-grow-1" onClick={() => handleAcceptGroup(info)}>Accept</button>
                                                                                                        <button className="btn btn-sm btn-outline-danger flex-grow-1" onClick={() => handleDeclineGroup(info)}>Decline</button>
                                                                                                    </div>
                                                                                                )}
                                                                                            </>
                                                                                        );
                                                                                    } catch(e) { return <span>Invalid Invite</span>; }
                                                                                })()}
                                                                            </div>
                                                                        ) : (
                                                                            <>
                                                                                {m.image && <BlobImage path={m.image} userId={m.senderId} />}
                                                                                <div>{m.content}</div>
                                                                            </>
                                                                        )}
                                                                        <div style={{fontSize: '0.6rem'}} className={`mt-1 ${m.senderId === config.userId ? 'opacity-75' : 'text-muted'} d-flex justify-content-between align-items-center`}>
                                                                            <span>{new Date(m.timestamp).toLocaleTimeString()} {m.isEdited && "(Edited)"}</span>
                                                                            <div className="d-flex align-items-center">
                                                                                {m.senderId === config.userId && !m.isDeleted && (
                                                                                    <div className="me-2 d-flex">
                                                                                        {m.status === 'read' ? (
                                                                                            <i className="bi bi-check-all text-info" style={{fontSize: '0.9rem'}} title="Read"></i>
                                                                                        ) : m.status === 'delivered' ? (
                                                                                            <i className="bi bi-check-all" style={{fontSize: '0.9rem'}} title="Delivered"></i>
                                                                                        ) : (
                                                                                            <i className="bi bi-check" style={{fontSize: '0.9rem'}} title="Sent"></i>
                                                                                        )}
                                                                                    </div>
                                                                                )}
                                                                                {m.senderId === config.userId && !m.isDeleted && (
                                                                                    <span className="d-flex gap-2">
                                                                                        <span className="cursor-pointer" onClick={() => handleEditMessage(m)} title="Edit">✎</span>
                                                                                        <span className="cursor-pointer" onClick={() => handleDeleteMessage(m)} title="Delete">🗑</span>
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })
                                                    }
                                                </div>
                                                <div className="p-3 border-top bg-light">
                                                    {msgImagePreview && <div className="mb-2"><img src={msgImagePreview} style={{maxHeight:'100px'}} className="rounded" /></div>}
                                                    <div className="input-group">
                                                        <input type="file" ref={msgFileRef} className="d-none" id="msgFile" onChange={(e)=>handleImageChange(e, true)} />
                                                        <label htmlFor="msgFile" className="btn btn-outline-secondary rounded-pill me-2">📷</label>
                                                        <input data-testid="message-input" className="form-control rounded-pill" placeholder="Type a message..." value={msgInput} onChange={e => setMsgInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} />
                                                        <button data-testid="message-send-btn" className="btn btn-primary rounded-pill ms-2" onClick={handleSendMessage}>Send</button>
                                                    </div>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex-grow-1 d-flex align-items-center justify-content-center text-muted">Select a friend to start chatting</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {currentTab === 'rooms' && (
                        <div className="col-md-10">
                            <div className="card shadow-sm border-0 mobile-full-width" style={{height: '75vh'}}>
                                <div className="row g-0 h-100">
                                    <div className={`col-md-4 border-end overflow-y-auto h-100 ${selectedGroup ? 'mobile-hide' : ''}`}>
                                        <div className="p-3 border-bottom bg-light d-flex justify-content-between align-items-center">
                                            <h5 className="mb-0">Rooms</h5>
                                            <button className="btn btn-sm btn-primary rounded-pill" onClick={handleCreateGroup}>+</button>
                                        </div>
                                        <div className="list-group list-group-flush">
                                            {groups.length === 0 ? (
                                                <div className="p-4 text-center text-muted small">No rooms yet. Create one to start collaborating!</div>
                                            ) : groups.map(group => {
                                                const me = group.members.find((mb: any) => mb.userId === config.userId);
                                                const isPending = me?.status === 'pending';
                                                return (
                                                    <button key={group.id} className={`list-group-item list-group-item-action border-0 d-flex justify-content-between align-items-center py-3 ${selectedGroup?.id === group.id ? 'bg-light' : ''}`} onClick={() => setSelectedGroup(group)}>
                                                        <div className="fw-bold text-truncate">{group.name}</div>
                                                        {isPending && <span className="badge rounded-pill bg-warning text-dark">Invite</span>}
                                                        {!isPending && group.createdAt > (lastViewed.roomChat?.[group.id] || 0) && <span className="badge rounded-pill bg-primary">New</span>}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div className={`col-md-8 d-flex flex-column h-100 overflow-hidden ${!selectedGroup ? 'mobile-hide' : ''}`}>
                                        {selectedGroup ? (
                                            <>
                                                <div className="p-3 border-bottom bg-light">
                                                    <div className="d-flex justify-content-between align-items-center mb-2">
                                                        <div className="d-flex align-items-center">
                                                            <button className="btn btn-sm btn-light rounded-circle me-3 d-md-none" onClick={() => setSelectedGroup(null)}>
                                                                <i className="bi bi-arrow-left"></i>
                                                            </button>
                                                            <h6 className="mb-0 fw-bold">{selectedGroup.name}</h6>
                                                        </div>
                                                        <div className="d-flex align-items-center gap-2">
                                                            <div className="small text-muted mobile-hide">{new Date(selectedGroup.createdAt).toLocaleDateString()}</div>
                                                            {(selectedGroup.members.find((m: any) => m.userId === config.userId)?.role === 'owner' || selectedGroup.members.find((m: any) => m.userId === config.userId)?.role === 'admin') && (
                                                                <button className="btn btn-sm btn-outline-primary rounded-pill py-0 px-2" style={{fontSize: '0.7rem'}} onClick={handleManageMembers}>Manage</button>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="d-flex flex-wrap gap-1">
                                                        {selectedGroup.members.map((m: any) => (
                                                            <span key={m.userId} className={`badge rounded-pill border ${
                                                                m.status === 'joined' ? 'bg-success text-white border-success' : 
                                                                m.status === 'declined' ? 'bg-light text-muted border-secondary' : 
                                                                'bg-white text-dark border-warning'
                                                            }`} style={{fontSize: '0.65rem'}}>
                                                                {m.userId} ({m.status || 'pending'})
                                                            </span>
                                                        ))}
                                                    </div>
                                                    {selectedGroup.members.find((m: any) => m.userId === config.userId)?.status === 'pending' && (
                                                        <div className="mt-3 p-2 bg-warning bg-opacity-10 border border-warning rounded d-flex justify-content-between align-items-center">
                                                            <span className="small fw-bold">You have a pending invite to this room.</span>
                                                            <div className="d-flex gap-2">
                                                                <button className="btn btn-sm btn-success" onClick={() => handleAcceptGroup(selectedGroup)}>Accept</button>
                                                                <button className="btn btn-sm btn-outline-danger" onClick={() => handleDeclineGroup(selectedGroup)}>Decline</button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex-grow-1 p-3 overflow-y-auto bg-white d-flex flex-column-reverse">
                                                    <div className="d-flex flex-column">
                                                        {groupPosts
                                                            .sort((a,b) => a.timestamp - b.timestamp)
                                                            .map((p) => {
                                                                const isAdminGroupPost = p.userId !== config.userId && isUserAnAdmin(p.userId);
                                                                return (
                                                                    <div key={p.id} className={`mb-3 ${p.type === 'system' ? 'text-center' : ''}`}>
                                                                        {p.type === 'system' ? (
                                                                            <div className="x-small text-muted py-1 bg-light rounded-pill px-3 d-inline-block">
                                                                                <UserAvatar userId={p.userId} size={16} /> <span className="ms-1">{p.content}</span>
                                                                            </div>
                                                                        ) : (
                                                                            <>
                                                                                <div className="d-flex align-items-center justify-content-between mb-1">
                                                                                    <div className="d-flex align-items-center">
                                                                                        <UserAvatar userId={p.userId} size={24} />
                                                                                        {isAdminGroupPost && <span className="badge bg-danger ms-2" style={{fontSize: '0.65rem'}}><i className="bi bi-shield-check me-1"></i>Admin Action</span>}
                                                                                        <span className="ms-2 x-small text-muted">{new Date(p.timestamp).toLocaleString()}</span>
                                                                                        {p.isEdited && <span className="ms-2 x-small text-muted italic">(edited)</span>}
                                                                                    </div>
                                                                                    {(() => {
                                                                                        const isAuthor = p.userId === config.userId;
                                                                                        const myRole = selectedGroup.members.find((m: any) => m.userId === config.userId)?.role;
                                                                                        const canDelete = isAuthor || myRole === 'owner' || myRole === 'admin';
                                                                                        
                                                                                        if (!isAuthor && !canDelete) return null;
                                                                                        
                                                                                        return (
                                                                                            <div className="dropdown">
                                                                                                <button className="btn btn-link btn-sm text-muted p-0" type="button" data-bs-toggle="dropdown">
                                                                                                    <i className="bi bi-three-dots-vertical"></i>
                                                                                                </button>
                                                                                                <ul className="dropdown-menu dropdown-menu-end shadow-sm border-0 small">
                                                                                                    {isAuthor && (
                                                                                                        <li><button className="dropdown-item py-1" onClick={() => handleEditGroupPost(p)}>Edit</button></li>
                                                                                                    )}
                                                                                                    {canDelete && (
                                                                                                        <li><button className="dropdown-item py-1 text-danger" onClick={() => handleDeleteGroupPost(p)}>Delete</button></li>
                                                                                                    )}
                                                                                                </ul>
                                                                                            </div>
                                                                                        );
                                                                                    })()}
                                                                                </div>
                                                                                <div className={`ms-4 p-2 rounded bg-light shadow-sm ${isAdminGroupPost ? 'border border-danger' : ''}`} style={{display:'inline-block', maxWidth:'95%', ...(isAdminGroupPost ? {borderWidth: '2px'} : {})}}>
                                                                                    {p.image && <BlobImage path={p.image} userId={p.userId} />}
                                                                                    <div>{p.content}</div>
                                                                                </div>
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })
                                                        }
                                                    </div>
                                                </div>
                                                <div className="p-3 border-top bg-light">
                                                    {groupImagePreview && (
                                                        <div className="mb-2 position-relative d-inline-block">
                                                            <img src={groupImagePreview} className="img-thumbnail" style={{maxHeight: '100px'}} />
                                                            <button className="btn btn-sm btn-danger rounded-circle position-absolute top-0 start-100 translate-middle" onClick={() => { setGroupImage(null); setGroupImagePreview(null); if (groupFileRef.current) groupFileRef.current.value=''; }}>×</button>
                                                        </div>
                                                    )}
                                                    <div className="input-group">
                                                        <label className="btn btn-outline-secondary rounded-pill-start mb-0 d-flex align-items-center">
                                                            <i className="bi bi-image"></i>
                                                            <input type="file" ref={groupFileRef} className="d-none" accept="image/*" onChange={handleGroupImageChange} />
                                                        </label>
                                                        <input className="form-control" placeholder={`Post to ${selectedGroup.name}...`} value={groupInput} onChange={e => setGroupInput(e.target.value)} onKeyDown={e => (e.key === 'Enter' && (e.ctrlKey || !groupImage)) && handlePostToGroup()} />
                                                        <button className="btn btn-primary rounded-pill-end px-4" onClick={handlePostToGroup}>Post</button>
                                                    </div>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex-grow-1 d-flex align-items-center justify-content-center text-muted">Select a room to start collaborating</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {currentTab === 'profile' && (
                        <div className="col-md-6 mobile-full-width">
                            <div className="card p-4 shadow-sm border-0">
                                <h4 className="mb-4 fw-bold">Edit Profile</h4>
                                
                                <div className="text-center mb-4">
                                    {profile?.avatar ? (
                                        <img src={profile.avatar} style={{width: '120px', height: '120px', borderRadius: '50%', objectFit: 'cover'}} className="mb-2 shadow-sm" />
                                    ) : (
                                        <div className="bg-secondary text-white rounded-circle mx-auto d-flex align-items-center justify-content-center mb-2 shadow-sm" style={{width: '120px', height: '120px', fontSize: '3rem'}}>
                                            {config.userId[0].toUpperCase()}
                                        </div>
                                    )}
                                    <div>
                                        <label className="btn btn-sm btn-outline-primary rounded-pill">
                                            Change Avatar
                                            <input type="file" className="d-none" accept="image/*" onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (file) {
                                                    const reader = new FileReader();
                                                    reader.onload = (ev) => {
                                                        setProfile({ ...profile, avatar: ev.target?.result as string });
                                                    };
                                                    reader.readAsDataURL(file);
                                                }
                                            }} />
                                        </label>
                                    </div>
                                </div>

                                <div className="mb-3">
                                    <label className="form-label small fw-bold text-muted text-uppercase">Display Name</label>
                                    <input className="form-control" value={profile?.name || ''} onChange={e => setProfile({...profile, name: e.target.value})} placeholder="Your Name" />
                                </div>
                                <div className="mb-3">
                                    <label className="form-label small fw-bold text-muted text-uppercase">User ID (Share this for P2P)</label>
                                    <div className="input-group">
                                        <input type="text" className="form-control bg-light" value={config.userId} readOnly />
                                        <button className="btn btn-outline-secondary" onClick={() => {
                                            navigator.clipboard.writeText(config.userId);
                                            showAlert('User ID copied!', 'Clipboard');
                                        }}>Copy</button>
                                    </div>
                                </div>
                                <div className="mb-4">
                                    <label className="form-label small fw-bold text-muted text-uppercase">Bio</label>
                                    <textarea className="form-control" rows={3} value={profile?.bio || ''} onChange={e => setProfile({...profile, bio: e.target.value})} placeholder="Tell us about yourself..." />
                                </div>
                                <button className="btn btn-primary w-100 py-2 fw-bold" onClick={async () => {
                                   await profileModule?.updateProfile(profile?.name || config.userId, profile?.bio || '', profile?.avatar);
                                   await sync();
                                   showAlert('Profile updated!', 'Success');
                                }}>Save Changes</button>

                                <hr className="my-4" />
                                
                                <h5 className="fw-bold mb-3">Portable Archive</h5>
                                <div className="small text-muted mb-3">
                                    Export your profile and social feed as a single, standalone HTML file. 
                                    All images will be embedded directly in the file so it can be viewed offline.
                                </div>
                                
                                <div className="form-check mb-3">
                                    <input className="form-check-input" type="checkbox" id="exportAllPosts" checked={exportAllPosts} onChange={e => setExportAllPosts(e.target.checked)} />
                                    <label className="form-check-label small" htmlFor="exportAllPosts">
                                        Include posts from everyone I follow (otherwise only my posts)
                                    </label>
                                </div>

                                <button className="btn btn-outline-success w-100 py-2 fw-bold" onClick={async () => {
                                    try {
                                        showAlert('Generating static export... this may take a moment.', 'Exporting');
                                        
                                        // 1. Gather Profile and Posts
                                        const exportProfile = profile;
                                        const exportPosts = [...posts]
                                            .filter(p => exportAllPosts || p.userId === config.userId)
                                            .sort((a, b) => b.timestamp - a.timestamp);
                                        
                                        // 2. Helper to embed images as Base64
                                        const embedImages = async (postList: any[]) => {
                                            for (const post of postList) {
                                                if (post.image && post.image.startsWith('public/blobs/')) {
                                                    const blob = await sov?.getBlob(post.image, post.userId);
                                                    if (blob) {
                                                        const reader = new FileReader();
                                                        const dataUrl = await new Promise<string>((resolve) => {
                                                            reader.onload = (e) => resolve(e.target?.result as string);
                                                            reader.readAsDataURL(new Blob([blob]));
                                                        });
                                                        post.image = dataUrl;
                                                    }
                                                }
                                            }
                                        };
                                        
                                        await embedImages(exportPosts);
                                        
                                        // 3. Generate HTML
                                        const sanitize = (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
                                        
                                        const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sovereign Archive - ${exportProfile?.name || config.userId}</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #f0f2f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        .archive-header { background: white; padding: 2rem 0; border-bottom: 1px solid #ddd; margin-bottom: 2rem; }
        .avatar-large { width: 120px; height: 120px; border-radius: 50%; object-fit: cover; border: 4px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .post-card { background: white; border-radius: 8px; border: none; box-shadow: 0 1px 2px rgba(0,0,0,0.1); margin-bottom: 1.5rem; }
        .post-img { max-height: 500px; width: 100%; object-fit: contain; background: #000; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="archive-header">
        <div class="container text-center">
            ${exportProfile?.avatar ? `<img src="${exportProfile.avatar}" class="avatar-large mb-3">` : `<div class="bg-secondary text-white rounded-circle mx-auto d-flex align-items-center justify-content-center mb-3" style="width: 120px; height: 120px; font-size: 3rem;">${config.userId[0].toUpperCase()}</div>`}
            <h1 class="fw-bold">${sanitize(exportProfile?.name || config.userId)}</h1>
            <p class="text-muted">${sanitize(exportProfile?.bio || 'No bio provided.')}</p>
            <div class="badge bg-light text-dark border">${config.userId}</div>
        </div>
    </div>
    
    <div class="container pb-5" style="max-width: 700px;">
        <h4 class="fw-bold mb-4">Feed Archive (${exportPosts.length} posts)</h4>
        ${exportPosts.map(post => {
            const postUser = allUsers.find(u => u.userId === post.userId);
            const userName = postUser?.userId || post.userId;
            const initials = userName[0].toUpperCase();
            
            return `
            <div class="card post-card">
                <div class="card-body">
                    <div class="d-flex mb-3">
                        <div class="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center me-2" style="width: 40px; height: 40px;">${initials}</div>
                        <div>
                            <div class="fw-bold">${sanitize(userName)}</div>
                            <div class="text-muted small">${new Date(post.timestamp).toLocaleString()}</div>
                        </div>
                    </div>
                    <p style="white-space: pre-wrap;">${sanitize(post.content)}</p>
                    ${post.image ? `<img src="${post.image}" class="post-img mt-2">` : ''}
                </div>
            </div>
        `}).join('')}
        
        <div class="text-center text-muted mt-5 small">
            Exported from SovereignS3nc on ${new Date().toLocaleString()}
        </div>
    </div>
</body>
</html>`;

                                        // 4. Download
                                        const blob = new Blob([htmlContent], { type: 'text/html' });
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement('a');
                                        a.href = url;
                                        a.download = `sovereign_archive_\${config.userId}_\${new Date().toISOString().split('T')[0]}.html`;
                                        a.click();
                                        URL.revokeObjectURL(url);
                                        
                                        showAlert('Portable archive exported successfully!', 'Success');
                                    } catch (e: any) {
                                        showAlert('Export failed: ' + e.message, 'Error');
                                    }
                                }}>
                                    <i className="bi bi-file-earmark-arrow-down me-2"></i> Export Static Website
                                </button>

                            </div>

                            <div className="card p-4 shadow-sm border-0 mt-4">
                                <h4 className="mb-4 fw-bold">Security</h4>
                                <div className="mb-3">
                                    <label className="form-label small fw-bold text-muted text-uppercase">Old Password</label>
                                    <input className="form-control" type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} placeholder="Enter old password" />
                                </div>
                                <div className="mb-4">
                                    <label className="form-label small fw-bold text-muted text-uppercase">New Password</label>
                                    <input className="form-control" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Enter new password" />
                                </div>
                                <button className="btn btn-danger w-100 py-2 fw-bold" onClick={handleChangePassword}>Change Password</button>
                                <div className="mt-3 small text-muted">
                                    <b>Note:</b> Changing your password will migrate your private data on the remote storage to a new path derived from your new password.
                                </div>
                            </div>

                            <div className="card p-4 shadow-sm border-0 mt-4 d-md-none">
                                <h4 className="mb-4 fw-bold">Account Actions</h4>
                                {config.syncMode === 'offline' && (
                                    <button className="btn btn-primary w-100 py-2 fw-bold mb-3" onClick={handleConnectRemote}>
                                        <i className="bi bi-cloud-upload me-2"></i> Connect Remote
                                    </button>
                                )}
                                <button className="btn btn-outline-danger w-100 py-2 fw-bold" onClick={logout}>
                                    <i className="bi bi-box-arrow-right me-2"></i> Logout
                                </button>
                            </div>
                        </div>
                    )}

                    {currentTab === 'mesh' && (
                        <div className="col-md-8">
                            <div className="card p-4 shadow-sm border-0 mb-4">
                                <h4 className="fw-bold mb-4"><i className="bi bi-node-plus me-2 text-primary"></i>P2P Mesh Network</h4>
                                
                                <div className="row text-center mb-4">
                                    <div className="col-6">
                                        <div className="p-3 bg-light rounded shadow-sm">
                                            <div className="display-4 fw-bold text-primary">{meshStats.connectedPeers}</div>
                                            <div className="text-muted small text-uppercase">Connected Peers</div>
                                        </div>
                                    </div>
                                    <div className="col-6">
                                        <div className="p-3 bg-light rounded shadow-sm">
                                            <div className="display-4 fw-bold text-success">{config.syncMode === 'webrtc' || config.syncMode === 'peerjs' ? 'ON' : 'OFF'}</div>
                                            <div className="text-muted small text-uppercase">Mesh Status</div>
                                        </div>
                                    </div>
                                </div>

                                <h6 className="fw-bold mb-3">Gossip Activity Log</h6>
                                <div className="bg-dark text-light p-3 rounded mb-4" style={{ height: '300px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                                    {meshLog.length === 0 && <div className="text-muted italic">Waiting for mesh activity...</div>}
                                    {meshLog.map((log, i) => (
                                        <div key={i} className="mb-1 border-bottom border-secondary pb-1">
                                            <span className="text-info">[{new Date(log.time).toLocaleTimeString()}]</span> {log.msg}
                                        </div>
                                    ))}
                                </div>

                                <h6 className="fw-bold mb-2">Connected Peer IDs</h6>
                                <div className="d-flex flex-wrap gap-2">
                                    {meshStats.peerIds.length === 0 && <div className="text-muted small">No active peer IDs discovered.</div>}
                                    {meshStats.peerIds.map(id => (
                                        <span key={id} className="badge bg-light text-dark border small">{id}</span>
                                    ))}
                                </div>

                                <div className="mt-4 pt-4 border-top">
                                    <h6>Persistence Engine</h6>
                                    <p className="small text-muted">
                                        Your browser is acting as a persistent node in the mesh. 
                                        Any data Alice or Bob requests that you have in local storage (IndexedDB) will be served automatically, 
                                        even if the original author is offline.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {currentTab === 'admin' && isAdmin && (
                        <div className="col-md-10 mobile-full-width">
                            <div className="card p-4 shadow-sm border-0 mb-4">
                                <h4 className="mb-4 fw-bold text-danger"><i className="bi bi-shield-lock me-2"></i>Admin Dashboard</h4>
                                
                                <div className="alert alert-secondary py-3 mb-4 border-0">
                                    <h6 className="fw-bold mb-1">Admin Status</h6>
                                    {adminKeyPublished ? (
                                        <div className="text-success small"><i className="bi bi-check-circle-fill me-1"></i> Reporting is ACTIVE. Your public key is published.</div>
                                    ) : (
                                        <div className="text-warning small"><i className="bi bi-exclamation-triangle-fill me-1"></i> Reporting is INACTIVE. You must publish your admin key for users to send reports.</div>
                                    )}
                                </div>

                                <div className="row">
                                    <div className="col-md-6 mb-4">
                                        <div className="card h-100 border-0 bg-light">
                                            <div className="card-body">
                                                <h5 className="fw-bold mb-3">Governance</h5>
                                                <button className="btn btn-outline-danger w-100 mb-2" onClick={async () => {
                                                    const uid = await new Promise(resolve => showPrompt('Enter User ID to blacklist:', resolve));
                                                    if (uid && moderation) {
                                                        try {
                                                            await (moderation as any).blacklistUser(uid);
                                                            await sync();
                                                            showAlert(`User ${uid} has been blacklisted globally.`);
                                                        } catch (e: any) {
                                                            showAlert('Failed to blacklist: ' + e.message, 'Error');
                                                        }
                                                    }
                                                }}>
                                                    <i className="bi bi-person-x me-2"></i> Blacklist User
                                                </button>
                                                <button className="btn btn-outline-secondary w-100 mb-2" onClick={async () => {
                                                    if (sov) {
                                                        await sov.syncBlacklist();
                                                        showAlert('Blacklist synchronized with cloud.');
                                                    }
                                                }}>
                                                    <i className="bi bi-arrow-repeat me-2"></i> Sync Blacklist
                                                </button>
                                                <button className="btn btn-outline-primary w-100" onClick={async () => {
                                                    if (moderation) {
                                                        try {
                                                            await moderation.publishAdminKey();
                                                            setAdminKeyPublished(true);
                                                            showAlert('Admin public key published successfully for E2EE reporting.');
                                                        } catch (e: any) {
                                                            showAlert('Failed to publish admin key: ' + e.message, 'Error');
                                                        }
                                                    }
                                                }}>
                                                    <i className="bi bi-key me-2"></i> Publish Admin Key
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="col-md-6 mb-4">
                                        <div className="card h-100 border-0 bg-light">
                                            <div className="card-body">
                                                <h5 className="fw-bold mb-3">Provision User S3 Keys</h5>
                                                <div className="small text-muted mb-3">Generate dedicated S3 credentials for a new user to ensure infrastructure isolation.</div>
                                                <button className="btn btn-primary w-100 mb-2" onClick={async () => {
                                                    showPrompt('Enter new User ID to provision:', (uid) => {
                                                        if (uid) {
                                                            // In a real application, this would call your backend API
                                                            // e.g., POST /api/admin/provision { userId: uid }
                                                            // For the demo, we show the provisioning instruction.
                                                            showAlert(`To provision ${uid} in your S3 backend, ensure they have a key with read/write access to their prefixed paths and the global registry.`, 'Provisioning Instructions');
                                                        }
                                                    });
                                                }}>
                                                    <i className="bi bi-person-plus-fill me-2"></i> Create User Keys
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="row mb-4">
                                    <div className="col-12">
                                        <div className="card border-0 bg-light border-danger border-start border-4">
                                            <div className="card-body">
                                                <h5 className="fw-bold text-danger mb-3"><i className="bi bi-exclamation-triangle-fill me-2"></i>Data Management (Root Access)</h5>
                                                <div className="d-flex gap-3 flex-wrap">
                                                    <button className="btn btn-outline-primary" onClick={async () => {
                                                        if (moderation) {
                                                            try {
                                                                const data = await moderation.exportAllData();
                                                                const blob = new Blob([data], { type: 'application/json' });
                                                                const url = URL.createObjectURL(blob);
                                                                const a = document.createElement('a');
                                                                a.href = url;
                                                                a.download = `sovereign_export_${config.appId}_${new Date().toISOString().split('T')[0]}.json`;
                                                                a.click();
                                                                URL.revokeObjectURL(url);
                                                                showAlert('Data exported successfully.');
                                                            } catch (e: any) {
                                                                showAlert('Export failed: ' + e.message, 'Error');
                                                            }
                                                        }
                                                    }}>
                                                        <i className="bi bi-download me-2"></i> Export All Data
                                                    </button>
                                                    <label className="btn btn-outline-secondary mb-0">
                                                        <i className="bi bi-upload me-2"></i> Import Data
                                                        <input type="file" className="d-none" accept=".json" onChange={async (e) => {
                                                            const file = e.target.files?.[0];
                                                            if (file && moderation) {
                                                                const reader = new FileReader();
                                                                reader.onload = async (ev) => {
                                                                    try {
                                                                        const content = ev.target?.result as string;
                                                                        await moderation.importAllData(content);
                                                                        showAlert('Data imported successfully.');
                                                                        e.target.value = ''; // Reset
                                                                    } catch (err: any) {
                                                                        showAlert('Import failed: ' + err.message, 'Error');
                                                                    }
                                                                };
                                                                reader.readAsText(file);
                                                            }
                                                        }} />
                                                    </label>
                                                    <button className="btn btn-danger ms-auto" onClick={() => {
                                                        showConfirm('WARNING: This will permanently delete ALL user data, posts, and DMs for this App ID across the entire S3 bucket. This action CANNOT be undone. Are you absolutely sure?', async () => {
                                                            if (moderation) {
                                                                try {
                                                                    await moderation.burnItToTheGround();
                                                                    showAlert('All data has been burned to the ground.', 'System Purged');
                                                                } catch (e: any) {
                                                                    showAlert('Purge failed: ' + e.message, 'Error');
                                                                }
                                                            }
                                                        }, 'BURN IT TO THE GROUND');
                                                    }}>
                                                        <i className="bi bi-fire me-2"></i> BURN IT TO THE GROUND
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="d-flex align-items-center mt-2 mb-3">
                                    <h5 className="fw-bold mb-0 flex-grow-1">Abuse Reports</h5>
                                    <button className="btn btn-sm btn-outline-secondary" onClick={async () => {
                                        if (moderation) {
                                            const r = await moderation.getReports();
                                            setReports(r);
                                            showAlert(`Fetched ${r.length} reports.`);
                                        }
                                    }}>
                                        <i className="bi bi-arrow-repeat me-1"></i> Refresh
                                    </button>
                                </div>
                                <div className="table-responsive">
                                    <table className="table table-hover align-middle">
                                        <thead className="table-light">
                                            <tr>
                                                <th>Reporter</th>
                                                <th>Target</th>
                                                <th>Type</th>
                                                <th>Reason</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {reports.length === 0 ? (
                                                <tr>
                                                    <td colSpan={5} className="text-center py-4 text-muted">No pending reports found in this session.</td>
                                                </tr>
                                            ) : (
                                                reports.map(report => (
                                                    <tr key={report.id}>
                                                        <td><UserName userId={report.reporterId} /></td>
                                                        <td><UserName userId={report.targetUserId} /></td>
                                                        <td><span className="badge bg-info">{report.contentType}</span></td>
                                                        <td className="small">{report.reason}</td>
                                                        <td>
                                                            <div className="d-flex gap-2">
                                                                {report.evidence && (
                                                                    <button title="View Content" className="btn btn-sm btn-outline-primary" onClick={() => setPreviewPost(report.evidence)}>
                                                                        <i className="bi bi-eye"></i>
                                                                    </button>
                                                                )}
                                                                <button title="Delete Post Only" className="btn btn-sm btn-outline-danger" onClick={async () => {
                                                                    if (moderation && report.evidence && sov) {
                                                                        try {
                                                                            // Module DB path: userId/storeId/public/modules/name/date.db
                                                                            const today = SovereignS3nc.getDateStr(new Date(report.evidence.timestamp));
                                                                            const path = `${report.targetUserId}/social/public/modules/feed/${today}.db`;
                                                                            await moderation.deleteUserFile(path);
                                                                            await moderation.deleteReport(report.id);
                                                                            
                                                                            // Force sync to clear from admin's local followed cache
                                                                            await sov.sync(true);
                                                                            await loadData(sov);
                                                                            
                                                                            showAlert('Post deleted and report closed.');
                                                                        } catch (e: any) { showAlert(e.message); }
                                                                    }
                                                                }}>
                                                                    <i className="bi bi-trash"></i>
                                                                </button>
                                                                <button title="Ban User" className="btn btn-sm btn-danger" onClick={async () => {
                                                                    if (moderation && sov) {
                                                                        try {
                                                                            await moderation.banUser(report.targetUserId);
                                                                            await moderation.deleteReport(report.id);
                                                                            
                                                                            // Force sync to update everything
                                                                            await sov.sync(true);
                                                                            await loadData(sov);
                                                                            
                                                                            showAlert('User banned and all data purged.');
                                                                        } catch (e: any) { showAlert(e.message); }
                                                                    }
                                                                }}><i className="bi bi-person-x"></i> Ban</button>
                                                                <button title="Ignore Report" className="btn btn-sm btn-light" onClick={async () => {
                                                                    if (moderation) {
                                                                        await moderation.deleteReport(report.id);
                                                                        const r = await moderation.getReports();
                                                                        setReports(r);
                                                                    }
                                                                }}><i className="bi bi-x-lg"></i></button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="alert alert-info py-2 small mb-0">
                                    <i className="bi bi-info-circle me-2"></i>
                                    Reports are encrypted with the Admin Public Key and stored in <code>{config.appId}/admin/reports/</code>. A background worker or Lambda is typically used to decrypt and aggregate these.
                                </div>
                            </div>
                        </div>
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
    );
};

const ConflictResolutionModal = ({ conflict, onResolve }: { conflict: any, onResolve: (choice: 'local' | 'remote' | 'abort' | { mergedData: Uint8Array }) => void }) => {
    if (!conflict) return null;

    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onResolve('abort');
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onResolve]);

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const tryParse = (data: Uint8Array) => {
        try {
            return JSON.parse(new TextDecoder().decode(data));
        } catch (e) {
            return null;
        }
    };

    const localJson = tryParse(conflict.localData);
    const remoteJson = tryParse(conflict.remoteData);

    const handleMerge = () => {
        if (localJson && remoteJson) {
            // Merge objects: remote fields are kept, local fields overwrite
            const merged = { ...remoteJson, ...localJson };
            const mergedData = new TextEncoder().encode(JSON.stringify(merged));
            onResolve({ mergedData });
        }
    };

    const getPreview = (data: Uint8Array) => {
        try {
            const str = new TextDecoder().decode(data);
            return str.length > 500 ? str.substring(0, 500) + '...' : str;
        } catch (e) {
            return 'Binary Data';
        }
    };

    return (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 3000 }}>
            <div className="modal-dialog modal-dialog-centered modal-lg" role="document">
                <div className="modal-content shadow-lg border-0 rounded-4">
                    <div className="modal-header border-0 pb-0">
                        <h5 className="modal-title fw-bold text-danger"><i className="bi bi-exclamation-triangle-fill me-2"></i>Sync Conflict</h5>
                        <button type="button" className="btn-close" aria-label="Close" onClick={() => onResolve('abort')}></button>
                    </div>
                    <div className="modal-body py-4">
                        <p className="text-secondary">A conflict was detected during sync for the following file:</p>
                        <div className="alert alert-light border small mb-4">
                            <code>{conflict.path}</code>
                        </div>

                        {localJson && remoteJson && (
                            <div className="card border-info-subtle bg-info-subtle bg-opacity-10 mb-4 rounded-3">
                                <div className="card-body">
                                    <h6 className="fw-bold mb-2 text-info"><i className="bi bi-info-circle-fill me-2"></i>Semantic Comparison</h6>
                                    <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
                                        {Object.keys({ ...localJson, ...remoteJson }).map(key => {
                                            if (JSON.stringify(localJson[key]) !== JSON.stringify(remoteJson[key])) {
                                                return (
                                                    <div key={key} className="mb-2 x-small">
                                                        <div className="fw-bold text-dark">{key}:</div>
                                                        <div className="ps-2 border-start border-danger text-danger text-decoration-line-through">{JSON.stringify(remoteJson[key])}</div>
                                                        <div className="ps-2 border-start border-success text-success">{JSON.stringify(localJson[key])}</div>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="row g-3">
                            <div className="col-md-6">
                                <div className="card h-100 border-primary-subtle bg-primary-subtle bg-opacity-10">
                                    <div className="card-body">
                                        <h6 className="fw-bold text-primary mb-3">Local Version</h6>
                                        <div className="small mb-2"><strong>Size:</strong> {formatSize(conflict.localData.length)}</div>
                                        <div className="bg-white p-2 border rounded small" style={{ height: '120px', overflowY: 'auto' }}>
                                            <pre className="mb-0 text-dark" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                                {getPreview(conflict.localData)}
                                            </pre>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="col-md-6">
                                <div className="card h-100 border-success-subtle bg-success-subtle bg-opacity-10">
                                    <div className="card-body">
                                        <h6 className="fw-bold text-success mb-3">Remote Version</h6>
                                        <div className="small mb-2"><strong>Size:</strong> {formatSize(conflict.remoteData.length)}</div>
                                        <div className="bg-white p-2 border rounded small" style={{ height: '120px', overflowY: 'auto' }}>
                                            <pre className="mb-0 text-dark" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                                {getPreview(conflict.remoteData)}
                                            </pre>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="modal-footer border-0 pt-0 d-flex flex-wrap justify-content-center gap-2">
                        {localJson && remoteJson && (
                            <button type="button" className="btn btn-info text-white rounded-pill px-4 shadow-sm" onClick={handleMerge}>
                                <i className="bi bi-intersect me-2"></i>Smart Merge
                            </button>
                        )}
                        <button type="button" className="btn btn-primary rounded-pill px-4 shadow-sm" onClick={() => onResolve('local')}>Keep Local</button>
                        <button type="button" className="btn btn-success rounded-pill px-4 shadow-sm" onClick={() => onResolve('remote')}>Take Remote</button>
                        <button type="button" className="btn btn-outline-secondary rounded-pill px-4" onClick={() => onResolve('abort')}>Skip for Now</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const MemberManagementModal = ({ show, onClose, group, profileCache, onUpdateRole, onRemove, onAdd, onLeave, currentUserId }: any) => {
    if (!show || !group) return null;

    const myRole = group.members.find((m: any) => m.userId === currentUserId)?.role;

    return (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 2000 }}>
            <div className="modal-dialog modal-dialog-centered modal-lg">
                <div className="modal-content shadow-lg border-0 rounded-4">
                    <div className="modal-header border-0 pb-0">
                        <h5 className="modal-title fw-bold text-primary">Manage Members: {group.name}</h5>
                        <button type="button" className="btn-close" onClick={onClose}></button>
                    </div>
                    <div className="modal-body py-4">
                        <div className="d-flex justify-content-between align-items-center mb-3">
                            <h6 className="mb-0 fw-bold">Group Members ({group.members.length})</h6>
                            <button className="btn btn-sm btn-primary rounded-pill px-3" onClick={onAdd}>+ Add Members</button>
                        </div>
                        <div className="list-group">
                            {group.members.map((member: any) => {
                                const profile = profileCache[member.userId];
                                const isMe = member.userId === currentUserId;
                                const canManage = !isMe && (myRole === 'owner' || (myRole === 'admin' && member.role === 'member'));

                                return (
                                    <div key={member.userId} className="list-group-item d-flex align-items-center justify-content-between border-0 py-3 border-bottom">
                                        <div className="d-flex align-items-center">
                                            {profile?.avatar ? (
                                                <img src={profile.avatar} className="rounded-circle me-3" style={{ width: '40px', height: '40px', objectFit: 'cover' }} />
                                            ) : (
                                                <div className="rounded-circle bg-secondary text-white me-3 d-flex align-items-center justify-content-center" style={{ width: '40px', height: '40px' }}>
                                                    {member.userId[0].toUpperCase()}
                                                </div>
                                            )}
                                            <div>
                                                <div className="fw-bold">{profile?.name || member.userId} {isMe && "(You)"}</div>
                                                <div className="small text-muted">
                                                    <span className={`badge rounded-pill ${member.role === 'owner' ? 'bg-danger' : member.role === 'admin' ? 'bg-primary' : 'bg-secondary'} me-2`}>
                                                        {member.role}
                                                    </span>
                                                    <span className="text-capitalize">{member.status || 'pending'}</span>
                                                </div>
                                            </div>
                                        </div>
                                        {canManage && (
                                            <div className="d-flex gap-2">
                                                {member.role === 'member' && (
                                                    <button className="btn btn-sm btn-outline-primary rounded-pill px-3" onClick={() => onUpdateRole(member.userId, 'admin')}>Make Admin</button>
                                                )}
                                                {member.role === 'admin' && myRole === 'owner' && (
                                                    <button className="btn btn-sm btn-outline-secondary rounded-pill px-3" onClick={() => onUpdateRole(member.userId, 'member')}>Remove Admin</button>
                                                )}
                                                <button className="btn btn-sm btn-outline-danger rounded-pill px-3" onClick={() => {
                                                    if (confirm(`Are you sure you want to remove ${member.userId}?`)) onRemove(member.userId);
                                                }}>Remove</button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <div className="modal-footer border-0 pt-0 d-flex justify-content-between">
                        {myRole !== 'owner' ? (
                            <button type="button" className="btn btn-outline-danger rounded-pill px-4" onClick={onLeave}>Leave Room</button>
                        ) : <div></div>}
                        <button type="button" className="btn btn-light rounded-pill px-4" onClick={onClose}>Close</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(
    <ErrorBoundary>
        <App />
    </ErrorBoundary>
);

const Dialog = ({ dialog, setDialog, profileCache }: { dialog: any, setDialog: any, profileCache: any }) => {
    const [inputValue, setInputValue] = useState(dialog?.defaultValue || '');
    const [selectedValues, setSelectedValues] = useState<string[]>([]);
    const [searchQuery, setSearchSearchQuery] = useState('');
    const [configData, setConfigData] = useState({
        syncMode: 's3',
        region: 'us-east-1',
        endpoint: '',
        accessKeyId: '',
        secretAccessKey: '',
        bucketName: ''
    });

    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setDialog(null);
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [setDialog]);
    
    useEffect(() => {
        setInputValue(dialog?.defaultValue || '');
        setSelectedValues([]);
        setSearchSearchQuery('');
    }, [dialog]);

    if (!dialog) return null;

    const toggleOption = (val: string) => {
        setSelectedValues(prev => 
            prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
        );
    };

    const filteredOptions = dialog.options?.filter((opt: any) => 
        opt.label.toLowerCase().includes(searchQuery.toLowerCase()) || 
        opt.value.toLowerCase().includes(searchQuery.toLowerCase())
    ) || [];

    return (
        <div className="modal show d-block" tabIndex={-1} role="dialog" aria-modal="true" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 2000 }}>
            <div className="modal-dialog modal-dialog-centered" role="document">
                <div className="modal-content shadow-lg border-0 rounded-4">
                    <div className="modal-header border-0 pb-0">
                        <h5 className="modal-title fw-bold text-primary">{dialog.title}</h5>
                        <button type="button" className="btn-close" aria-label="Close" onClick={dialog.onCancel}></button>
                    </div>
                    <div className="modal-body py-4">
                        <p className="mb-3 text-secondary">{dialog.message}</p>
                        {dialog.type === 'prompt' && (
                            <input 
                                autoFocus
                                className="form-control rounded-pill px-3 shadow-sm" 
                                value={inputValue} 
                                onChange={e => setInputValue(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && dialog.onConfirm(inputValue)}
                            />
                        )}
                        {dialog.type === 'config' && (
                            <div className="config-form">
                                <label className="form-label small fw-bold">Sync Mode</label>
                                <select className="form-select mb-3 rounded-pill" value={configData.syncMode} onChange={e => setConfigData({...configData, syncMode: e.target.value})}>
                                    <option value="s3">S3 Cloud</option>
                                    <option value="webrtc">WebRTC Mesh</option>
                                </select>
                                
                                {configData.syncMode === 's3' && (
                                    <>
                                        <input className="form-control mb-2 rounded-pill" placeholder="Region" value={configData.region} onChange={e => setConfigData({...configData, region: e.target.value})} />
                                        <input className="form-control mb-2 rounded-pill" placeholder="Endpoint (optional)" value={configData.endpoint} onChange={e => setConfigData({...configData, endpoint: e.target.value})} />
                                        <input className="form-control mb-2 rounded-pill" placeholder="Access Key" value={configData.accessKeyId} onChange={e => setConfigData({...configData, accessKeyId: e.target.value})} />
                                        <input className="form-control mb-2 rounded-pill" type="password" placeholder="Secret Key" value={configData.secretAccessKey} onChange={e => setConfigData({...configData, secretAccessKey: e.target.value})} />
                                        <input className="form-control mb-2 rounded-pill" placeholder="Bucket Name" value={configData.bucketName} onChange={e => setConfigData({...configData, bucketName: e.target.value})} />
                                    </>
                                )}
                            </div>
                        )}
                        {dialog.type === 'multiselect' && (
                            <>
                                <div className="mb-3">
                                    <input 
                                        type="text" 
                                        className="form-control form-control-sm rounded-pill px-3" 
                                        placeholder="Search members..." 
                                        value={searchQuery}
                                        onChange={e => setSearchSearchQuery(e.target.value)}
                                    />
                                </div>
                                <div className="list-group overflow-y-auto" style={{ maxHeight: '300px' }}>
                                    {filteredOptions.length > 0 ? (
                                        filteredOptions.map((opt: any) => {
                                            const userProfile = profileCache[opt.value];
                                            return (
                                                <label key={opt.value} className="list-group-item d-flex align-items-center border-0 py-2 cursor-pointer">
                                                    <input 
                                                        type="checkbox" 
                                                        className="form-check-input me-3" 
                                                        checked={selectedValues.includes(opt.value)}
                                                        onChange={() => toggleOption(opt.value)}
                                                    />
                                                    <div className="d-flex align-items-center flex-grow-1">
                                                        {userProfile?.avatar ? (
                                                            <img src={userProfile.avatar} className="rounded-circle me-2" style={{ width: '30px', height: '30px', objectFit: 'cover' }} />
                                                        ) : (
                                                            <div className="rounded-circle bg-secondary text-white me-2 d-flex align-items-center justify-content-center" style={{ width: '30px', height: '30px', fontSize: '0.8rem' }}>
                                                                {opt.value[0].toUpperCase()}
                                                            </div>
                                                        )}
                                                        <div>
                                                            <div className="fw-bold small">{userProfile?.name || opt.label}</div>
                                                            <div className="text-muted" style={{ fontSize: '0.7rem' }}>{opt.value}</div>
                                                        </div>
                                                    </div>
                                                </label>
                                            );
                                        })
                                    ) : (
                                        <div className="text-center py-3 text-muted small">No members found</div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                    <div className="modal-footer border-0 pt-0">
                        {dialog.type !== 'alert' && (
                            <button type="button" className="btn btn-light rounded-pill px-4" onClick={dialog.onCancel}>Cancel</button>
                        )}
                        <button 
                            type="button" 
                            className="btn btn-primary rounded-pill px-4 shadow-sm" 
                            onClick={() => dialog.onConfirm(dialog.type === 'multiselect' ? selectedValues : (dialog.type === 'config' ? configData : inputValue))}
                        >
                            {dialog.type === 'alert' ? 'OK' : 'Confirm'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
