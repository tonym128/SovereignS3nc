import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { SovereignS3nc } from '../../../src/SovereignS3nc';
import { FeedModule, Post } from '../../../src/modules/Feed';
import { MessagingModule, Message } from '../../../src/modules/Messaging';
import { ProfileModule, Profile } from '../../../src/modules/Profile';
import { ModerationModule, Report } from '../../../src/modules/Moderation';
import { WebRTCRemoteAdapter } from '../../../src/adapters/WebRTCRemoteAdapter';
import { IRemoteAdapter } from '../../../src/interfaces/IRemoteAdapter';
import { MediaUtils } from '../../../src/utils/MediaUtils';
import { PairingModal } from './PairingModal';

const DEBUG = true;

// Proxy adapter to simulate S3 path isolation for WebRTC
class PrefixProxyAdapter implements IRemoteAdapter {
    constructor(private baseAdapter: WebRTCRemoteAdapter, private prefix: string) {}
    private getKey(path: string) { return `${this.prefix}/${path}`; }
    uploadFile(path: string, data: Uint8Array, hash?: string) { return this.baseAdapter.uploadFile(this.getKey(path), data, hash); }
    downloadFile(path: string, ifNoneMatch?: string, timeout?: number) { return this.baseAdapter.downloadFile(this.getKey(path), ifNoneMatch, timeout); }
    getFileHash(path: string) { return this.baseAdapter.getFileHash(this.getKey(path)); }
    getFileEtag(path: string) { return this.baseAdapter.getFileEtag(this.getKey(path)); }
    canWrite(path: string) { return this.baseAdapter.canWrite(this.getKey(path)); }
}

const UserAvatar = ({ userId, profileCache, resolveImage, size = 40 }: { userId: string, profileCache: any, resolveImage: any, size?: number }) => {
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const p = profileCache[userId] || { name: userId };

    useEffect(() => {
        if (p.avatar && p.avatar.startsWith('public/blobs/')) {
            resolveImage(p.avatar, userId).then(setAvatarUrl);
        } else if (p.avatar && p.avatar.startsWith('data:')) {
            setAvatarUrl(p.avatar);
        }
    }, [p.avatar, userId, resolveImage]);

    return (
        <div className="d-flex align-items-center">
            {avatarUrl ? (
                <img src={avatarUrl} style={{width: size+'px', height: size+'px', borderRadius: '50%', objectFit: 'cover'}} className="me-2" />
            ) : (
                <div className="bg-secondary text-white rounded-circle d-flex align-items-center justify-content-center me-2" style={{width: size+'px', height: size+'px'}}>
                    {userId[0].toUpperCase()}
                </div>
            )}
            {size > 30 && <span className="fw-bold">{p.name || userId}</span>}
        </div>
    );
};

const PostItem = ({ post, userId, profileCache, resolveImage }: { post: Post, userId: string, profileCache: any, resolveImage: any }) => {
    const [imageUrl, setImageUrl] = useState<string | null>(null);

    useEffect(() => {
        if (post.image) {
            resolveImage(post.image, post.userId).then(setImageUrl);
        }
    }, [post.image, resolveImage]);

    return (
        <div className="card p-3 mb-3 border-0 shadow-sm">
            <div className="d-flex align-items-center mb-2">
                <UserAvatar userId={post.userId} profileCache={profileCache} resolveImage={resolveImage} size={24} />
                <span className="ms-2 small text-muted">{new Date(post.timestamp).toLocaleString()}</span>
            </div>
            <div className="mb-2">{post.content}</div>
            {imageUrl && <img src={imageUrl} className="img-fluid rounded" style={{maxHeight: '400px'}} />}
        </div>
    );
};

const MessageItem = ({ m, myId, resolveImage, resolveMessageImage }: { m: Message, myId: string, resolveImage: any, resolveMessageImage?: (message: Message) => Promise<string | null> }) => {
    const [imageUrl, setImageUrl] = useState<string | null>(null);

    useEffect(() => {
        if (m.image) {
            (resolveMessageImage ? resolveMessageImage(m) : resolveImage(m.image, m.senderId)).then(setImageUrl);
        }
    }, [m.image, m.localImage, m.imageEncryption]);

    return (
        <div className={`d-flex mb-3 ${m.senderId === myId ? 'justify-content-end' : 'justify-content-start'}`}>
            <div className={`p-2 rounded px-3 shadow-sm ${m.senderId === myId ? 'bg-primary text-white' : 'bg-white'}`} style={{maxWidth: '80%'}}>
                {m.content && <div>{m.content}</div>}
                {imageUrl && <img src={imageUrl} className="img-fluid rounded mt-1" style={{maxHeight: '300px'}} />}
                <div className={`extra-small mt-1 text-end ${m.senderId === myId ? 'text-white-50' : 'text-muted'}`}>
                    {new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </div>
            </div>
        </div>
    );
};

const App = () => {
    const [config, setConfig] = useState({
        syncMode: 'webrtc',
        appId: 'sov-social-local',
        userId: 'local-' + Math.random().toString(36).substring(7),
        password: 'password123',
        enableP2PPairing: new URLSearchParams(window.location.search).has('pairing')
    });

    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const getStorageKey = (key: string) => `sov_local_${config.userId}_${key}`;

    const [autoLogin, setAutoLogin] = useState(localStorage.getItem('sov_local_auto_login') === 'true');
    const [showPairing, setShowPairing] = useState(false);
    const [rememberedUsers, setRememberedUsers] = useState<any[]>(() => {
        const saved = localStorage.getItem('sov_local_remembered_users');
        return saved ? JSON.parse(saved) : [];
    });
    
    const [profileCache, setProfileCache] = useState<Record<string, any>>({});
    const [blobCache, setBlobCache] = useState<Record<string, string>>({});
    const [lastViewed, setLastViewed] = useState<Record<string, any>>({ feed: Date.now(), friends: Date.now(), messages: Date.now(), rooms: Date.now(), chat: {} });
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
    const [newPostImage, setNewPostImage] = useState<Uint8Array | null>(null);
    const [newPostImagePreview, setNewPostImagePreview] = useState<string | null>(null);
    const postFileRef = useRef<HTMLInputElement>(null);
    const [newMsgImage, setNewMsgImage] = useState<Uint8Array | null>(null);
    const [newMsgImagePreview, setNewMsgImagePreview] = useState<string | null>(null);
    const msgFileRef = useRef<HTMLInputElement>(null);
    const profileFileRef = useRef<HTMLInputElement>(null);
    const [profile, setProfile] = useState<any>(null);
    const [meshStats, setMeshStats] = useState({ connectedPeers: 0, peerIds: [] as string[] });

    useEffect(() => {
        if (!sov) return;
        const interval = setInterval(() => {
            setMeshStats(sov.getMeshStats());
        }, 3000);
        return () => clearInterval(interval);
    }, [sov]);

    const resolveImage = async (path?: string, userId?: string) => {
        if (!path || !sov) return null;
        if (blobCache[path]) return blobCache[path];

        try {
            const data = await sov.getBlob(path, userId);
            if (data) {
                const blob = new Blob([data]);
                const url = URL.createObjectURL(blob);
                setBlobCache(prev => ({ ...prev, [path]: url }));
                return url;
            }
        } catch (e) {
            console.error('[App] Failed to resolve image:', path, e);
        }
        return null;
    };

    const resolveMessageImage = async (message: Message): Promise<string | null> => {
        if (!messaging) return null;
        const data = await messaging.getMessageImage(message);
        if (!data) return null;
        return URL.createObjectURL(new Blob([data]));
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, type: 'post' | 'msg' | 'profile') => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            let dataUrl = event.target?.result as string;
            
            // Compress if needed
            try {
                dataUrl = await MediaUtils.compressImage(dataUrl, 100 * 1024); // 100KB target
            } catch (err) {}

            const response = await fetch(dataUrl);
            const binary = new Uint8Array(await response.arrayBuffer());

            if (type === 'post') {
                setNewPostImage(binary);
                setNewPostImagePreview(dataUrl);
            } else if (type === 'msg') {
                setNewMsgImage(binary);
                setNewMsgImagePreview(dataUrl);
            } else if (type === 'profile') {
                setProfile(prev => ({ ...prev, avatar: binary, avatarPreview: dataUrl }));
            }
        };
        reader.readAsDataURL(file);
    };
    const [syncing, setSyncing] = useState(false);
    const [currentTab, setCurrentTab] = useState<'feed' | 'friends' | 'messages' | 'rooms' | 'profile'>('feed');
    const [messages, setMessages] = useState<Message[]>([]);
    const [msgInput, setMsgInput] = useState('');
    const [selectedUser, setSelectedUser] = useState<string | null>(null);
    const [lookbackDays, setLookbackDays] = useState(5);
    const [unreadCounts, setUnreadCounts] = useState({ feed: 0, friends: 0, messages: 0, rooms: 0 });
    const [userUnreadCounts, setUserUnreadCounts] = useState<Record<string, number>>({});

    const [dialog, setDialog] = useState<any>(null);

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
            onConfirm: async (val: any) => { 
                setDialog(null); 
                if (val !== undefined) await onConfirm(val || ''); 
            }, 
            onCancel: () => setDialog(null) 
        });
    };

    useEffect(() => {
        const savedConfig = localStorage.getItem('sov_local_config');
        if (savedConfig && autoLogin) {
            try {
                const parsed = JSON.parse(savedConfig);
                setConfig(parsed);
                performLogin(parsed);
            } catch (e) {}
        }
    }, []);

    const performLogin = async (currentConfig: any) => {
        try {
            setConfig(currentConfig);
            
            const adapter = new WebRTCRemoteAdapter(currentConfig.userId);
            
            // Local Mesh via BroadcastChannel
            const bc = new BroadcastChannel('sov-webrtc-local-mesh');
            const peer = adapter.connectPeer((msg) => bc.postMessage(msg));
            if (peer) {
                bc.onmessage = (e) => peer.receive(e.data);
            }

            const getPrefix = (uid: string, sid: string) => `${currentConfig.appId}/${uid}/${sid}`;
            const remoteAdapter = new PrefixProxyAdapter(adapter, getPrefix(currentConfig.userId, 'social'));
            const factory = (uid: string) => {
                if (uid === 'global') return new PrefixProxyAdapter(adapter, getPrefix('global', 'users'));
                return new PrefixProxyAdapter(adapter, getPrefix(uid, 'social'));
            };

            const instance = new SovereignS3nc({
                offline: false,
                paths: { appId: currentConfig.appId, userId: currentConfig.userId, storeId: 'social' },
                password: currentConfig.password,
                autoFollowDiscoveredUsers: true,
                useWorker: false, // Simple for local demo
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
            
            const profileData = await pm.getProfile();
            setProfile(profileData);

            setIsLoggedIn(true);
            localStorage.setItem('sov_local_config', JSON.stringify(currentConfig));
            localStorage.setItem('sov_local_auto_login', autoLogin.toString());

            await loadData(instance, fm, mm, pm);

            const newUser = { userId: currentConfig.userId, name: profileData?.name || currentConfig.userId, avatar: profileData?.avatar, config: currentConfig };
            setRememberedUsers(prev => {
                const updated = [newUser, ...prev.filter(u => u.userId !== currentConfig.userId)];
                localStorage.setItem('sov_local_remembered_users', JSON.stringify(updated));
                return updated;
            });
            
            // Start periodic sync
            setInterval(() => sync(instance, fm, mm, pm), 5000);
        } catch (e: any) {
            showAlert('Login failed: ' + e.message, 'Login Error');
        }
    };

    const sync = async (v?: any, fm?: any, mm?: any, pm?: any) => {
        const activeSov = v || sov;
        if (!activeSov || syncing) return;
        setSyncing(true);
        try {
            await activeSov.sync();
            if (pm || profileModule) await (pm || profileModule).syncOtherProfiles();
            setLastSyncTime(new Date().toLocaleTimeString());
            await loadData(activeSov, fm || feed, mm || messaging, pm || profileModule);
        } catch (e) {} finally {
            setSyncing(false);
        }
    };

    const loadData = async (v?: any, fm?: any, mm?: any, pm?: any) => {
        const activeSov = v || sov;
        const activeFeed = fm || feed;
        const activeMessaging = mm || messaging;
        if (!activeSov || !activeFeed || !activeMessaging) return;

        const registry = await activeSov.getPublicRegistry();
        setAllUsers(registry);

        const followingList = await activeSov.getFollowing();
        setFollowing(followingList);

        const dates: string[] = [];
        for (let i = 0; i < lookbackDays; i++) {
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
        setPosts(allPosts);

        const newMessages = await activeMessaging.getInboxMessages(lookbackDays);
        setMessages(newMessages);

        // Auto-resolve profiles for new users
        const newProfiles: Record<string, any> = {};
        for (const user of [...registry, ...followingList]) {
            if (!profileCache[user.userId]) {
                try {
                    const p = await pm.getOtherProfile(user.userId);
                    if (p) newProfiles[user.userId] = p;
                } catch (e) {}
            }
        }
        if (Object.keys(newProfiles).length > 0) {
            setProfileCache(prev => ({ ...prev, ...newProfiles }));
        }
    };

    const handlePost = async () => {
        if (!feed || (!newPost && !newPostImage)) return;
        await feed.post(newPost, true, newPostImage || undefined);
        setNewPost('');
        setNewPostImage(null);
        setNewPostImagePreview(null);
        await sync(); 
    };

    const handleSendMessage = async () => {
        if (!messaging || !selectedUser || (!msgInput && !newMsgImage)) return;
        await messaging.sendDirectMessage(selectedUser, msgInput, newMsgImage || undefined);
        setMsgInput('');
        setNewMsgImage(null);
        setNewMsgImagePreview(null);
        await sync(); 
    };

    const logout = () => {
        localStorage.removeItem('sov_local_config');
        setIsLoggedIn(false);
        setSov(null);
    };

    if (!isLoggedIn) {
        return (
            <div className="container mt-5" style={{maxWidth: '500px'}}>
                <div className="card p-4 shadow-sm border-0 mb-4">
                    <h2 className="text-primary text-center fw-bold mb-4">Sovereign Local</h2>
                    <p className="text-center text-muted small mb-4">Pure Local WebRTC Social Demo (QR & BT)</p>
                    
                    {rememberedUsers.length > 0 && (
                        <div className="mb-4">
                            <label className="form-label small fw-bold text-muted text-uppercase">Switch Account</label>
                            <div className="list-group">
                                {rememberedUsers.map(u => (
                                    <button key={u.userId} className="list-group-item list-group-item-action d-flex align-items-center py-2" onClick={() => performLogin(u.config)}>
                                        <UserAvatar userId={u.userId} profileCache={profileCache} resolveImage={resolveImage} size={32} />
                                        <div className="flex-grow-1 ms-2">
                                            <div className="fw-bold">{u.name}</div>
                                            <div className="x-small text-muted">{u.userId}</div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <label className="form-label small fw-bold text-muted text-uppercase">Account Credentials</label>
                    <input className="form-control mb-2" placeholder="User ID" value={config.userId} onChange={e => setConfig({...config, userId: e.target.value})} />
                    <input className="form-control mb-3" type="password" placeholder="Password" value={config.password} onChange={e => setConfig({...config, password: e.target.value})} />
                    
                    <button className="btn btn-primary w-100 py-2 fs-5 mb-3" onClick={() => performLogin(config)}>Log In</button>
                    
                    <div className="text-center mt-3">
                        <button className="btn btn-link btn-sm text-danger text-decoration-none" onClick={() => { localStorage.clear(); window.location.reload(); }}>Reset Local Data</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="container-fluid p-0">
            <nav className="navbar navbar-light bg-white shadow-sm sticky-top px-3">
                <span className="navbar-brand text-primary fw-bold">sov <span className="badge bg-info fs-6 fw-normal">Local Mesh</span></span>
                <div className="d-flex align-items-center">
                    <div className="me-3 d-flex align-items-center gap-1 text-success fw-bold small">
                        <i className="bi bi-broadcast"></i>
                        <span>{meshStats.connectedPeers} peers</span>
                    </div>
                    {config.enableP2PPairing && (
                        <button className="btn btn-outline-primary rounded-pill me-2" onClick={() => setShowPairing(true)}>
                            <i className="bi bi-qr-code-scan"></i> Pair Device
                        </button>
                    )}
                    <UserAvatar userId={config.userId} profileCache={profileCache} resolveImage={resolveImage} size={32} />
                    <button className="btn btn-sm btn-outline-danger ms-2" onClick={logout}>Logout</button>
                </div>
            </nav>

            <div className="container mt-4">
                <div className="row">
                    <div className="col-md-3">
                        <div className="list-group list-group-flush mb-4">
                            <button className={`list-group-item list-group-item-action ${currentTab === 'feed' ? 'active' : ''}`} onClick={() => setCurrentTab('feed')}>Feed</button>
                            <button className={`list-group-item list-group-item-action ${currentTab === 'friends' ? 'active' : ''}`} onClick={() => setCurrentTab('friends')}>Friends</button>
                            <button className={`list-group-item list-group-item-action ${currentTab === 'messages' ? 'active' : ''}`} onClick={() => setCurrentTab('messages')}>Messages</button>
                            <button className={`list-group-item list-group-item-action ${currentTab === 'profile' ? 'active' : ''}`} onClick={() => setCurrentTab('profile')}>Profile</button>
                        </div>
                    </div>
                    <div className="col-md-9">
                        {currentTab === 'feed' && (
                            <div>
                                <div className="card p-3 mb-4">
                                    <textarea className="form-control mb-2" rows={2} placeholder="What's happening locally?" value={newPost} onChange={e => setNewPost(e.target.value)} />
                                    {newPostImagePreview && <img src={newPostImagePreview} className="img-fluid rounded mb-2" style={{maxHeight: '200px'}} />}
                                    <div className="d-flex justify-content-between align-items-center">
                                        <button className="btn btn-outline-secondary btn-sm" onClick={() => postFileRef.current?.click()}>
                                            <i className="bi bi-image"></i>
                                        </button>
                                        <input type="file" ref={postFileRef} hidden accept="image/*" onChange={e => handleFileChange(e, 'post')} />
                                        <button className="btn btn-primary" onClick={handlePost}>Post</button>
                                    </div>
                                </div>
                                {posts.map(post => (
                                    <PostItem key={post.id} post={post} userId={config.userId} resolveImage={resolveImage} />
                                ))}
                            </div>
                        )}

                        {currentTab === 'friends' && (
                            <div className="card p-3">
                                <h5 className="fw-bold mb-3">Local Peers</h5>
                                <div className="list-group list-group-flush">
                                    {allUsers.filter(u => u.userId !== config.userId).map(u => (
                                        <div key={u.userId} className="list-group-item d-flex justify-content-between align-items-center border-0 py-2">
                                            <UserAvatar userId={u.userId} profileCache={profileCache} resolveImage={resolveImage} />
                                            {following.find(f => f.userId === u.userId) ? (
                                                <button className="btn btn-light btn-sm rounded-pill" onClick={() => sov?.unfollow(u.userId).then(() => loadData())}>Following</button>
                                            ) : (
                                                <button className="btn btn-primary btn-sm rounded-pill" onClick={() => sov?.follow(u.userId).then(() => loadData())}>Follow</button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {currentTab === 'messages' && (
                            <div className="row g-0 h-100" style={{height: '60vh'}}>
                                <div className="col-4 border-end overflow-y-auto">
                                    <div className="list-group list-group-flush">
                                        {following.map(user => (
                                            <button key={user.userId} className={`list-group-item list-group-item-action ${selectedUser === user.userId ? 'bg-light' : ''}`} onClick={() => setSelectedUser(user.userId)}>
                                                <UserAvatar userId={user.userId} profileCache={profileCache} resolveImage={resolveImage} size={32} />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="col-8 d-flex flex-column h-100">
                                    {selectedUser ? (
                                        <>
                                            <div className="flex-grow-1 p-3 overflow-y-auto bg-light">
                                                {messages
                                                    .filter(m => (m.senderId === selectedUser && m.recipientId === config.userId) || (m.senderId === config.userId && m.recipientId === selectedUser))
                                                    .sort((a,b) => a.timestamp - b.timestamp)
                                                    .map(m => (
                                                        <MessageItem key={m.id} m={m} myId={config.userId} resolveImage={resolveImage} resolveMessageImage={resolveMessageImage} />
                                                    ))
                                                }
                                            </div>
                                            <div className="p-3 border-top">
                                                {newMsgImagePreview && <img src={newMsgImagePreview} className="img-fluid rounded mb-2" style={{maxHeight: '100px'}} />}
                                                <div className="input-group">
                                                    <button className="btn btn-outline-secondary" onClick={() => msgFileRef.current?.click()}>
                                                        <i className="bi bi-image"></i>
                                                    </button>
                                                    <input type="file" ref={msgFileRef} hidden accept="image/*" onChange={e => handleFileChange(e, 'msg')} />
                                                    <input className="form-control" placeholder="Type a message..." value={msgInput} onChange={e => setMsgInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} />
                                                    <button className="btn btn-primary" onClick={handleSendMessage}>Send</button>
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="flex-grow-1 d-flex align-items-center justify-content-center text-muted">Select a friend to chat</div>
                                    )}
                                </div>
                            </div>
                        )}

                        {currentTab === 'profile' && (
                            <div className="card p-4">
                                <h4 className="mb-4 fw-bold">My Local Profile</h4>
                                <div className="text-center mb-4">
                                    <div className="position-relative d-inline-block">
                                        <UserAvatar userId={config.userId} profileCache={{[config.userId]: profile}} resolveImage={resolveImage} size={100} />
                                        <button className="btn btn-sm btn-primary rounded-circle position-absolute bottom-0 end-0" onClick={() => profileFileRef.current?.click()}>
                                            <i className="bi bi-camera"></i>
                                        </button>
                                        <input type="file" ref={profileFileRef} hidden accept="image/*" onChange={e => handleFileChange(e, 'profile')} />
                                    </div>
                                </div>
                                <div className="mb-3">
                                    <label className="form-label small fw-bold">Display Name</label>
                                    <input className="form-control" value={profile?.name || ''} onChange={e => setProfile({...profile, name: e.target.value})} />
                                </div>
                                <button className="btn btn-primary w-100" onClick={async () => {
                                   let avatarToSave = profile?.avatar;
                                   if (profile?.avatarPreview) {
                                       avatarToSave = profile.avatarPreview; // Data URL for small avatars is fine or we can use the binary
                                   }
                                   await profileModule?.updateProfile(profile?.name || config.userId, '', avatarToSave);
                                   await sync();
                                   showAlert('Profile updated!');
                                }}>Save</button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

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
            
            <Dialog dialog={dialog} setDialog={setDialog} />
        </div>
    );
};

const Dialog = ({ dialog, setDialog }: any) => {
    const [inputValue, setInputValue] = useState(dialog?.defaultValue || '');
    if (!dialog) return null;

    return (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10000 }}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content shadow-lg border-0">
                    <div className="modal-header border-0">
                        <h5 className="modal-title fw-bold">{dialog.title}</h5>
                    </div>
                    <div className="modal-body">
                        <p>{dialog.message}</p>
                        {dialog.type === 'prompt' && (
                            <input className="form-control" value={inputValue} onChange={e => setInputValue(e.target.value)} />
                        )}
                    </div>
                    <div className="modal-footer border-0">
                        {dialog.type !== 'alert' && (
                            <button className="btn btn-light" onClick={dialog.onCancel}>Cancel</button>
                        )}
                        <button className="btn btn-primary" onClick={() => dialog.onConfirm(inputValue)}>Confirm</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
