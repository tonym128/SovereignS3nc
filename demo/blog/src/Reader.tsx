import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SovereignS3nc } from '../../../src/SovereignS3nc';
import { FeedModule, Post } from '../../../src/modules/Feed';

const BlogPost = ({ post, getBlob }: { post: Post, getBlob: (path: string, userId: string) => Promise<string> }) => {
    const data = JSON.parse(post.content);
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    
    useEffect(() => {
        if (post.image) {
            getBlob(post.image, post.userId).then(setImageUrl);
        }
    }, [post.image]);

    return (
        <article className="post-card">
            <h2 className="post-title">{data.title}</h2>
            <div className="post-meta">
                <span>Published on {new Date(data.publishedAt).toLocaleDateString()}</span>
                <span className="mx-2">•</span>
                <span>By {post.userId}</span>
            </div>
            {imageUrl && <img src={imageUrl} className="post-image" alt={data.title} />}
            <div className="post-content">
                {data.content.split('\n').map((para: string, i: number) => (
                    <p key={i}>{para}</p>
                ))}
            </div>
        </article>
    );
};

const Reader = () => {
    const [config, setConfig] = useState({
        endpoint: 'http://127.0.0.1:9000',
        region: 'rustfs',
        accessKeyId: 'user-key',
        secretAccessKey: 'user-secret-123',
        bucketName: 'sovereign-demo',
        appId: 'sov-blog',
        authorId: 'author-1'
    });

    const [sov, setSov] = useState<SovereignS3nc | null>(null);
    const [posts, setPosts] = useState<Post[]>([]);
    const [initialized, setInitialized] = useState(false);
    const [blobCache, setBlobCache] = useState<Record<string, string>>({});
    const [newAuthorId, setNewAuthorId] = useState(config.authorId);

    const init = async (targetAuthor?: string) => {
        setInitialized(false);
        try {
            const authorToFollow = targetAuthor || config.authorId;
            let instance = sov;
            if (!instance) {
                instance = await SovereignS3nc.create({
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
                    paths: { 
                        appId: config.appId, 
                        userId: 'reader-' + Math.random().toString(36).substring(7), 
                        storeId: 'main' 
                    },
                    password: 'public-reader-password',
                    useWorker: true,
                    workerUrl: 'sync-worker.js'
                });
                setSov(instance);
            }
            
            await instance.follow(authorToFollow);
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

    if (!sov && !initialized) {
        return (
            <div className="container mt-5 text-center">
                <div className="spinner-border text-primary" role="status"></div>
                <p className="mt-3">Connecting to Sovereign Network...</p>
            </div>
        );
    }

    return (
        <div className="container">
            <header className="blog-header">
                <div className="d-flex justify-content-center gap-2 mb-4 no-print">
                    <input className="form-control form-control-sm w-auto" value={newAuthorId} onChange={e => setNewAuthorId(e.target.value)} placeholder="Author ID" />
                    <button className="btn btn-sm btn-dark" onClick={changeAuthor}>View Blog</button>
                </div>
                <h1 className="blog-title">Sovereign Thoughts</h1>
                <p className="lead text-muted">A decentralized blog powered by SovereignS3nc</p>
            </header>

            <main>
                {posts.map(post => (
                    <BlogPost key={post.id} post={post} getBlob={getBlob} />
                ))}

                {posts.length === 0 && (
                    <div className="text-center text-muted mt-5">
                        <p>No posts found yet. The author hasn't published anything.</p>
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
