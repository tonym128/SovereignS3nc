import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { SovereignS3nc } from '../../../src/SovereignS3nc';
import { FeedModule, Post } from '../../../src/modules/Feed';
import { ProfileModule } from '../../../src/modules/Profile';
import { MediaUtils } from '../../../src/utils/MediaUtils';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const Editor = () => {
    const [config, setConfig] = useState({
        endpoint: 'http://127.0.0.1:9000',
        region: 'rustfs',
        accessKeyId: '',
        secretAccessKey: '',
        bucketName: 'sovereign-demo',
        appId: 'sov-blog',
        userId: 'author-1',
        password: 'password123',
    });

    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [sov, setSov] = useState<SovereignS3nc | null>(null);
    const [feed, setFeed] = useState<FeedModule | null>(null);
    
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [processedContent, setProcessedContent] = useState('');
    const [syncing, setSyncing] = useState(false);
    const [myPosts, setMyPosts] = useState<Post[]>([]);
    const [view, setView] = useState<'edit' | 'list' | 'media'>('edit');
    const [editingPost, setEditingPost] = useState<Post | null>(null);
    const [isDraft, setIsDraft] = useState(true);
    const [mediaList, setMediaList] = useState<string[]>([]);
    const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});

    useEffect(() => {
        fetch('admin_config.json')
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
            .catch(() => {});
    }, []);

    const login = async () => {
        setSyncing(true);
        try {
            const instance = await SovereignS3nc.create({
                s3: {
                    endpoint: config.endpoint,
                    region: config.region,
                    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
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
            setIsLoggedIn(true);

            // Register in global users.json
            await instance.ensureGlobalRegistration();
            await instance.sync();

            await loadPosts(new FeedModule(instance));
            await loadMedia(instance);
        } catch (err) {
            alert('Login failed: ' + (err as Error).message);
        } finally {
            setSyncing(false);
        }
    };

    const loadPosts = async (f: FeedModule) => {
        const today = new Date().toISOString().split('T')[0];
        const publicPosts = await f.getPosts(today, 'public');
        const privatePosts = await f.getPosts(today, 'private');
        setMyPosts([...publicPosts, ...privatePosts].sort((a, b) => b.timestamp - a.timestamp));
    };

    const loadMedia = async (instance: SovereignS3nc) => {
        const mediaPath = 'private/blog/media.json';
        const data = await instance.getStorage().getFile(mediaPath);
        if (data) {
            const list = JSON.parse(new TextDecoder().decode(data));
            setMediaList(list);
            
            // Pre-fetch blob URLs
            for (const path of list) {
                await resolveBlob(path, instance);
            }
        }
    };

    const resolveBlob = async (path: string, instance: SovereignS3nc) => {
        if (blobUrls[path]) return blobUrls[path];
        const blobData = await instance.getBlob(path);
        if (blobData) {
            const url = URL.createObjectURL(new Blob([blobData]));
            setBlobUrls(prev => ({ ...prev, [path]: url }));
            return url;
        }
        return '';
    };

    useEffect(() => {
        const process = async () => {
            if (!sov) return;
            let md = content;
            const matches = md.match(/public\/blobs\/[a-f0-9]+/g);
            if (matches) {
                const uniqueMatches = Array.from(new Set(matches));
                for (const match of uniqueMatches) {
                    const url = await resolveBlob(match, sov);
                    if (url) md = md.split(match).join(url);
                }
            }
            setProcessedContent(md);
        };
        process();
    }, [content, sov, blobUrls]);

    const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !sov) return;
        setSyncing(true);
        try {
            const reader = new FileReader();
            reader.onload = async (event) => {
                const dataUrl = event.target?.result as string;
                const compressed = await MediaUtils.compressImage(dataUrl, 500 * 1024);
                const binary = await (await fetch(compressed)).arrayBuffer();
                const path = await sov.saveBlob(new Uint8Array(binary), true); // Public blob for blog
                
                const newList = [path, ...mediaList];
                setMediaList(newList);
                await sov.getStorage().saveFile('private/blog/media.json', new TextEncoder().encode(JSON.stringify(newList)));
                
                const url = URL.createObjectURL(new Blob([binary]));
                setBlobUrls(prev => ({ ...prev, [path]: url }));
                await sov.sync();
            };
            reader.readAsDataURL(file);
        } finally {
            setSyncing(false);
        }
    };

    const publish = async () => {
        if (!feed || !sov || !title || !content) return;
        setSyncing(true);
        try {
            const blogData = JSON.stringify({ title, content, publishedAt: Date.now(), status: isDraft ? 'draft' : 'published' });
            const isPublic = !isDraft;
            
            if (editingPost) {
                const today = new Date().toISOString().split('T')[0];
                const oldData = JSON.parse(editingPost.content);
                const wasDraft = oldData.status === 'draft';
                
                if (wasDraft !== isDraft) {
                    await feed.deletePost(editingPost.id, today, !wasDraft);
                    await feed.post(blogData, isPublic);
                } else {
                    await feed.editPost(editingPost.id, today, blogData, isPublic);
                }
            } else {
                await feed.post(blogData, isPublic);
            }
            await sov.sync();
            alert(isDraft ? 'Draft saved!' : 'Published successfully!');
            setTitle('');
            setContent('');
            setEditingPost(null);
            setView('list');
            loadPosts(feed);
        } catch (err) {
            console.error('Publish failed', err);
            alert('Action failed: ' + (err as Error).message);
        } finally {
            setSyncing(false);
        }
    };

    const startEdit = (post: Post) => {
        const data = JSON.parse(post.content);
        setTitle(data.title);
        setContent(data.content);
        setIsDraft(data.status === 'draft');
        setEditingPost(post);
        setView('edit');
    };

    const deletePost = async (post: Post) => {
        if (!feed || !sov || !confirm('Are you sure you want to delete this post?')) return;
        setSyncing(true);
        try {
            const today = new Date().toISOString().split('T')[0];
            const isPublic = JSON.parse(post.content).status === 'published';
            await feed.deletePost(post.id, today, isPublic);
            await sov.sync();
            alert('Post deleted!');
            loadPosts(feed);
        } catch (err) {
            console.error('Delete failed', err);
            alert('Delete failed: ' + (err as Error).message);
        } finally {
            setSyncing(false);
        }
    };

    const exportStaticSite = async () => {
        if (!sov || !feed) return;
        setSyncing(true);
        try {
            const today = new Date().toISOString().split('T')[0];
            const posts = await feed.getPosts(today, 'public');
            
            const siteData = {
                title: "My Sovereign Blog",
                author: config.userId,
                posts: posts.map(p => ({
                    id: p.id,
                    ...JSON.parse(p.content)
                })),
                blobs: {} as Record<string, string>
            };

            for (const p of posts) {
                const data = JSON.parse(p.content);
                const matches = data.content.match(/public\/blobs\/[a-f0-9]+/g);
                if (matches) {
                    for (const match of matches) {
                        const blobData = await sov.getBlob(match);
                        if (blobData) {
                            siteData.blobs[match] = `data:image/jpeg;base64,${Buffer.from(blobData).toString('base64')}`;
                        }
                    }
                }
            }

            const html = `
<!DOCTYPE html>
<html>
<head>
    <title>${siteData.title}</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { font-family: 'Georgia', serif; padding: 2rem; max-width: 800px; margin: auto; }
        img { max-width: 100%; border-radius: 8px; }
        .post { margin-bottom: 4rem; border-bottom: 1px solid #eee; padding-bottom: 2rem; }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
</head>
<body>
    <header class="text-center mb-5">
        <h1>${siteData.title}</h1>
        <p class="text-muted">By ${siteData.author}</p>
    </header>
    <div id="posts"></div>
    <script>
        const data = ${JSON.stringify(siteData)};
        const container = document.getElementById('posts');
        data.posts.forEach(post => {
            const div = document.createElement('div');
            div.className = 'post';
            let content = post.content;
            Object.keys(data.blobs).forEach(path => {
                content = content.split(path).join(data.blobs[path]);
            });
            div.innerHTML = \`
                <h2>\${post.title}</h2>
                <p class="text-muted">\${new Date(post.publishedAt).toLocaleDateString()}</p>
                <div>\${marked.parse(content)}</div>
            \`;
            container.appendChild(div);
        });
    </script>
</body>
</html>`;

            const blob = new Blob([html], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'sovereign-blog-export.html';
            a.click();
        } catch (err) {
            alert('Export failed');
        } finally {
            setSyncing(false);
        }
    };

    const purifyConfig = {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'img', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote'],
        ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class'],
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data|blob):|[^&#?\/ ]*(?:[#?\/]|$))/i
    };

    if (!isLoggedIn) {
        return (
            <div className="container mt-5">
                <div className="row justify-content-center">
                    <div className="col-md-6 card p-4 shadow-sm">
                        <h3 className="mb-4">Author Login</h3>
                        <label className="form-label small">S3 Endpoint</label>
                        <input className="form-control mb-3" placeholder="S3 Endpoint" value={config.endpoint} onChange={e => setConfig({...config, endpoint: e.target.value})} />
                        
                        <div className="row">
                            <div className="col">
                                <label className="form-label small">Access Key ID</label>
                                <input className="form-control mb-3" placeholder="Access Key ID" value={config.accessKeyId} onChange={e => setConfig({...config, accessKeyId: e.target.value})} />
                            </div>
                            <div className="col">
                                <label className="form-label small">Secret Access Key</label>
                                <input className="form-control mb-3" type="password" placeholder="Secret Key" value={config.secretAccessKey} onChange={e => setConfig({...config, secretAccessKey: e.target.value})} />
                            </div>
                        </div>

                        <div className="row">
                            <div className="col">
                                <label className="form-label small">User ID</label>
                                <input className="form-control mb-3" placeholder="User ID" value={config.userId} onChange={e => setConfig({...config, userId: e.target.value})} />
                            </div>
                            <div className="col">
                                <label className="form-label small">Passphrase</label>
                                <input className="form-control mb-3" type="password" placeholder="Password" value={config.password} onChange={e => setConfig({...config, password: e.target.value})} />
                            </div>
                        </div>

                        <button className="btn btn-primary w-100 mt-2" onClick={login} disabled={syncing}>
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
                <div className="ms-auto d-flex gap-2">
                    <button className={`btn btn-sm ${view === 'edit' ? 'btn-dark' : 'btn-outline-dark'}`} onClick={() => setView('edit')}>Write</button>
                    <button className={`btn btn-sm ${view === 'list' ? 'btn-dark' : 'btn-outline-dark'}`} onClick={() => setView('list')}>Posts</button>
                    <button className={`btn btn-sm ${view === 'media' ? 'btn-dark' : 'btn-outline-dark'}`} onClick={() => setView('media')}>Media</button>
                    <button className="btn btn-sm btn-outline-success" onClick={exportStaticSite}>Export Site</button>
                    <a href="index.html" target="_blank" className="btn btn-sm btn-outline-secondary">View Live</a>
                </div>
            </nav>

            <div className="container-fluid mt-4">
                {view === 'edit' && (
                    <div className="row">
                        <div className="col-md-6">
                            <div className="editor-card">
                                <input className="post-input-title" placeholder="Post Title" value={title} onChange={e => setTitle(e.target.value)} />
                                <textarea className="post-input-content" placeholder="Markdown supported..." value={content} onChange={e => setContent(e.target.value)} />
                                <div className="mt-3 d-flex align-items-center gap-3">
                                    <div className="form-check form-switch">
                                        <input className="form-check-input" type="checkbox" checked={isDraft} onChange={e => setIsDraft(e.target.checked)} />
                                        <label className="form-check-label">{isDraft ? 'Draft' : 'Public'}</label>
                                    </div>
                                    <button className="btn btn-primary" onClick={publish} disabled={syncing}>
                                        {syncing ? 'Saving...' : (editingPost ? 'Update' : 'Publish')}
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="col-md-6 border-start">
                            <div className="p-3 bg-white rounded shadow-sm h-100 markdown-preview">
                                <h3>{title || 'Preview'}</h3>
                                <hr />
                                <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(processedContent) as string, purifyConfig) }} />
                            </div>
                        </div>
                    </div>
                )}

                {view === 'list' && (
                    <div className="max-width-800 mx-auto">
                        <div className="list-group">
                            {myPosts.map(post => {
                                const data = JSON.parse(post.content);
                                return (
                                    <div key={post.id} className="list-group-item d-flex justify-content-between align-items-center p-3 mb-2 shadow-sm border-0 rounded">
                                        <div>
                                            <h5 className="mb-1">{data.title} <span className={`badge ${data.status === 'draft' ? 'bg-warning text-dark' : 'bg-success'} ms-2`}>{data.status}</span></h5>
                                            <small className="text-muted">{new Date(data.publishedAt).toLocaleDateString()}</small>
                                        </div>
                                        <div className="d-flex gap-2">
                                            <button className="btn btn-sm btn-outline-primary" onClick={() => startEdit(post)}>Edit</button>
                                            <button className="btn btn-sm btn-outline-danger" onClick={() => deletePost(post)}>Delete</button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {view === 'media' && (
                    <div className="max-width-800 mx-auto">
                        <div className="card p-4 shadow-sm mb-4">
                            <h5>Upload New Media</h5>
                            <input type="file" className="form-control" onChange={handleMediaUpload} accept="image/*" disabled={syncing} />
                        </div>
                        <div className="row row-cols-1 row-cols-md-3 g-4">
                            {mediaList.map(path => (
                                <div key={path} className="col">
                                    <div className="card h-100 shadow-sm">
                                        {blobUrls[path] ? <img src={blobUrls[path]} className="card-img-top" /> : <div className="p-5 text-center">Loading...</div>}
                                        <div className="card-body">
                                            <code className="x-small d-block mb-2 text-truncate" title={path}>{path}</code>
                                            <button className="btn btn-sm btn-outline-secondary w-100" onClick={() => {
                                                navigator.clipboard.writeText(`![](${path})`);
                                                alert('Markdown copied!');
                                            }}>Copy MD</button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<Editor />);
