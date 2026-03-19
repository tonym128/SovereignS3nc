import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SovereignS3nc } from '../../../src/SovereignS3nc';
import { SocialManager, Post } from '../../../src/modules/Social';
import crypto from 'crypto';
import { Buffer } from 'buffer';

const App = () => {
    const [config, setConfig] = useState({
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
    const [autoLogin, setAutoLogin] = useState(localStorage.getItem('sov_auto_login') === 'true');
    const [rememberedUsers, setRememberedUsers] = useState<any[]>(() => {
        const saved = localStorage.getItem('sov_remembered_users');
        return saved ? JSON.parse(saved) : [];
    });
    const [sov, setSov] = useState<SovereignS3nc | null>(null);
    const [social, setSocial] = useState<SocialManager | null>(null);
    const [posts, setPosts] = useState<Post[]>([]);
    const [following, setFollowing] = useState<any[]>([]);
    const [allUsers, setAllUsers] = useState<any[]>([]);
    const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
    const [newPost, setNewPost] = useState('');
    const [newImage, setNewPostImage] = useState<Uint8Array | null>(null);
    const [newImagePreview, setNewImagePreview] = useState<string | null>(null);
    const [profile, setProfile] = useState<any>(null);
    const [profileCache, setProfileCache] = useState<Record<string, any>>(() => {
        const saved = localStorage.getItem('sov_profile_cache');
        return saved ? JSON.parse(saved) : {};
    });

    useEffect(() => {
        localStorage.setItem('sov_profile_cache', JSON.stringify(profileCache));
    }, [profileCache]);
    const [blobCache, setBlobCache] = useState<Record<string, string>>(() => {
        const saved = localStorage.getItem('sov_blob_cache');
        return saved ? JSON.parse(saved) : {};
    });

    useEffect(() => {
        localStorage.setItem('sov_blob_cache', JSON.stringify(blobCache));
    }, [blobCache]);
    const [syncing, setSyncing] = useState(false);
    const [currentTab, setCurrentTab] = useState<'feed' | 'friends' | 'messages' | 'profile'>('feed');
    const [messages, setMessages] = useState<any[]>([]);
    const [msgInput, setMsgInput] = useState('');
    const [selectedUser, setSelectedUser] = useState<string | null>(null);
    const [lookbackDays, setLookbackDays] = useState(5);

    useEffect(() => {
        if (isLoggedIn) {
            loadData();
        }
    }, [lookbackDays]);

    const handleLoadMore = () => {
        setLookbackDays(prev => prev + 5);
    };
    const [lastViewed, setLastViewed] = useState<Record<string, any>>(() => {
        const saved = localStorage.getItem('sov_last_viewed_v2');
        if (saved) return JSON.parse(saved);
        const old = localStorage.getItem('sov_last_viewed');
        const base = old ? JSON.parse(old) : { feed: Date.now(), friends: Date.now(), messages: Date.now() };
        return { ...base, chat: {} };
    });
    const [highlights, setHighlights] = useState<Record<string, number>>(() => {
        const saved = localStorage.getItem('sov_highlights');
        return saved ? JSON.parse(saved) : { feed: 0, friends: 0 };
    });
    const [discoveryMap, setDiscoveryMap] = useState<Record<string, number>>(() => {
        const saved = localStorage.getItem('sov_discovery_map');
        return saved ? JSON.parse(saved) : {};
    });

    useEffect(() => {
        localStorage.setItem('sov_discovery_map', JSON.stringify(discoveryMap));
    }, [discoveryMap]);
    const [unreadCounts, setUnreadCounts] = useState({ feed: 0, friends: 0, messages: 0 });
    const [userUnreadCounts, setUserUnreadCounts] = useState<Record<string, number>>({});

    useEffect(() => {
        localStorage.setItem('sov_last_viewed_v2', JSON.stringify(lastViewed));
    }, [lastViewed]);

    useEffect(() => {
        localStorage.setItem('sov_highlights', JSON.stringify(highlights));
    }, [highlights]);

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
            console.log(`[Login] Testing connection to proxy: ${currentConfig.endpoint}/_ping`);
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 5000);
            try {
                const testRes = await fetch(`${currentConfig.endpoint}/_ping`, { 
                    method: 'GET',
                    signal: controller.signal
                });
                clearTimeout(id);
                console.log(`[Login] Proxy connection test status: ${testRes.status}`);
            } catch (e: any) {
                clearTimeout(id);
                console.warn(`[Login] Proxy connection test failed: ${e.message}. This might be a network issue or the proxy is not running.`);
            }

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

            const instance = new SovereignS3nc({
                s3: s3Config,
                paths: { appId: currentConfig.appId, userId: currentConfig.userId, storeId: 'social' },
                password: currentConfig.password
            });

            await instance.init();
            setSov(instance);
            const sm = new SocialManager(instance, '');
            setSocial(sm);
            
            const profileData = await sm.getProfile();
            setProfile(profileData);

            setIsLoggedIn(true);
            localStorage.setItem('sov_social_config', JSON.stringify(currentConfig));
            localStorage.setItem('sov_auto_login', autoLogin.toString());

            // Load cached data immediately using the local instances
            await loadData(sm, instance);

            // Add to remembered users
            const newUser = { userId: currentConfig.userId, name: profileData?.name || currentConfig.userId, avatar: profileData?.avatar, config: currentConfig };
            setRememberedUsers(prev => {
                const updated = [newUser, ...prev.filter(u => u.userId !== currentConfig.userId)];
                localStorage.setItem('sov_remembered_users', JSON.stringify(updated));
                return updated;
            });
            
            setTimeout(() => {
                instance.sync().then(() => {
                    loadData();
                }).catch(e => {
                    console.warn("Initial sync failed, operating in offline mode.", e);
                    loadData(); 
                });
            }, 100);
        } catch (e: any) {
            alert('Login initialization failed: ' + e.message);
        }
    };

    const login = () => performLogin(config);

    const logout = () => {
        localStorage.removeItem('sov_social_config');
        setIsLoggedIn(false);
        setSov(null);
        setSocial(null);
        setPosts([]);
        setFollowing([]);
        setMessages([]);
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
                    let blob: any;
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

    const handleImageChange = async (e: any) => {
        const file = e.target.files[0];
        if (!file) return;
        const compressed = await compressImage(file);
        setNewPostImage(compressed);
        const reader = new FileReader();
        reader.onload = (ev) => setNewImagePreview(ev.target?.result as string);
        reader.readAsDataURL(new Blob([compressed]));
    };

    const handlePost = async () => {
        if (!social || !newPost) return;
        await social.post(newPost, true, newImage || undefined);
        setNewPost('');
        setNewPostImage(null);
        setNewImagePreview(null);
        await sync(); // Sync immediately after posting
    };

    const handleLike = async (postId: string) => {
        if (!social) return;
        await social.like(postId);
        await loadData();
    };

    const handleComment = async (post: Post) => {
        if (!social) return;
        const content = prompt(`Replying to ${post.userId}:`);
        if (content) {
            await social.comment(post.id, post.userId, content);
            await sync();
        }
    };

    const handleShare = async (post: Post) => {
        const text = `Post by ${post.userId}: ${post.content}`;
        try {
            await navigator.clipboard.writeText(text);
            alert('Post content copied to clipboard!');
        } catch (e) {
            alert(text);
        }
    };

    const sync = async () => {
        if (!sov || !social || syncing) return;
        setSyncing(true);
        try {
            await sov.sync();
            await social.syncOtherProfiles();
            setLastSyncTime(new Date().toLocaleTimeString());
            await loadData();
        } catch (e) {
            console.warn("Sync failed", e);
        } finally {
            setSyncing(false);
        }
    };

    // Auto-sync and badge clearing on tab change
    useEffect(() => {
        if (isLoggedIn) {
            sync();
            
            if (currentTab === 'feed' || currentTab === 'friends') {
                // When entering these tabs, the PREVIOUS lastViewed becomes the highlight threshold
                // and lastViewed itself moves to NOW to clear the badge.
                setHighlights(prev => ({ ...prev, [currentTab]: lastViewed[currentTab] || 0 }));
                setLastViewed(prev => ({ ...prev, [currentTab]: Date.now() }));
            }
        }
    }, [currentTab]);

    useEffect(() => {
        if (currentTab === 'messages' && selectedUser) {
            // Update per-user message viewed timestamp
            setLastViewed(prev => ({
                ...prev,
                chat: { ...(prev.chat || {}), [selectedUser]: Date.now() }
            }));
            setUserUnreadCounts(prev => ({ ...prev, [selectedUser]: 0 }));
        }
    }, [selectedUser, currentTab]);

    // Poll sync every 15 seconds
    useEffect(() => {
        if (!isLoggedIn || !sov || !social) return;
        const interval = setInterval(() => {
            sync();
        }, 15000);
        return () => clearInterval(interval);
    }, [isLoggedIn, sov, social]);

    const loadData = async (activeSocial?: SocialManager, activeSov?: SovereignS3nc) => {
        const s = activeSocial || social;
        const v = activeSov || sov;
        if (!s || !v) return;

        const registry = await v.getPublicRegistry();
        setAllUsers(registry);

        // Update discovery map for new users
        const now = Date.now();
        const newDiscoveryMap = { ...discoveryMap };
        let discoveryChanged = false;
        registry.forEach(u => {
            if (!newDiscoveryMap[u.userId]) {
                newDiscoveryMap[u.userId] = now;
                discoveryChanged = true;
            }
        });
        if (discoveryChanged) setDiscoveryMap(newDiscoveryMap);

        const followingList = await v.getFollowing();
        setFollowing(followingList);

        const dates: string[] = [];
        for (let i = 0; i < lookbackDays; i++) {
            const d = new Date();
            d.setUTCDate(d.getUTCDate() - i);
            dates.push(SovereignS3nc.getDateStr(d));
        }

        let allPosts: Post[] = [];
        for (const date of dates) {
            allPosts = [...allPosts, ...(await s.getPosts(date, 'public'))];
            for (const user of followingList) {
                allPosts = [...allPosts, ...(await s.getPosts(`${user.userId}/${date}`, 'followed'))];
            }
        }

        allPosts.sort((a, b) => b.timestamp - a.timestamp);
        await s.enrichLikes(allPosts, lookbackDays);
        setPosts(allPosts);

        const newMessages = await s.getInboxMessages(lookbackDays);
        setMessages(newMessages);

        // Calculate unread counts
        const feedUnread = allPosts.filter(p => p.timestamp > lastViewed.feed && p.userId !== config.userId).length;
        
        // Per-chat unread counting
        const userMsgUnreads: Record<string, number> = {};
        let totalMsgUnread = 0;
        newMessages.forEach(m => {
            if (m.senderId !== config.userId) {
                const userLastViewed = (lastViewed.chat || {})[m.senderId] || 0;
                if (m.timestamp > userLastViewed) {
                    userMsgUnreads[m.senderId] = (userMsgUnreads[m.senderId] || 0) + 1;
                    totalMsgUnread++;
                }
            }
        });

        // Friends bubble: any new users in registry since last viewed friends
        const friendsUnread = registry.filter(u => (discoveryMap[u.userId] || 0) > lastViewed.friends && u.userId !== config.userId).length;

        setUnreadCounts({
            feed: feedUnread,
            messages: totalMsgUnread,
            friends: friendsUnread
        });
        setUserUnreadCounts(userMsgUnreads);
    };

    const handleSendMessage = async () => {
        if (!social || !selectedUser || !msgInput) return;
        await social.sendDirectMessage(selectedUser, msgInput);
        setMsgInput('');
        await sync(); // Sync immediately after sending
    };


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
            if (!userData && social) {
                social.getProfile(userId).then(p => {
                    if (p) {
                        setUserData(p);
                        setProfileCache(prev => ({ ...prev, [userId]: p }));
                    }
                });
            }
        }, [userId, social, userData]);

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
            if (!userData && social) {
                social.getProfile(userId).then(p => {
                    if (p) {
                        setUserData(p);
                        setProfileCache(prev => ({ ...prev, [userId]: p }));
                    }
                });
            }
        }, [userId, social, userData]);

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
                        <div className="ms-2">
                            <div className="text-muted x-small">
                                {new Date(post.timestamp).toLocaleString()}
                                {post.parentUserId && (
                                    <span className="ms-1">
                                        replied to <UserName userId={post.parentUserId} className="fw-normal text-primary" />
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="mb-3">{post.content}</div>
                    {post.image && <BlobImage path={post.image} userId={post.userId} />}
                    <div className="border-top mt-3 pt-2 d-flex justify-content-around">
                        <button 
                            className={`btn btn-link text-decoration-none ${post.likedByMe ? 'text-primary fw-bold' : 'text-muted'}`} 
                            onClick={() => handleLike(post.id)}
                        >
                            Like {post.likesCount ? `(${post.likesCount})` : ''}
                        </button>
                        <button className="btn btn-link text-muted text-decoration-none" onClick={() => handleComment(post)}>Comment</button>
                        <button className="btn btn-link text-muted text-decoration-none" onClick={() => handleShare(post)}>Share</button>
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
                                            <div className="fw-bold text-truncate">{u.name}</div>
                                            <div className="x-small text-muted text-truncate">{u.userId}</div>
                                        </div>
                                        <span className="text-primary small">Login →</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <label className="form-label small fw-bold text-muted text-uppercase">Connection Settings</label>
                    <input className="form-control mb-2" placeholder="S3 Endpoint" value={config.endpoint} onChange={e => setConfig({...config, endpoint: e.target.value})} />
                    <input className="form-control mb-2" placeholder="Access Key" value={config.accessKeyId} onChange={e => setConfig({...config, accessKeyId: e.target.value})} />
                    <input className="form-control mb-2" type="password" placeholder="Secret Key" value={config.secretAccessKey} onChange={e => setConfig({...config, secretAccessKey: e.target.value})} />
                    <input className="form-control mb-4" placeholder="Bucket Name" value={config.bucketName} onChange={e => setConfig({...config, bucketName: e.target.value})} />
                    
                    <label className="form-label small fw-bold text-muted text-uppercase">Account Credentials</label>
                    <input className="form-control mb-2" placeholder="User ID" value={config.userId} onChange={e => setConfig({...config, userId: e.target.value})} />
                    <input className="form-control mb-3" type="password" placeholder="Password" value={config.password} onChange={e => setConfig({...config, password: e.target.value})} />
                    
                    <div className="form-check mb-4">
                        <input 
                            className="form-check-input" 
                            type="checkbox" 
                            id="autoLogin" 
                            checked={autoLogin} 
                            onChange={e => {
                                setAutoLogin(e.target.checked);
                                localStorage.setItem('sov_auto_login', e.target.checked.toString());
                            }} 
                        />
                        <label className="form-check-label small" htmlFor="autoLogin">
                            Auto-login next time
                        </label>
                    </div>

                    <button className="btn btn-fb w-100 py-2 fs-5 mb-3" onClick={login}>Log In</button>

                    <button 
                        className="btn btn-outline-danger w-100 py-2 btn-sm" 
                        onClick={async () => {
                            if (confirm('Are you sure? This will delete all local databases and settings.')) {
                                localStorage.clear();
                                const dbs = await window.indexedDB.databases();
                                dbs.forEach(db => {
                                    if (db.name?.startsWith('sov_') || db.name?.startsWith('test_db_')) {
                                        window.indexedDB.deleteDatabase(db.name);
                                    }
                                });
                                alert('All local data cleared. The page will now reload.');
                                window.location.reload();
                            }
                        }}
                    >
                        Reset All Local Data
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="container-fluid p-0">
            <nav className="navbar navbar-expand-lg navbar-light bg-white shadow-sm sticky-top px-3">
                <a className="navbar-brand text-primary fw-bold fs-3" href="#">sov</a>
                <div className="mx-auto d-flex align-items-center">
                    <button className={`btn mx-2 position-relative ${currentTab === 'feed' ? 'btn-light text-primary' : ''}`} onClick={() => setCurrentTab('feed')}>
                        Home
                        {unreadCounts.feed > 0 && <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">{unreadCounts.feed}</span>}
                    </button>
                    <button className={`btn mx-2 position-relative ${currentTab === 'friends' ? 'btn-light text-primary' : ''}`} onClick={() => setCurrentTab('friends')}>
                        Friends
                        {unreadCounts.friends > 0 && <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">{unreadCounts.friends}</span>}
                    </button>
                    <button className={`btn mx-2 position-relative ${currentTab === 'messages' ? 'btn-light text-primary' : ''}`} onClick={() => setCurrentTab('messages')}>
                        Messages
                        {unreadCounts.messages > 0 && <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">{unreadCounts.messages}</span>}
                    </button>
                    <button className={`btn mx-2 ${currentTab === 'profile' ? 'btn-light text-primary' : ''}`} onClick={() => setCurrentTab('profile')}>
                        Profile
                    </button>
                </div>
                <div className="d-flex align-items-center">
                    <UserAvatar userId={config.userId} size={32} />
                    <button className="btn btn-sm btn-outline-secondary ms-3" onClick={sync} disabled={syncing}>
                        {syncing ? '...' : 'Sync'}
                    </button>
                    <button className="btn btn-sm btn-outline-danger ms-2" onClick={logout}>
                        Logout
                    </button>
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
                                        <textarea className="post-input w-100" rows={1} placeholder={`What's on your mind, ${profile?.name || config.userId}?`} value={newPost} onChange={e => setNewPost(e.target.value)} />
                                    </div>
                                </div>
                                {newImagePreview && <img src={newImagePreview} className="img-fluid rounded mb-2" style={{maxHeight: '300px'}} />}
                                <div className="d-flex justify-content-between border-top pt-2">
                                    <input type="file" className="form-control form-control-sm border-0 w-auto" onChange={handleImageChange} />
                                    <button className="btn btn-fb px-4" onClick={handlePost}>Post</button>
                                </div>
                            </div>

                            {posts
                                .filter(post => !post.parentId || !posts.some(p => p.id === post.parentId))
                                .map(post => (
                                    <PostItem key={post.id} post={post} allPosts={posts} />
                                ))
                            }

                            <div className="text-center mt-4 mb-5">
                                <button className="btn btn-outline-secondary" onClick={handleLoadMore}>
                                    Load more history ({lookbackDays} days shown)
                                </button>
                            </div>
                        </div>
                    )}

                    {currentTab === 'friends' && (
                        <div className="col-md-8">
                            <div className="card p-3 mb-4 shadow-sm border-0">
                                <h5 className="fw-bold mb-3">Discover People</h5>
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
                                    {allUsers.length <= 1 && <div className="text-center py-5 text-muted">No other users found yet.</div>}
                                </div>
                            </div>
                        </div>
                    )}

                    {currentTab === 'profile' && (
                        <div className="col-md-6">
                            <div className="card p-4 shadow-sm border-0">
                                <h4 className="mb-4 fw-bold">Edit Profile</h4>
                                <div className="text-center mb-4">
                                    <div className="position-relative d-inline-block">
                                        {profile?.avatar ? (
                                            <img src={profile.avatar} style={{width: '120px', height: '120px', borderRadius: '50%', objectFit: 'cover'}} className="border shadow-sm" />
                                        ) : (
                                            <div className="bg-secondary text-white rounded-circle d-flex align-items-center justify-content-center border shadow-sm" style={{width: '120px', height: '120px', fontSize: '3rem'}}>
                                                {config.userId[0].toUpperCase()}
                                            </div>
                                        )}
                                        <label className="btn btn-sm btn-primary position-absolute bottom-0 end-0 rounded-circle" style={{width: '32px', height: '32px', padding: '4px'}}>
                                            ✎
                                            <input type="file" className="d-none" accept="image/*" onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (file) {
                                                    const reader = new FileReader();
                                                    reader.onload = async (ev) => {
                                                        const base64 = ev.target?.result as string;
                                                        await social?.updateProfile(profile?.name || config.userId, profile?.bio || '', base64);
                                                        setProfile(prev => ({ ...prev, avatar: base64 }));
                                                        await sync();
                                                    };
                                                    reader.readAsDataURL(file);
                                                }
                                            }} />
                                        </label>
                                    </div>
                                </div>

                                <div className="mb-3">
                                    <label className="form-label small fw-bold text-muted text-uppercase">Display Name</label>
                                    <input 
                                        className="form-control" 
                                        value={profile?.name || ''} 
                                        onChange={e => setProfile({...profile, name: e.target.value})} 
                                        placeholder="Your Name"
                                    />
                                </div>

                                <div className="mb-4">
                                    <label className="form-label small fw-bold text-muted text-uppercase">Bio</label>
                                    <textarea 
                                        className="form-control" 
                                        rows={3} 
                                        value={profile?.bio || ''} 
                                        onChange={e => setProfile({...profile, bio: e.target.value})} 
                                        placeholder="Tell us about yourself..."
                                    />
                                </div>

                                <button 
                                    className="btn btn-primary w-100 py-2 fw-bold" 
                                    onClick={async () => {
                                        await social?.updateProfile(profile?.name || config.userId, profile?.bio || '', profile?.avatar);
                                        await sync();
                                        alert('Profile updated and synced!');
                                    }}
                                >
                                    Save Changes
                                </button>
                                
                                <div className="mt-4 pt-3 border-top text-center">
                                    <div className="small text-muted mb-1">User ID</div>
                                    <code>{config.userId}</code>
                                </div>
                            </div>
                        </div>
                    )}

                    {currentTab === 'messages' && (
                        <div className="col-md-10">
                            <div className="card shadow-sm border-0" style={{height: '70vh'}}>
                                <div className="row g-0 h-100">
                                    <div className="col-4 border-end overflow-y-auto">
                                        <div className="p-3 border-bottom bg-light">
                                            <h5 className="mb-0">Chats</h5>
                                        </div>
                                        <div className="list-group list-group-flush">
                                            {following.map(user => (
                                                <button key={user.userId} className={`list-group-item list-group-item-action border-0 d-flex justify-content-between align-items-center ${selectedUser === user.userId ? 'bg-light' : ''}`} onClick={() => setSelectedUser(user.userId)}>
                                                    <UserAvatar userId={user.userId} />
                                                    {userUnreadCounts[user.userId] > 0 && (
                                                        <span className="badge rounded-pill bg-primary">{userUnreadCounts[user.userId]}</span>
                                                    )}
                                                </button>
                                            ))}
                                            {following.length === 0 && <div className="p-3 text-center text-muted small">Follow users to chat</div>}
                                        </div>
                                    </div>
                                    <div className="col-8 d-flex flex-column">
                                        {selectedUser ? (
                                            <>
                                                <div className="p-3 border-bottom bg-light d-flex align-items-center">
                                                    <UserAvatar userId={selectedUser} />
                                                </div>
                                                <div className="flex-grow-1 p-3 overflow-y-auto bg-white d-flex flex-column-reverse">
                                                    <div>
                                                        {(() => {
                                                            const chatMessages = messages
                                                                .filter(m => (m.senderId === selectedUser && m.recipientId === config.userId) || (m.senderId === config.userId && m.recipientId === selectedUser))
                                                                .sort((a,b) => a.timestamp - b.timestamp);
                                                            
                                                            const userLastViewed = (lastViewed.chat || {})[selectedUser!] || 0;
                                                            let dividerShown = false;

                                                            return chatMessages.map((m, index) => {
                                                                const isNew = m.senderId !== config.userId && m.timestamp > userLastViewed;
                                                                const showDivider = isNew && !dividerShown;
                                                                if (showDivider) dividerShown = true;

                                                                return (
                                                                    <React.Fragment key={m.id}>
                                                                        {showDivider && (
                                                                            <div className="d-flex align-items-center my-3">
                                                                                <div className="flex-grow-1 border-bottom border-primary opacity-25"></div>
                                                                                <div className="mx-3 small text-primary fw-bold">Messages from this point are new</div>
                                                                                <div className="flex-grow-1 border-bottom border-primary opacity-25"></div>
                                                                            </div>
                                                                        )}
                                                                        <div className={`d-flex mb-2 ${m.senderId === config.userId ? 'justify-content-end' : 'justify-content-start'}`}>
                                                                            <div className={`p-2 rounded-4 px-3 ${m.senderId === config.userId ? 'bg-primary text-white' : 'bg-light text-dark'} ${isNew ? 'border border-primary' : ''}`} style={{maxWidth: '75%'}}>
                                                                                {m.content}
                                                                                <div style={{fontSize: '0.6rem'}} className="mt-1 opacity-75">{new Date(m.timestamp).toLocaleTimeString()}</div>
                                                                            </div>
                                                                        </div>
                                                                    </React.Fragment>
                                                                );
                                                            });
                                                        })()}
                                                        
                                                        <div className="text-center mt-3">
                                                            <button className="btn btn-sm btn-link text-muted" onClick={handleLoadMore}>
                                                                Load older messages ({lookbackDays} days shown)
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="p-3 border-top bg-light">
                                                    <div className="input-group">
                                                        <input className="form-control rounded-pill" placeholder="Type a message..." value={msgInput} onChange={e => setMsgInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} />
                                                        <button className="btn btn-primary rounded-pill ms-2" onClick={handleSendMessage}>Send</button>
                                                    </div>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex-grow-1 d-flex align-items-center justify-content-center text-muted">
                                                Select a friend to start chatting
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
