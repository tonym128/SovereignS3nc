import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SovereignS3nc } from '../../../src/SovereignS3nc';
import { SocialManager, Post } from '../../../src/modules/Social';
import crypto from 'crypto';
import { Buffer } from 'buffer';

const App = () => {
    console.log('Sovereign Social Demo starting...');
    const [config, setConfig] = useState({
        region: 'ap-southeast-1',
        endpoint: '',
        accessKeyId: '',
        secretAccessKey: '',
        bucketName: '',
        appId: 'demo-app',
        userId: 'user-' + Math.random().toString(36).substring(7),
        password: 'password123'
    });

    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [sov, setSov] = useState<SovereignS3nc | null>(null);
    const [social, setSocial] = useState<SocialManager | null>(null);
    const [posts, setPosts] = useState<Post[]>([]);
    const [following, setFollowing] = useState<any[]>([]);
    const [allUsers, setAllUsers] = useState<any[]>([]);
    const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
    const [newPost, setNewPost] = useState('');
    const [newImage, setNewPostImage] = useState<string | null>(null);
    const [profile, setProfile] = useState<any>(null);
    const [profileCache, setProfileCache] = useState<Record<string, any>>({});
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [savedAccounts, setSavedAccounts] = useState<string[]>([]);

    useEffect(() => {
        const accounts = JSON.parse(localStorage.getItem('sov_saved_accounts') || '[]');
        setSavedAccounts(accounts);

        // Load config.json if available
        fetch('config.json')
            .then(res => res.json())
            .then(data => {
                setConfig(prev => ({
                    ...prev,
                    endpoint: data.endpoint || prev.endpoint,
                    region: data.region || prev.region,
                    accessKeyId: data.accessKeyId || prev.accessKeyId,
                    secretAccessKey: data.secretAccessKey || prev.secretAccessKey,
                    bucketName: data.bucketName || prev.bucketName
                }));
            })
            .catch(() => console.log('No pre-populated config found.'));
    }, []);

    const encryptConfig = async (configData: any, pass: string) => {
        const data = new TextEncoder().encode(JSON.stringify(configData));
        const salt = new TextEncoder().encode(configData.userId);
        const masterKeyBuffer = crypto.pbkdf2Sync(pass, salt, 1000, 32, 'sha256');
        
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', masterKeyBuffer, iv);
        const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([iv, tag, encrypted]).toString('base64');
    };

    const decryptConfig = async (encryptedBase64: string, pass: string, userId: string) => {
        const data = Buffer.from(encryptedBase64, 'base64');
        const salt = new TextEncoder().encode(userId);
        const masterKeyBuffer = crypto.pbkdf2Sync(pass, salt, 1000, 32, 'sha256');

        const iv = data.slice(0, 12);
        const tag = data.slice(12, 28);
        const encrypted = data.slice(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', masterKeyBuffer, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return JSON.parse(new TextDecoder().decode(decrypted));
    };

    const login = async () => {
        try {
            const s3Config = {
                region: config.region,
                endpoint: config.endpoint,
                credentials: {
                    accessKeyId: config.accessKeyId,
                    secretAccessKey: config.secretAccessKey
                },
                bucketName: config.bucketName,
                forcePathStyle: true
            };

            const instance = new SovereignS3nc({
                s3: s3Config,
                paths: { appId: config.appId, userId: config.userId, storeId: 'main' },
                password: config.password
            });

            await instance.init();
            
            // Remember Account
            const encrypted = await encryptConfig(config, config.password);
            localStorage.setItem(`sov_acc_${config.userId}`, encrypted);
            if (!savedAccounts.includes(config.userId)) {
                const newAccs = [...savedAccounts, config.userId];
                setSavedAccounts(newAccs);
                localStorage.setItem('sov_saved_accounts', JSON.stringify(newAccs));
            }

            setSov(instance);
            const sm = new SocialManager(instance, '');
            setSocial(sm);
            setProfile(await sm.getProfile());
            setIsLoggedIn(true);
            
            // Trigger initial sync for discovery
            setTimeout(() => {
                instance.sync().then(() => {
                    console.log('Initial sync complete');
                    loadPosts();
                });
            }, 100);
        } catch (e: any) {
            console.error('[Login] Error:', e);
            alert('Initialization failed: ' + e.message);
        }
    };

    const unlockAccount = async (userId: string) => {
        const pass = prompt(`Enter password for ${userId}:`);
        if (!pass) return;
        try {
            const encrypted = localStorage.getItem(`sov_acc_${userId}`);
            if (!encrypted) return;
            const decryptedConfig = await decryptConfig(encrypted, pass, userId);
            decryptedConfig.password = pass; // Restore password for instance init
            setConfig(decryptedConfig);
            // Auto-login with decrypted config
            const s3Config = {
                region: decryptedConfig.region,
                endpoint: decryptedConfig.endpoint,
                credentials: {
                    accessKeyId: decryptedConfig.accessKeyId,
                    secretAccessKey: decryptedConfig.secretAccessKey
                },
                bucketName: decryptedConfig.bucketName,
                forcePathStyle: true
            };
            const instance = new SovereignS3nc({
                s3: s3Config,
                paths: { appId: decryptedConfig.appId, userId: decryptedConfig.userId, storeId: 'main' },
                password: pass
            });
            await instance.init();
            setSov(instance);
            const sm = new SocialManager(instance, '');
            setSocial(sm);
            setProfile(await sm.getProfile());
            setIsLoggedIn(true);
        } catch (e) {
            alert('Invalid password or corrupted data');
        }
    };

    const compressImage = async (file: File): Promise<string> => {
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

                    // 1. Resize to HD (max 1920px) if bigger, maintaining aspect ratio
                    const MAX_DIM = 1920;
                    let scale = 1;
                    if (width > MAX_DIM || height > MAX_DIM) {
                        scale = Math.min(MAX_DIM / width, MAX_DIM / height);
                    }

                    const targetWidth = width * scale;
                    const targetHeight = height * scale;

                    canvas.width = targetWidth;
                    canvas.height = targetHeight;
                    const ctx = canvas.getContext('2d')!;
                    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

                    // 2. Iterative Compression to ~100KB
                    let quality = 0.9;
                    let dataUrl = canvas.toDataURL('image/jpeg', quality);
                    
                    console.log(`[Demo] Initial compression size: ${Math.round(dataUrl.length * 0.75 / 1024)} KB`);

                    // Rough check: base64 string length * 0.75 = approximate byte size
                    while (dataUrl.length * 0.75 > 102400 && quality > 0.1) {
                        quality -= 0.1;
                        dataUrl = canvas.toDataURL('image/jpeg', quality);
                    }
                    
                    console.log(`[Demo] Final compression size: ${Math.round(dataUrl.length * 0.75 / 1024)} KB at quality ${quality.toFixed(1)}`);
                    resolve(dataUrl);
                };
            };
        });
    };

    const handleImageChange = async (e: any) => {
        const file = e.target.files[0];
        if (!file) return;
        const compressed = await compressImage(file);
        setNewPostImage(compressed);
    };

    const saveProfile = async () => {
        if (!social || !profile) return;
        await social.updateProfile(profile.name, profile.bio, profile.avatar);
        setIsEditingProfile(false);
    };

    useEffect(() => {
        if (isLoggedIn) loadPosts();
    }, [isLoggedIn]);

    const handlePost = async () => {
        if (!social || !newPost) return;
        await social.post(newPost, true, newImage || undefined);
        setNewPost('');
        setNewPostImage(null);
        await loadPosts();
    };

    const handleComment = async (parent: Post) => {
        const content = prompt('Your comment:');
        if (!content || !social) return;
        await social.comment(parent.id, parent.userId, content);
        await loadPosts();
    };

    const sync = async () => {
        if (!sov || !social) return;
        setSyncing(true);
        try {
            await sov.sync();
            await social.syncOtherProfiles();
            setLastSyncTime(new Date().toLocaleTimeString());
            await loadPosts();
        } finally {
            setSyncing(false);
        }
    };

    const handleFollow = async () => {
        const id = prompt('Enter User ID to follow (exactly as it appears in their registry):');
        if (!id || !sov) return;
        try {
            await sov.follow(id);
            alert(`Now following ${id}. Please click Sync to pull their latest data.`);
            await loadPosts();
        } catch (e: any) {
            alert(`Error: ${e.message}`);
        }
    };

    const loadPosts = async () => {
        if (!social || !sov) return;
        console.log('[Demo] Refreshing feed...');
        
        // 1. Get registry for sidebar
        const registry = await sov.getPublicRegistry();
        setAllUsers(registry);

        // 2. Generate dates for last 7 days
        const dates: string[] = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date();
            d.setUTCDate(d.getUTCDate() - i);
            dates.push(SovereignS3nc.getDateStr(d));
        }

        let allPosts: Post[] = [];

        // 3. Get my own posts
        for (const date of dates) {
            const myDayPosts = await social.getPosts(date, 'public');
            allPosts = [...allPosts, ...myDayPosts];
        }
        
        // 4. Get following list and their posts
        const followingList = await sov.getFollowing();
        setFollowing(followingList);

        for (const user of followingList) {
            for (const date of dates) {
                const userPosts = await social.getPosts(`${user.userId}/${date}`, 'followed');
                allPosts = [...allPosts, ...userPosts];
            }
        }

        // 5. Sort by timestamp descending
        allPosts.sort((a, b) => b.timestamp - a.timestamp);
        console.log(`[Demo] Total feed items: ${allPosts.length}`);
        setPosts(allPosts);
    };

    const UserAvatar = ({ userId }: { userId: string }) => {
        const [isHovered, setIsHovered] = useState(false);
        const [userData, setUserData] = useState<any>(profileCache[userId]);

        useEffect(() => {
            if (!userData && social) {
                console.log(`[UI] Fetching profile for ${userId}...`);
                social.getProfile(userId).then(p => {
                    if (p) {
                        console.log(`[UI] Found profile for ${userId}:`, p.name);
                        setUserData(p);
                        setProfileCache(prev => ({ ...prev, [userId]: p }));
                    } else {
                        console.log(`[UI] No local profile for ${userId}`);
                    }
                });
            }
        }, [userId, social, userData]);

        const p = userData || { name: userId };

        return (
            <div className="position-relative d-inline-block" 
                 onMouseEnter={() => setIsHovered(true)} 
                 onMouseLeave={() => setIsHovered(false)}>
                <div className="d-flex align-items-center cursor-pointer">
                    {p.avatar ? (
                        <img src={p.avatar} className="profile-img-sm me-2" style={{width: '32px', height: '32px', borderRadius: '50%'}} />
                    ) : (
                        <div className="bg-secondary text-white rounded-circle d-flex align-items-center justify-content-center me-2" style={{width: '32px', height: '32px', fontSize: '0.8rem'}}>
                            {userId[0].toUpperCase()}
                        </div>
                    )}
                    <span className="fw-bold text-primary">{p.name || userId}</span>
                </div>

                {isHovered && (
                    <div className="card position-absolute shadow-lg p-3" style={{zIndex: 1000, width: '250px', top: '100%', left: 0, backgroundColor: 'white', border: '1px solid #007bff'}}>
                        <div className="text-center mb-2">
                            {p.avatar ? (
                                <img src={p.avatar} className="profile-img mb-2" style={{width: '80px', height: '80px', objectFit: 'cover', borderRadius: '50%'}} />
                            ) : (
                                <div className="bg-secondary text-white rounded-circle mx-auto d-flex align-items-center justify-content-center mb-2" style={{width: '80px', height: '80px', fontSize: '2rem'}}>
                                    {userId[0].toUpperCase()}
                                </div>
                            )}
                            <h5 className="mb-0 text-dark">{p.name || userId}</h5>
                            <small className="text-muted">@{userId}</small>
                        </div>
                        {p.bio && <p className="small mb-0 mt-2 border-top pt-2 text-dark">{p.bio}</p>}
                        {!userData && <div className="text-center mt-2"><span className="spinner-border spinner-border-sm"></span></div>}
                    </div>
                )}
            </div>
        );
    };

    const renderPost = (post: Post, depth = 0) => {
        const replies = posts.filter(p => p.parentId === post.id);
        
        return (
            <div key={post.id} className={`post-wrapper ${depth > 0 ? 'ms-4 border-start ps-3' : ''}`}>
                <div className="card post-card p-3">
                    <div className="d-flex align-items-center mb-2">
                        <UserAvatar userId={post.userId} />
                        <div className="ms-2 text-muted small">{new Date(post.timestamp).toLocaleString()}</div>
                    </div>
                    <div className="mb-2">{post.content}</div>
                    {post.image && (
                        <div className="post-image-container mb-2 text-center bg-light rounded" style={{ minHeight: '100px' }}>
                            <img src={post.image} className="img-fluid rounded" style={{ maxHeight: '800px', objectFit: 'contain' }} />
                        </div>
                    )}
                    <div className="pt-2">
                        <button className="btn btn-sm btn-link text-decoration-none p-0" onClick={() => handleComment(post)}>Reply</button>
                    </div>
                </div>
                {replies.length > 0 && (
                    <div className="replies-container mt-2">
                        {replies.map(reply => renderPost(reply, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    if (!isLoggedIn) {
        return (
            <div className="container mt-5" style={{maxWidth: '500px'}}>
                <div className="card p-4">
                    <h3>SovereignS3nc Login</h3>
                    <div className="row g-2 mb-2">
                        <div className="col-8">
                            <input className="form-control" placeholder="S3 Endpoint" value={config.endpoint} onChange={e => setConfig({...config, endpoint: e.target.value})} />
                        </div>
                        <div className="col-4">
                            <input className="form-control" placeholder="Region" value={config.region} onChange={e => setConfig({...config, region: e.target.value})} />
                        </div>
                    </div>
                    <input className="form-control mb-2" placeholder="Access Key" value={config.accessKeyId} onChange={e => setConfig({...config, accessKeyId: e.target.value})} />
                    <input className="form-control mb-2" type="password" placeholder="Secret Key" value={config.secretAccessKey} onChange={e => setConfig({...config, secretAccessKey: e.target.value})} />
                    <input className="form-control mb-2" placeholder="Bucket Name" value={config.bucketName} onChange={e => setConfig({...config, bucketName: e.target.value})} />
                    <hr/>
                    <input className="form-control mb-2" placeholder="User ID" value={config.userId} onChange={e => setConfig({...config, userId: e.target.value})} />
                    <input className="form-control mb-2" type="password" placeholder="Password" value={config.password} onChange={e => setConfig({...config, password: e.target.value})} />
                    <button className="btn btn-primary w-100 mb-2" onClick={login}>Enter Workspace</button>
                    <button className="btn btn-outline-danger btn-sm w-100" onClick={() => {
                        if(confirm('Clear all local data?')) {
                            indexedDB.deleteDatabase('sovereign_s3nc');
                            localStorage.clear();
                            window.location.reload();
                        }
                    }}>Reset Local Database & Accounts</button>

                    {savedAccounts.length > 0 && (
                        <div className="mt-4">
                            <h6>Saved Accounts</h6>
                            <div className="list-group">
                                {savedAccounts.map(acc => (
                                    <button key={acc} className="list-group-item list-group-item-action d-flex justify-content-between align-items-center" onClick={() => unlockAccount(acc)}>
                                        {acc}
                                        <span className="badge bg-primary rounded-pill">Unlock</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="container-fluid">
            <div className="row">
                <div className="col-md-3 sidebar p-4">
                    <div className="text-center mb-4">
                        {profile?.avatar && <img src={profile.avatar} className="profile-img mb-2" />}
                        <h4>{profile?.name || config.userId}</h4>
                        <button className="btn btn-sm btn-link" onClick={() => setIsEditingProfile(true)}>Edit Profile</button>
                    </div>

                    {isEditingProfile && (
                        <div className="card p-3 mb-3 border-primary">
                            <input className="form-control mb-2" placeholder="Display Name" value={profile?.name || ''} onChange={e => setProfile({...profile, name: e.target.value})} />
                            <textarea className="form-control mb-2" placeholder="Bio" value={profile?.bio || ''} onChange={e => setProfile({...profile, bio: e.target.value})} />
                            <input type="file" className="form-control mb-2" onChange={async e => {
                                const file = e.target.files?.[0];
                                if (file) {
                                    const compressed = await compressImage(file);
                                    setProfile({...profile, avatar: compressed});
                                }
                            }} />
                            <button className="btn btn-primary btn-sm" onClick={saveProfile}>Save</button>
                        </div>
                    )}

                    <button className="btn btn-outline-primary w-100 mb-2" onClick={sync} disabled={syncing}>
                        {syncing ? 'Syncing...' : 'Sync Everything'}
                    </button>
                    {lastSyncTime && <div className="text-center small text-success mb-2">Last Sync: {lastSyncTime}</div>}
                    <button className="btn btn-sm btn-outline-info w-100 mb-2" onClick={loadPosts}>
                        Refresh Feed
                    </button>
                    <button className="btn btn-xs btn-outline-warning w-100 mb-3" onClick={() => sov?.testPermissions()}>
                        Test Permissions
                    </button>
                    <button className="btn btn-outline-secondary w-100 mb-3" onClick={handleFollow}>
                        Follow User
                    </button>
                    <hr/>
                    <h6>Following ({following.length})</h6>
                    <div className="list-group list-group-flush mb-3" style={{maxHeight: '200px', overflowY: 'auto'}}>
                        {following.map(f => (
                            <div key={f.userId} className="list-group-item bg-transparent px-0 border-0">
                                <div className="fw-bold small">{f.userId}</div>
                                <div className="text-muted" style={{fontSize: '0.7rem'}}>Last sync: {f.lastSync}</div>
                            </div>
                        ))}
                        {following.length === 0 && <p className="text-muted small">No users followed yet.</p>}
                    </div>

                    <hr/>
                    <h6>Global Registry ({allUsers.length})</h6>
                    <div className="list-group list-group-flush mb-3" style={{maxHeight: '200px', overflowY: 'auto'}}>
                        {allUsers.map(u => (
                            <div key={u.userId} className="list-group-item bg-transparent px-0 border-0 d-flex justify-content-between align-items-center">
                                <span className="small">{u.userId}</span>
                                {!following.find(f => f.userId === u.userId) && u.userId !== config.userId && (
                                    <button className="btn btn-xs btn-link p-0" onClick={async () => {
                                        await sov.follow(u.userId);
                                        loadPosts();
                                    }}>Follow</button>
                                )}
                            </div>
                        ))}
                    </div>
                    <p className="text-muted small border-top pt-2">Zero Knowledge Sync Active</p>
                </div>
                <div className="col-md-6 p-4">
                    <div className="card p-3 mb-4">
                        <textarea className="form-control mb-2" placeholder="What's on your mind?" value={newPost} onChange={e => setNewPost(e.target.value)} />
                        {newImage && <img src={newImage} className="img-thumbnail mb-2" style={{maxHeight: '200px'}} />}
                        <div className="d-flex justify-content-between align-items-center">
                            <input type="file" className="form-control form-control-sm w-50" onChange={handleImageChange} />
                            <button className="btn btn-primary" onClick={handlePost}>Post</button>
                        </div>
                    </div>
                    
                    <div className="feed-container">
                        {posts.filter(p => !p.parentId).map(p => renderPost(p))}
                        {posts.length === 0 && <div className="text-center text-muted mt-5">Your feed is empty. Post something or sync to discover others!</div>}
                    </div>
                </div>
            </div>
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
