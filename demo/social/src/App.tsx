import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { SovereignS3nc } from '../../../src/SovereignS3nc';
import { FeedModule, Post } from '../../../src/modules/Feed';
import { MessagingModule, Message } from '../../../src/modules/Messaging';
import { ProfileModule, Profile } from '../../../src/modules/Profile';
import { WebRTCRemoteAdapter } from '../../../src/adapters/WebRTCRemoteAdapter';
import { IRemoteAdapter, DownloadResult } from '../../../src/interfaces/IRemoteAdapter';
import crypto from 'crypto';
import { Buffer } from 'buffer';
import Peer from 'peerjs';

import { MediaUtils } from '../../../src/utils/MediaUtils';

const DEBUG = false;

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
        password: 'password123'
    });

    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const getStorageKey = (key: string) => `sov_${config.userId}_${key}`;

    const [autoLogin, setAutoLogin] = useState(localStorage.getItem('sov_auto_login') === 'true');
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
    const [currentTab, setCurrentTab] = useState<'feed' | 'friends' | 'messages' | 'rooms' | 'profile'>('feed');
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
    const [lookbackDays, setLookbackDays] = useState(5);
    const [isConnected, setIsConnected] = useState(true);
    const [manualDisconnect, setManualDisconnect] = useState(false);
    const [reconnectDelay, setReconnectDelay] = useState(1000);
    const [unreadCounts, setUnreadCounts] = useState({ feed: 0, friends: 0, messages: 0, rooms: 0 });
    const [userUnreadCounts, setUserUnreadCounts] = useState<Record<string, number>>({});

    const lastViewedRef = useRef(lastViewed);
    const discoveryMapRef = useRef(discoveryMap);
    const currentTabRef = useRef(currentTab);
    const selectedUserRef = useRef(selectedUser);

    useEffect(() => { lastViewedRef.current = lastViewed; }, [lastViewed]);
    useEffect(() => { discoveryMapRef.current = discoveryMap; }, [discoveryMap]);
    useEffect(() => { currentTabRef.current = currentTab; }, [currentTab]);
    useEffect(() => { selectedUserRef.current = selectedUser; }, [selectedUser]);

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
                    bc.onmessage = (e) => peer.receive(e.data);
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
                debug: DEBUG
            }, remoteAdapter, factory);

            await instance.init();
            setSov(instance);
            
            const fm = new FeedModule(instance);
            setFeed(fm);
            const mm = new MessagingModule(instance);
            setMessaging(mm);
            const pm = new ProfileModule(instance);
            setProfileModule(pm);

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
            localStorage.setItem('sov_social_config', JSON.stringify(currentConfig));
            localStorage.setItem('sov_auto_login', autoLogin.toString());

            await loadData(instance, fm, mm, pm);

            const newUser = { userId: currentConfig.userId, name: profileData?.name || currentConfig.userId, avatar: profileData?.avatar, config: currentConfig };
            setRememberedUsers(prev => {
                const updated = [newUser, ...prev.filter(u => u.userId !== currentConfig.userId)];
                localStorage.setItem('sov_remembered_users', JSON.stringify(updated));
                return updated;
            });
            
            setTimeout(() => {
                instance.sync().then(() => {
                    loadData(sov || undefined, feed || undefined, messaging || undefined, profileModule || undefined);
                }).catch(e => {
                    loadData(sov || undefined, feed || undefined, messaging || undefined, profileModule || undefined); 
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
        const compressed = await compressImage(file);
        if (isMessage) {
            setMsgImage(compressed);
            const reader = new FileReader();
            reader.onload = (ev) => setMsgImagePreview(ev.target?.result as string);
            reader.readAsDataURL(new Blob([compressed]));
        } else {
            setNewPostImage(compressed);
            const reader = new FileReader();
            reader.onload = (ev) => setNewImagePreview(ev.target?.result as string);
            reader.readAsDataURL(new Blob([compressed]));
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

    const sync = async () => {
        if (!sov || !feed || syncing || !isConnected) return;
        setSyncing(true);
        try {
            await sov.sync();
            if (profileModule) await profileModule.syncOtherProfiles();
            setLastSyncTime(new Date().toLocaleTimeString());
            await loadData(sov, feed, messaging, profileModule);
        } catch (e) {
        } finally {
            setSyncing(false);
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
        if (currentTab === 'messages' && selectedUser) {
            setLastViewed(prev => ({
                ...prev,
                chat: { ...(prev.chat || {}), [selectedUser]: Date.now() }
            }));
            setUserUnreadCounts(prev => ({ ...prev, [selectedUser]: 0 }));
        }
    }, [selectedUser, currentTab]);

    useEffect(() => {
        if (!isLoggedIn || !sov || !feed) return;
        const interval = setInterval(() => {
            sync();
        }, 15000);
        return () => clearInterval(interval);
    }, [isLoggedIn, sov, feed]);

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
            for (const user of followingList) {
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
        const compressed = await MediaUtils.compressImage(await new Promise(r => {
            const reader = new FileReader();
            reader.onload = (ev) => r(ev.target?.result as string);
            reader.readAsDataURL(file);
        }), 500 * 1024);
        
        const data = await (await fetch(compressed)).arrayBuffer();
        setGroupImage(new Uint8Array(data));
        setGroupImagePreview(compressed);
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
                {size > 30 && <span className="fw-bold">{p.name || userId}</span>}
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

    const PostItem = ({ post, allPosts, depth = 0 }: { post: Post, allPosts: Post[], depth?: number }) => {
        const replies = allPosts.filter(p => p.parentId === post.id);
        const isNew = post.timestamp > highlights.feed && post.userId !== config.userId;
        
        return (
            <div className={`mb-3 ${depth > 0 ? 'ms-4 border-start ps-3 mt-2' : ''}`}>
                <div key={post.id} className={`card post-card p-3 ${isNew ? 'border-primary shadow-sm' : ''}`} style={isNew ? {borderWidth: '2px', backgroundColor: '#f0f7ff'} : {}}>
                    <div className="d-flex align-items-center mb-3">
                        <UserAvatar userId={post.userId} />
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
                        {post.userId === config.userId && !post.isDeleted && (
                            <div className="dropdown">
                                <button className="btn btn-sm btn-light rounded-circle" data-bs-toggle="dropdown">⋮</button>
                                <ul className="dropdown-menu dropdown-menu-end">
                                    <li><button className="dropdown-item" onClick={() => handleEditPost(post)}>Edit</button></li>
                                    <li><button className="dropdown-item text-danger" onClick={() => handleDeletePost(post)}>Delete</button></li>
                                </ul>
                            </div>
                        )}
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
                    
                    <div className="form-check mb-4">
                        <input className="form-check-input" type="checkbox" id="autoLogin" checked={autoLogin} onChange={e => { setAutoLogin(e.target.checked); localStorage.setItem('sov_auto_login', e.target.checked.toString()); }} />
                        <label className="form-check-label small" htmlFor="autoLogin">Auto-login next time</label>
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
                <div className="mx-auto d-flex align-items-center">
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
                    <button data-testid="nav-rooms" className={`btn mx-2 ${currentTab === 'rooms' ? 'btn-light text-primary' : ''}`} onClick={() => setCurrentTab('rooms')}>
                        Rooms
                    </button>
                    <button data-testid="nav-profile" className={`btn mx-2 ${currentTab === 'profile' ? 'btn-light text-primary' : ''}`} onClick={() => setCurrentTab('profile')}>
                        Profile
                    </button>
                </div>
                <div className="d-flex align-items-center">
                    {config.syncMode === 'offline' && (
                        <button className="btn btn-sm btn-primary rounded-pill me-3" onClick={handleConnectRemote}>
                            <i className="bi bi-cloud-upload me-1"></i> Connect Remote
                        </button>
                    )}
                    <button 
                        className={`btn btn-link px-2 me-2 ${isConnected ? 'text-success' : 'text-danger'}`} 
                        onClick={toggleConnection}
                    >
                        <i className={`bi ${isConnected ? 'bi-cloud-check-fill' : 'bi-cloud-slash-fill'}`} style={{fontSize: '1.2rem'}}></i>
                    </button>
                    <UserAvatar userId={config.userId} size={32} />
                    <button className="btn btn-sm btn-outline-secondary ms-3" onClick={sync} disabled={syncing || config.syncMode === 'offline'}>
                        {syncing ? '...' : config.syncMode === 'offline' ? 'Offline' : 'Sync'}
                    </button>
                    <button className="btn btn-sm btn-outline-danger ms-2" onClick={logout}>Logout</button>
                </div>
            </nav>

            <div className="container mt-4">
                <div className="row justify-content-center">
                    {currentTab === 'feed' && (
                        <div className="feed-container">
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

                            {posts
                                .filter(post => !post.parentId || !posts.some(p => p.id === post.parentId))
                                .map(post => (
                                    <PostItem key={post.id} post={post} allPosts={posts} />
                                ))
                            }

                            <div className="text-center mt-4 mb-5">
                                <button className="btn btn-outline-secondary" onClick={handleLoadMore}>Load more history</button>
                            </div>
                        </div>
                    )}

                    {currentTab === 'friends' && (
                        <div className="col-md-8">
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
                                            <div key={u.userId} className={`list-group-item d-flex justify-content-between align-items-center border-0 py-3 rounded-3 mb-1 ${isNew ? 'border-start border-primary' : ''}`} style={isNew ? {backgroundColor: '#f0f7ff', borderLeftWidth: '4px'} : {}}>
                                                <UserAvatar userId={u.userId} />
                                                {following.find(f => f.userId === u.userId) ? (
                                                    <button className="btn btn-light btn-sm rounded-pill px-3" onClick={() => sov?.unfollow(u.userId).then(loadData)}>Following</button>
                                                ) : (
                                                    <button className="btn btn-primary btn-sm rounded-pill px-3" onClick={() => sov?.follow(u.userId).then(loadData)}>Follow</button>
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
                            <div className="card shadow-sm border-0" style={{height: '70vh'}}>
                                <div className="row g-0 h-100">
                                    <div className="col-4 border-end overflow-y-auto">
                                        <div className="p-3 border-bottom bg-light d-flex justify-content-between align-items-center">
                                            <h5 className="mb-0">Chats</h5>
                                            <button className="btn btn-sm btn-outline-primary rounded-circle" onClick={handleNewChat} style={{display:'none'}}>+</button>
                                        </div>
                                        <div className="list-group list-group-flush">
                                            {following.map(user => (
                                                <button key={user.userId} className={`list-group-item list-group-item-action border-0 d-flex justify-content-between align-items-center ${selectedUser === user.userId ? 'bg-light' : ''}`} onClick={() => setSelectedUser(user.userId)}>
                                                    <UserAvatar userId={user.userId} />
                                                    {userUnreadCounts[user.userId] > 0 && <span className="badge rounded-pill bg-primary">{userUnreadCounts[user.userId]}</span>}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="col-8 d-flex flex-column h-100 overflow-hidden">
                                        {selectedUser ? (
                                            <>
                                                <div className="p-3 border-bottom bg-light d-flex align-items-center">
                                                    <UserAvatar userId={selectedUser} />
                                                </div>
                                                <div className="flex-grow-1 p-3 overflow-y-auto bg-white d-flex flex-column-reverse">
                                                    {messages
                                                        .filter(m => (m.senderId === selectedUser && m.recipientId === config.userId) || (m.senderId === config.userId && m.recipientId === selectedUser))
                                                        .sort((a,b) => b.timestamp - a.timestamp)
                                                        .map((m) => (
                                                            <div key={m.id} className={`d-flex mb-2 ${m.senderId === config.userId ? 'justify-content-end' : 'justify-content-start'}`}>
                                                                <div className={`p-2 rounded-4 px-3 ${m.senderId === config.userId ? 'bg-primary text-white' : 'bg-light text-dark'}`} style={{maxWidth: '75%'}}>
                                                                    {m.isDeleted ? (
                                                                        <i className="small opacity-75">Message deleted</i>
                                                                    ) : m.content.startsWith('INVITE_GROUP:') ? (
                                                                        <div className="p-2 border rounded bg-white text-dark">
                                                                            <div className="fw-bold text-primary mb-1">Group Invitation</div>
                                                                            {(() => {
                                                                                try {
                                                                                    const info = JSON.parse(m.content.substring(13));
                                                                                    const myStatus = info.members.find((mb: any) => mb.userId === config.userId)?.status;
                                                                                    // Check if we already have this group locally and what our status is
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
                                                                    <div style={{fontSize: '0.6rem'}} className="mt-1 opacity-75 d-flex justify-content-between">
                                                                        <span>{new Date(m.timestamp).toLocaleTimeString()} {m.isEdited && "(Edited)"}</span>
                                                                        {m.senderId === config.userId && !m.isDeleted && (
                                                                            <span className="ms-2">
                                                                                <span className="cursor-pointer me-1" onClick={() => handleEditMessage(m)}>✎</span>
                                                                                <span className="cursor-pointer" onClick={() => handleDeleteMessage(m)}>🗑</span>
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))
                                                    }
                                                </div>
                                                <div className="p-3 border-top bg-light">
                                                    {msgImagePreview && <div className="mb-2"><img src={msgImagePreview} style={{maxHeight:'100px'}} className="rounded" /></div>}
                                                    <div className="input-group">
                                                        <input type="file" ref={msgFileRef} className="d-none" id="msgFile" onChange={(e)=>handleImageChange(e, true)} />
                                                        <label htmlFor="msgFile" className="btn btn-outline-secondary rounded-pill me-2">📷</label>
                                                        <input className="form-control rounded-pill" placeholder="Type a message..." value={msgInput} onChange={e => setMsgInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} />
                                                        <button className="btn btn-primary rounded-pill ms-2" onClick={handleSendMessage}>Send</button>
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
                            <div className="card shadow-sm border-0" style={{height: '70vh'}}>
                                <div className="row g-0 h-100">
                                    <div className="col-4 border-end overflow-y-auto">
                                        <div className="p-3 border-bottom bg-light d-flex justify-content-between align-items-center">
                                            <h5 className="mb-0">Rooms</h5>
                                            <button className="btn btn-sm btn-primary rounded-pill" onClick={handleCreateGroup}>+</button>
                                        </div>
                                        <div className="list-group list-group-flush">
                                            {groups.map(group => {
                                                const me = group.members.find((mb: any) => mb.userId === config.userId);
                                                const isPending = me?.status === 'pending';
                                                return (
                                                    <button key={group.id} className={`list-group-item list-group-item-action border-0 d-flex justify-content-between align-items-center ${selectedGroup?.id === group.id ? 'bg-light' : ''}`} onClick={() => setSelectedGroup(group)}>
                                                        <div className="fw-bold text-truncate">{group.name}</div>
                                                        {isPending && <span className="badge rounded-pill bg-warning text-dark">Invite</span>}
                                                        {!isPending && group.createdAt > (lastViewed.roomChat?.[group.id] || 0) && <span className="badge rounded-pill bg-primary">New</span>}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div className="col-8 d-flex flex-column h-100 overflow-hidden">
                                        {selectedGroup ? (
                                            <>
                                                <div className="p-3 border-bottom bg-light">
                                                    <div className="d-flex justify-content-between align-items-center mb-2">
                                                        <h6 className="mb-0 fw-bold">{selectedGroup.name}</h6>
                                                        <div className="d-flex align-items-center gap-2">
                                                            <div className="small text-muted">{new Date(selectedGroup.createdAt).toLocaleDateString()}</div>
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
                                                            .map((p) => (
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
                                                                            <div className="ms-4 p-2 rounded bg-light shadow-sm" style={{display:'inline-block', maxWidth:'90%'}}>
                                                                                {p.image && <BlobImage path={p.image} userId={p.userId} />}
                                                                                <div>{p.content}</div>
                                                                            </div>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            ))
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
                        <div className="col-md-6">
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

                            </div>
                        </div>
                    )}
                </div>
            </div>
            <Dialog dialog={dialog} setDialog={setDialog} profileCache={profileCache} />
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
root.render(<App />);

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
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 2000 }}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content shadow-lg border-0 rounded-4">
                    <div className="modal-header border-0 pb-0">
                        <h5 className="modal-title fw-bold text-primary">{dialog.title}</h5>
                        <button type="button" className="btn-close" onClick={dialog.onCancel}></button>
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
