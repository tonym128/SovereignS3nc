import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { SovereignS3nc } from '../../../src/SovereignS3nc';
import { FeedModule, Post } from '../../../src/modules/Feed';
import { ProfileModule } from '../../../src/modules/Profile';
import { MediaUtils } from '../../../src/utils/MediaUtils';

const Editor = () => {
    const [config, setConfig] = useState({
        endpoint: 'http://127.0.0.1:9000',
        region: 'rustfs',
        accessKeyId: 'user-key',
        secretAccessKey: 'user-secret-123',
        bucketName: 'sovereign-demo',
        appId: 'sov-blog',
        userId: 'author-1',
        password: 'password123',
    });

    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [sov, setSov] = useState<SovereignS3nc | null>(null);
    const [feed, setFeed] = useState<FeedModule | null>(null);
    const [profile, setProfile] = useState<ProfileModule | null>(null);
    
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [image, setImage] = useState<Uint8Array | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [myPosts, setMyPosts] = useState<Post[]>([]);
    const [view, setView] = useState<'edit' | 'list'>('edit');
    const [editingPost, setEditingPost] = useState<Post | null>(null);

    const login = async () => {
        setSyncing(true);
        try {
            const instance = await SovereignS3nc.create({
                s3: {
                    endpoint: config.endpoint,
                    region: config.region,
                    credentials: {
                        accessKeyId: config.accessKeyId,
                        secretAccessKey: config.secretAccessKey
                    },
                    bucketName: config.bucketName,
                    forcePathStyle: true
                },
                paths: { appId: config.appId, userId: config.userId, storeId: 'main' },
                password: config.password,
                useWorker: true,
                workerUrl: 'sync-worker.js'
            });
            setSov(instance);
            setFeed(new FeedModule(instance));
            setProfile(new ProfileModule(instance));
            setIsLoggedIn(true);
            await instance.sync();
            loadPosts(new FeedModule(instance));
        } catch (err) {
            alert('Login failed: ' + (err as Error).message);
        } finally {
            setSyncing(false);
        }
    };

    const loadPosts = async (f: FeedModule) => {
        const today = new Date().toISOString().split('T')[0];
        const posts = await f.getPosts(today, 'public');
        setMyPosts(posts);
    };

    const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            const dataUrl = event.target?.result as string;
            setImagePreview(dataUrl);
            const compressed = await MediaUtils.compressImage(dataUrl, 200 * 1024);
            const binary = await (await fetch(compressed)).arrayBuffer();
            setImage(new Uint8Array(binary));
        };
        reader.readAsDataURL(file);
    };

    const publish = async () => {
        if (!feed || !sov || !title || !content) return;
        setSyncing(true);
        try {
            const blogData = JSON.stringify({ title, content, publishedAt: Date.now() });
            if (editingPost) {
                const today = new Date().toISOString().split('T')[0];
                await feed.editPost(editingPost.id, today, blogData);
            } else {
                await feed.post(blogData, true, image || undefined);
            }
            await sov.sync();
            alert('Published successfully!');
            setTitle('');
            setContent('');
            setImage(null);
            setImagePreview(null);
            setEditingPost(null);
            setView('list');
            loadPosts(feed);
        } catch (err) {
            alert('Publish failed');
        } finally {
            setSyncing(false);
        }
    };

    const startEdit = (post: Post) => {
        const data = JSON.parse(post.content);
        setTitle(data.title);
        setContent(data.content);
        setEditingPost(post);
        setView('edit');
    };

    if (!isLoggedIn) {
        return (
            <div className="container mt-5">
                <div className="row justify-content-center">
                    <div className="col-md-6 card p-4 shadow-sm">
                        <h3 className="mb-4">Author Login</h3>
                        <input className="form-control mb-3" placeholder="S3 Endpoint" value={config.endpoint} onChange={e => setConfig({...config, endpoint: e.target.value})} />
                        <input className="form-control mb-3" placeholder="User ID" value={config.userId} onChange={e => setConfig({...config, userId: e.target.value})} />
                        <input className="form-control mb-3" type="password" placeholder="Password" value={config.password} onChange={e => setConfig({...config, password: e.target.value})} />
                        <button className="btn btn-primary w-100" onClick={login} disabled={syncing}>
                            {syncing ? 'Logging in...' : 'Enter Editor'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div>
            <nav className="navbar px-4">
                <span className="navbar-brand">BLOG EDITOR</span>
                <div className="ms-auto">
                    <button className={`btn btn-sm ${view === 'edit' ? 'btn-dark' : 'btn-outline-dark'} me-2`} onClick={() => setView('edit')}>New Post</button>
                    <button className={`btn btn-sm ${view === 'list' ? 'btn-dark' : 'btn-outline-dark'} me-2`} onClick={() => setView('list')}>My Posts</button>
                    <a href="index.html" target="_blank" className="btn btn-sm btn-outline-secondary">View Blog</a>
                </div>
            </nav>

            <div className="editor-container">
                {view === 'edit' ? (
                    <div className="editor-card">
                        <input className="post-input-title" placeholder="Post Title" value={title} onChange={e => setTitle(e.target.value)} />
                        <textarea className="post-input-content" placeholder="Write your story..." value={content} onChange={e => setContent(e.target.value)} />
                        <div className="mt-3 d-flex align-items-center gap-3">
                            <input type="file" className="form-control form-control-sm w-auto" accept="image/*" onChange={handleImageChange} />
                            <button className="btn btn-primary" onClick={publish} disabled={syncing}>
                                {syncing ? 'Publishing...' : (editingPost ? 'Update Post' : 'Publish Post')}
                            </button>
                        </div>
                        {imagePreview && <img src={imagePreview} className="image-preview" />}
                    </div>
                ) : (
                    <div className="list-group">
                        {myPosts.map(post => {
                            const data = JSON.parse(post.content);
                            return (
                                <div key={post.id} className="list-group-item d-flex justify-content-between align-items-center p-3 mb-2 shadow-sm border-0 rounded">
                                    <div>
                                        <h5 className="mb-1">{data.title}</h5>
                                        <small className="text-muted">{new Date(data.publishedAt).toLocaleDateString()}</small>
                                    </div>
                                    <button className="btn btn-sm btn-outline-primary" onClick={() => startEdit(post)}>Edit</button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<Editor />);
