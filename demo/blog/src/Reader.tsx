import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SovereignS3nc } from '../../../src/SovereignS3nc';
import { FeedModule, Post } from '../../../src/modules/Feed';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const BlogPost = ({ post, getBlob, isDetail, onSelect }: { post: Post, getBlob: (path: string, userId: string) => Promise<string>, isDetail: boolean, onSelect?: () => void }) => {
    const data = JSON.parse(post.content);
    const [processedContent, setProcessedContent] = useState('');
    const [processedSynopsis, setProcessedSynopsis] = useState('');
    
    useEffect(() => {
        const process = async () => {
            const resolver = async (text: string) => {
                let result = text;
                const matches = text.match(/public\/blobs\/[a-f0-9]+/g);
                if (matches) {
                    const uniqueMatches = Array.from(new Set(matches));
                    for (const match of uniqueMatches) {
                        const url = await getBlob(match, post.userId);
                        if (url) result = result.split(match).join(url);
                    }
                }
                return result;
            };

            const full = await resolver(data.content);
            setProcessedContent(full);

            const syn = data.content.length > 300 ? data.content.substring(0, 300) + '...' : data.content;
            const synProcessed = await resolver(syn);
            setProcessedSynopsis(synProcessed);
        };
        process();
    }, [data.content, post.userId]);

    const purifyConfig = {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'img', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote'],
        ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class'],
        // Explicitly allow blob: URIs for images
        ADD_ATTR: ['src'],
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data|blob):|[^&#?\/ ]*(?:[#?\/]|$))/i
    };

    return (
        <article className="post-card">
            <h2 className="post-title" onClick={onSelect} style={{ cursor: onSelect ? 'pointer' : 'default' }}>{data.title}</h2>
            <div className="post-meta">
                <span>Published on {new Date(data.publishedAt).toLocaleDateString()}</span>
                <span className="mx-2">•</span>
                <span>By {post.userId}</span>
            </div>
            
            {isDetail ? (
                <div className="post-content" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(processedContent) as string, purifyConfig) }} />
            ) : (
                <div>
                    <div className="post-content" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(processedSynopsis) as string, purifyConfig) }} />
                    <button className="btn btn-link p-0 mt-2" onClick={onSelect}>Read More →</button>
                </div>
            )}
        </article>
    );
};

const Reader = () => {
    const [config, setConfig] = useState({
        endpoint: 'http://127.0.0.1:9000',
        region: 'rustfs',
        accessKeyId: '',
        secretAccessKey: '',
        bucketName: 'sovereign-demo',
        appId: 'sov-blog',
        authorId: ''
    });

    const [sov, setSov] = useState<SovereignS3nc | null>(null);
    const [posts, setPosts] = useState<Post[]>([]);
    const [initialized, setInitialized] = useState(false);
    const [blobCache, setBlobCache] = useState<Record<string, string>>({});
    const [newAuthorId, setNewAuthorId] = useState('author-1');
    const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
    const [authors, setAuthors] = useState<{userId: string, publicKey: string}[]>([]);

    const init = async (targetAuthor?: string) => {
        setInitialized(false);
        setPosts([]);
        setSelectedPostId(null);
        try {
            let currentConfig = config;
            const isLocalHost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
            if (!config.accessKeyId) {
                try {
                    const res = await fetch('config.json');
                    const remoteConfig = await res.json();
                    currentConfig = { ...config, ...remoteConfig };
                    setConfig(currentConfig);
                } catch (e) {}
                if (!targetAuthor) targetAuthor = currentConfig.authorId || 'author-1';
            }

            const authorToFollow = targetAuthor || 'author-1';
            setNewAuthorId(authorToFollow);

            let instance = sov;
            if (!instance) {
                const endpointIsLocal = currentConfig.endpoint && (currentConfig.endpoint.includes('127.0.0.1') || currentConfig.endpoint.includes('localhost'));
                const hasS3 = currentConfig.endpoint && (!endpointIsLocal || isLocalHost);

                instance = await SovereignS3nc.create({
                    s3: hasS3 ? {
                        endpoint: currentConfig.endpoint,
                        region: currentConfig.region,
                        credentials: { accessKeyId: currentConfig.accessKeyId, secretAccessKey: currentConfig.secretAccessKey },
                        bucketName: currentConfig.bucketName,
                        forcePathStyle: true
                    } : undefined,
                    offline: !hasS3,
                    paths: { appId: currentConfig.appId, userId: 'reader-' + Math.random().toString(36).substring(7), storeId: 'main' },
                    password: 'public-reader-password',
                    useWorker: true,
                    workerUrl: 'sync-worker.js'
                });
                setSov(instance);
            }
            
            // Discover all authors
            try {
                const registeredUsers = await instance.discoverUsers();
                if (registeredUsers) setAuthors(registeredUsers);
            } catch (e) {}

            try {
                await instance.follow(authorToFollow);
            } catch (e) {}
            await instance.sync();
            
            const today = new Date().toISOString().split('T')[0];
            const fetchedPosts = await new FeedModule(instance).getPosts(`${authorToFollow}/${today}`, 'followed');
            setPosts(fetchedPosts.sort((a, b) => {
                const da = JSON.parse(a.content).publishedAt;
                const db = JSON.parse(b.content).publishedAt;
                return db - da;
            }));
            setInitialized(true);
        } catch (err) {
            console.error('Initialization failed', err);
        }
    };

    const changeAuthor = () => {
        setSelectedPostId(null);
        init(newAuthorId);
    };

    const getBlob = async (path: string, userId: string) => {
        if (blobCache[path]) return blobCache[path];
        if (!sov) return '';
        const data = await sov.getBlob(path, userId);
        if (data) {
            const url = URL.createObjectURL(new Blob([data]));
            setBlobCache(prev => ({ ...prev, [path]: url }));
            return url;
        }
        return '';
    };

    useEffect(() => {
        init();
    }, []);

    if (!initialized) {
        return (
            <div className="container mt-5 text-center">
                <div className="spinner-border text-primary" role="status"></div>
                <p className="mt-3">Loading Sovereign Blog...</p>
            </div>
        );
    }

    const selectedPost = posts.find(p => p.id === selectedPostId);

    return (
        <div className="container">
            <header className="blog-header">
                <div className="d-flex justify-content-center gap-2 mb-4 no-print">
                    <select className="form-select form-select-sm w-auto" value={newAuthorId} onChange={e => {
                        setNewAuthorId(e.target.value);
                        if (e.target.value) init(e.target.value);
                    }}>
                        <option value="">Select Author...</option>
                        {authors.map(a => <option key={a.userId} value={a.userId}>{a.userId}</option>)}
                    </select>
                    <button className="btn btn-sm btn-outline-dark" onClick={() => init(newAuthorId)}>Refresh</button>
                </div>
                <h1 className="blog-title" style={{ cursor: 'pointer' }} onClick={() => setSelectedPostId(null)}>Sovereign Thoughts</h1>
                <p className="lead text-muted">A decentralized blog powered by SovereignS3nc</p>
            </header>

            <main>
                {selectedPost ? (
                    <div>
                        <button className="btn btn-sm btn-outline-dark mb-4" onClick={() => setSelectedPostId(null)}>← Back to List</button>
                        <BlogPost post={selectedPost} getBlob={getBlob} isDetail={true} />
                    </div>
                ) : (
                    <div>
                        {posts.map(post => (
                            <BlogPost key={post.id} post={post} getBlob={getBlob} isDetail={false} onSelect={() => setSelectedPostId(post.id)} />
                        ))}

                        {posts.length === 0 && (
                            <div className="text-center text-muted mt-5">
                                <p>No posts found yet. The author hasn't published anything.</p>
                            </div>
                        )}
                    </div>
                )}
            </main>

            <footer className="py-5 text-center text-muted border-top">
                <p>Built with <a href="https://github.com/sovereigns3nc" className="text-dark">SovereignS3nc</a></p>
            </footer>
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<Reader />);
