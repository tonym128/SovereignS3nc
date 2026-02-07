import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SovereignS3nc } from '../../../src/SovereignS3nc';
import { SocialManager, Post } from '../../../src/modules/Social';

const App = () => {
    const [config, setConfig] = useState({
        region: 'us-east-1',
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
    const [newPost, setNewPost] = useState('');
    const [newImage, setNewPostImage] = useState<string | null>(null);
    const [profile, setProfile] = useState<any>(null);
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [syncing, setSyncing] = useState(false);

    const login = async () => {
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
        setSov(instance);
        const sm = new SocialManager(instance, '');
        setSocial(sm);
        setProfile(await sm.getProfile());
        setIsLoggedIn(true);
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

                    // 1. Resize to HD (max 1920px) if bigger
                    const MAX_DIM = 1920;
                    if (width > MAX_DIM || height > MAX_DIM) {
                        if (width > height) {
                            height *= MAX_DIM / width;
                            width = MAX_DIM;
                        } else {
                            width *= MAX_DIM / height;
                            height = MAX_DIM;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d')!;
                    ctx.drawImage(img, 0, 0, width, height);

                    // 2. Iterative Compression to ~100KB
                    let quality = 0.9;
                    let dataUrl = canvas.toDataURL('image/jpeg', quality);
                    
                    // Rough check: base64 string length * 0.75 = approximate byte size
                    while (dataUrl.length * 0.75 > 102400 && quality > 0.1) {
                        quality -= 0.1;
                        dataUrl = canvas.toDataURL('image/jpeg', quality);
                    }
                    
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

    if (!isLoggedIn) {
        return (
            <div className="container mt-5" style={{maxWidth: '500px'}}>
                <div className="card p-4">
                    <h3>SovereignS3nc Login</h3>
                    <input className="form-control mb-2" placeholder="S3 Endpoint" value={config.endpoint} onChange={e => setConfig({...config, endpoint: e.target.value})} />
                    <input className="form-control mb-2" placeholder="Access Key" value={config.accessKeyId} onChange={e => setConfig({...config, accessKeyId: e.target.value})} />
                    <input className="form-control mb-2" type="password" placeholder="Secret Key" value={config.secretAccessKey} onChange={e => setConfig({...config, secretAccessKey: e.target.value})} />
                    <input className="form-control mb-2" placeholder="Bucket Name" value={config.bucketName} onChange={e => setConfig({...config, bucketName: e.target.value})} />
                    <hr/>
                    <input className="form-control mb-2" placeholder="User ID" value={config.userId} onChange={e => setConfig({...config, userId: e.target.value})} />
                    <input className="form-control mb-2" type="password" placeholder="Password" value={config.password} onChange={e => setConfig({...config, password: e.target.value})} />
                    <button className="btn btn-primary w-100" onClick={login}>Enter Workspace</button>
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

                    <button className="btn btn-outline-primary w-100 mb-3" onClick={sync} disabled={syncing}>
                        {syncing ? 'Syncing...' : 'Sync Everything'}
                    </button>
                    <hr/>
                    <h6>Following</h6>
                    <p className="text-muted small">Automatic discovery via global registry.</p>
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
                    
                    {posts.map(p => (
                        <div key={p.id} className="card post-card p-3">
                            <div className="d-flex align-items-center mb-2">
                                <div className="fw-bold text-primary">{p.userId}</div>
                                <div className="ms-2 text-muted small">{new Date(p.timestamp).toLocaleString()}</div>
                            </div>
                            <div className="mb-2">{p.content}</div>
                            {p.image && <img src={p.image} className="img-fluid rounded mb-2" />}
                            <div className="border-top pt-2">
                                <button className="btn btn-sm btn-light" onClick={() => handleComment(p)}>Reply</button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
