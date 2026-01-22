import { SovereignS3nc, Post, Profile, SovereignAddress } from '../../src/index';

// --- State ---
let db: SovereignS3nc | null = null;
let currentUser: string = '';

// --- Toast ---
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${message}</span>`;
    
    // Add close button (optional but good UX)
    // For now, auto-close is fine as per CSS animation logic implies fadeOut?
    // The CSS had `slideIn` but `fadeOut` keyframes were defined but not used.
    // Let's add JS removal.
    
    container.appendChild(el);

    // Auto remove
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(100%)';
        el.style.transition = 'all 0.3s ease-out';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

// --- DOM Elements ---
const views = {
    auth: document.getElementById('view-auth')!,
    feed: document.getElementById('view-feed')!,
    profile: document.getElementById('view-profile')!,
    network: document.getElementById('view-network')!
};

const appArea = document.getElementById('app-area')!;
const navLinks = {
    feed: document.getElementById('nav-feed')!,
    profile: document.getElementById('nav-profile')!,
    network: document.getElementById('nav-network')!
};

const loading = document.getElementById('loading')!;

// --- Auto-fill Config ---
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('load', async () => {
        try {
            const res = await fetch('config.json');
            if (res.ok) {
                const config = await res.json();
                if (config.s3) {
                    (document.getElementById('s3-endpoint') as HTMLInputElement).value = config.s3.endpoint;
                    (document.getElementById('s3-bucket') as HTMLInputElement).value = config.s3.bucketName;
                    (document.getElementById('s3-region') as HTMLInputElement).value = config.s3.region;
                    (document.getElementById('s3-access-key') as HTMLInputElement).value = config.s3.accessKeyId;
                    (document.getElementById('s3-secret-key') as HTMLInputElement).value = config.s3.secretAccessKey;
                    
                    // Select S3 mode
                    (document.querySelector('input[name="auth-mode"][value="s3"]') as HTMLInputElement).checked = true;
                    document.getElementById('auth-oci')!.classList.add('hidden');
                    document.getElementById('auth-s3')!.classList.remove('hidden');
                }
                if (config.appId) {
                    (document.getElementById('app-id') as HTMLInputElement).value = config.appId;
                }
                showToast('Auto-filled connection details from server', 'info');
            }
        } catch (e) {
            console.log('No local config.json found or failed to parse');
        }
    });
}

// --- Initialization ---

// --- Initialization ---

// Auth Mode Toggle
const authRadios = document.querySelectorAll('input[name="auth-mode"]');
const authOci = document.getElementById('auth-oci')!;
const authS3 = document.getElementById('auth-s3')!;

authRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        const val = (e.target as HTMLInputElement).value;
        if (val === 'oci') {
            authOci.classList.remove('hidden');
            authS3.classList.add('hidden');
        } else {
            authOci.classList.add('hidden');
            authS3.classList.remove('hidden');
        }
    });
});

document.getElementById('btn-connect')?.addEventListener('click', async () => {
    const mode = (document.querySelector('input[name="auth-mode"]:checked') as HTMLInputElement).value;
    const appId = (document.getElementById('app-id') as HTMLInputElement).value;
    let userId = (document.getElementById('user-id') as HTMLInputElement).value;

    if (!appId) return showToast('Please fill in App ID', 'error');
    
    // New User Flow
    if (!userId) {
        userId = crypto.randomUUID();
        (document.getElementById('user-id') as HTMLInputElement).value = userId;
        showToast('Generated new Private Access Key. Save this securely!', 'success');
    }

    let config: any = {
        paths: { appId, userId, storeId: 'social' },
        encryptionKey: 'demo-secret-key-must-be-32-bytes-long!', // Demo key
        syncIntervalMs: 0 // Manual sync only
    };

    if (mode === 'oci') {
        const url = (document.getElementById('oci-url') as HTMLInputElement).value;
        if (!url) return showToast('Please enter OCI PAR URL', 'error');
        
        config.ociParUrl = url;
        config.useManifest = true; // CRITICAL for OCI PAR
    
    } else {
        const endpoint = (document.getElementById('s3-endpoint') as HTMLInputElement).value;
        const bucket = (document.getElementById('s3-bucket') as HTMLInputElement).value;
        const region = (document.getElementById('s3-region') as HTMLInputElement).value || 'us-east-1';
        const accessKeyId = (document.getElementById('s3-access-key') as HTMLInputElement).value;
        const secretAccessKey = (document.getElementById('s3-secret-key') as HTMLInputElement).value;

        if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
            return showToast('Please fill in all S3 fields', 'error');
        }

        config.s3 = {
            endpoint,
            region,
            bucketName: bucket,
            credentials: { accessKeyId, secretAccessKey },
            forcePathStyle: true // Usually needed for Garage/MinIO
        };
        // We can use manifest or not. For Garage, standard listing works.
        config.useManifest = false; 
    }

    try {
        if (db) {
            db.stopAutoSync();
        }
        db = new SovereignS3nc(config);

        db.on('syncStart', () => loading.style.display = 'block');
        db.on('syncComplete', (stats) => {
            loading.style.display = 'none';
            if (stats.pulled > 0) {
                console.log('New data received');
            }
        });

        await db.init();
        
        // Set current user to Public ID for UI logic
        currentUser = db.publicId || 'unknown';

        // Switch View
        views.auth.classList.add('hidden');
        appArea.classList.remove('hidden');
        
        loadProfile();
        await db.sync(); // Initial sync
        await db.social.joinGlobalDirectory();
        refreshFeed();
        loadFollowing();

    } catch (e) {
        console.error(e);
        showToast('Failed to connect: ' + e, 'error');
    }
});

// --- Navigation ---
async function switchView(viewName: 'feed' | 'profile' | 'network') {
    Object.values(views).forEach(el => el.classList.add('hidden'));
    Object.values(navLinks).forEach(el => el.classList.remove('active'));

    views[viewName].classList.remove('hidden');
    navLinks[viewName].classList.add('active');
    
    if (db) {
        console.log('Syncing on tab change...');
        await db.sync();
        if (viewName === 'feed') refreshFeed();
    }
}

document.getElementById('btn-refresh')?.addEventListener('click', async () => {
    if (!db) return;
    await db.sync();
    refreshFeed();
});

// --- Profile Logic ---
async function loadProfile() {
    if (!db) return;
    
    // Identity Info
    (document.getElementById('profile-public-id') as HTMLInputElement).value = db.publicId || 'Pending...';
    (document.getElementById('profile-private-id') as HTMLInputElement).value = db.config.paths.userId;

    const profile = await db.profile.get();
    if (profile) {
        (document.getElementById('profile-name') as HTMLInputElement).value = profile.displayName;
        (document.getElementById('profile-bio') as HTMLInputElement).value = profile.bio || '';
        
        if (profile.avatarUrl) {
           renderImage(profile.avatarUrl, document.getElementById('profile-avatar-preview') as HTMLImageElement);
        }
    }
}

document.getElementById('btn-show-key')?.addEventListener('click', () => {
    const input = document.getElementById('profile-private-id') as HTMLInputElement;
    const btn = document.getElementById('btn-show-key') as HTMLButtonElement;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
    }
});

document.getElementById('btn-save-profile')?.addEventListener('click', async () => {
    if (!db) return;
    const name = (document.getElementById('profile-name') as HTMLInputElement).value;
    const bio = (document.getElementById('profile-bio') as HTMLInputElement).value;
    const fileInput = document.getElementById('profile-avatar-input') as HTMLInputElement;

    let avatarUrl = undefined;
    if (fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        const buffer = await file.arrayBuffer();
        // Public upload!
        const meta = await db.storage.upload(file.name, new Uint8Array(buffer), file.type, true);
        avatarUrl = meta._id;
    }

    await db.profile.update({ displayName: name, bio, avatarUrl });
    await db.sync();
    showToast('Profile updated!', 'success');
    loadProfile();
});

// --- Feed Logic ---
async function refreshFeed() {
    if (!db) return;
    console.log('Refreshing feed...');
    const feed = await db.social.getFeed();
    console.log(`Feed loaded: ${feed.length} posts`);
    
    // Optimization: Fetch all comments once instead of N+1
    // Use the social module to ensure normalization of authors
    const allComments = await db.social.getAllComments();
    console.log(`Comments loaded: ${allComments.length} total`);

    const commentsByPost = new Map<string, any[]>();
    
    for (const c of allComments) {
        if (!commentsByPost.has(c.postId)) {
            commentsByPost.set(c.postId, []);
        }
        commentsByPost.get(c.postId)!.push(c);
    }
    
    const container = document.getElementById('feed-list')!;
    container.innerHTML = '';

    for (const post of feed) {
        const el = document.createElement('div');
        el.className = 'card';
        
        const authorName = post.authorId === 'me' ? 'Me' : post.authorId;
        const isMine = post.authorId === 'me';
        
        let imgHtml = '';
        if (post.attachments && post.attachments.length > 0) {
            imgHtml = `<img id="img-${post.attachments[0]}" class="post-img" src="">`;
        }

        let actionsHtml = '';
        if (isMine) {
            actionsHtml = `
                <div style="float:right; font-size:0.8em;">
                    <a href="#" onclick="window.editPost('${post._id}'); return false;">Edit</a> | 
                    <a href="#" onclick="window.deletePost('${post._id}'); return false;">Delete</a>
                </div>
            `;
        }

        el.innerHTML = `
            <div class="post-header">
                <img id="avatar-post-${post._id}" class="avatar">
                <div style="flex-grow:1;">
                    ${actionsHtml}
                    <strong>${authorName}</strong><br>
                    <span class="timestamp">${new Date(post.createdAt).toLocaleString()}</span>
                </div>
            </div>
            <p id="post-text-${post._id}">${post.text}</p>
            ${imgHtml}
            <div class="comments-section" id="comments-${post._id}">
                <small>Loading comments...</small>
            </div>
            <div style="display:flex; margin-top:10px; gap:5px;">
                <input type="text" id="input-comment-${post._id}" class="input" style="margin:0;" placeholder="Write a comment...">
                <button onclick="window.postComment('${post._id}')" class="btn">Reply</button>
            </div>
        `;
        container.appendChild(el);

        // Render Post Image
        if (post.attachments && post.attachments.length > 0) {
            renderImage(post.attachments[0], el.querySelector(`#img-${post.attachments[0]}`) as HTMLImageElement, post.authorId);
        }

        // Render Avatar
        loadAvatarForPost(post.authorId, el.querySelector(`#avatar-post-${post._id}`) as HTMLImageElement);

        // Render comments immediately from cache
        let postComments = commentsByPost.get(post._id) || [];
        
        // Fallback for followed posts
        if (postComments.length === 0 && post._id.startsWith('follow_')) {
             const parts = post._id.split('_');
             if (parts.length >= 3) {
                 const originalId = parts.slice(2).join('_');
                 const fallback = commentsByPost.get(originalId);
                 if (fallback) {
                     postComments = fallback;
                 }
             }
        }

        postComments.sort((a, b) => a.createdAt - b.createdAt);
        renderComments(post._id, postComments);
    }
}

async function loadAvatarForPost(authorId: string, imgEl: HTMLImageElement) {
    if (!db) return;
    let avatarId: string | undefined;

    if (authorId === 'me' || authorId === currentUser) {
        const p = await db.profile.get();
        avatarId = p?.avatarUrl;
    } else {
        // Try to find followed profile
        const followedDocs = await db.collection('followed_content').getAll<Profile>();
        const doc = followedDocs.find((d: any) => 
            d.address && d.address.userId === authorId && 
            (d.collection === 'profiles' || d.displayName !== undefined)
        );
        if (doc) {
            avatarId = doc.avatarUrl;
        }
    }

    if (avatarId) {
        await renderImage(avatarId, imgEl, authorId);
    } else {
        // Fallback or keep generic
        imgEl.style.backgroundColor = '#ccc';
    }
}

function renderComments(postId: string, comments: any[]) {
    const container = document.getElementById(`comments-${postId}`);
    if (!container) return;

    if (comments.length === 0) {
        container.innerHTML = '<small>No comments yet.</small>';
        return;
    }

    container.innerHTML = comments.map(c => {
        const isMine = c.authorId === 'me';
        const actions = isMine ? ` <span style="font-size:0.7em; color:#888;">(<a href="#" onclick="window.deleteComment('${c._id}'); return false;">x</a>)</span>` : '';
        return `
        <div class="comment">
            <strong>${c.authorId}</strong>: ${c.text} ${actions}
        </div>
    `}).join('');
}

async function renderImage(blobId: string, imgEl: HTMLImageElement, authorId?: string) {
    if (!db) return;
    try {
        let data: Uint8Array | null = null;
        let type = 'image/jpeg';

        // Try local first
        try {
            const meta = await db.collection('blobs').get<any>(blobId);
            if (meta) type = meta.contentType;
            data = await db.storage.download(blobId, { decrypt: false });
        } catch (e) { }

        // Fallback: Try to download from author's storage if known
        if (!data && authorId && authorId !== 'me' && authorId !== currentUser) {
             const followedDocs = await db.collection('followed_content').getAll<Profile>();
             const doc = followedDocs.find((d: any) => 
                d.address && d.address.userId === authorId && 
                (d.collection === 'profiles' || d.displayName !== undefined)
             );
             
             if (doc && doc.address) {
                 data = await db.social.getBlob(blobId, doc.address);
                 // We don't know content type without metadata, but browsers are good at guessing or we default to jpeg
             }
        }
        
        if (data) {
            const blob = new Blob([data as any], { type });
            imgEl.src = URL.createObjectURL(blob);
        }
    } catch (e) {
        console.error('Failed to load image', e);
    }
}

document.getElementById('btn-post')?.addEventListener('click', async () => {
    if (!db) return;
    const btn = document.getElementById('btn-post') as HTMLButtonElement;
    const textInput = document.getElementById('post-text') as HTMLInputElement;
    const fileInput = document.getElementById('post-image') as HTMLInputElement;
    
    const text = textInput.value;
    
    if (!text && !fileInput.files?.length) return;

    btn.disabled = true;
    btn.textContent = 'Posting...';

    try {
        let attachments: string[] = [];
        if (fileInput.files && fileInput.files[0]) {
            const file = fileInput.files[0];
            const buffer = await file.arrayBuffer();
            // Upload immediately (Note: requires network currently)
            const meta = await db.storage.upload(file.name, new Uint8Array(buffer), file.type, true);
            attachments.push(meta._id);
        }

        const id = await db.collection('posts').save({
            text,
            authorId: 'me',
            createdAt: Date.now(),
            attachments
        });
        
        // Share publicly!
        await db.share(id, true, 'posts');

        textInput.value = '';
        fileInput.value = '';
        
        console.log('Syncing after post...');
        await db.sync();
        await refreshFeed();
    } catch (e) {
        console.error(e);
        showToast('Failed to post: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Post';
    }
});

// Kept for single comment update
async function loadComments(postId: string) {
    if (!db) return;
    const comments = await db.social.getComments(postId);
    renderComments(postId, comments);
}

(window as any).postComment = async (postId: string) => {
    if (!db) return;
    const input = document.getElementById(`input-comment-${postId}`) as HTMLInputElement;
    const text = input.value;
    if (!text) return;

    const id = await db.collection('comments').save({
        postId,
        text,
        authorId: 'me',
        createdAt: Date.now()
    });
    
    await db.share(id, true, 'comments');

    input.value = '';
    
    console.log('Syncing after comment...');
    await db.sync();
    loadComments(postId);
};

(window as any).deletePost = async (id: string) => {
    if (!db || !confirm('Delete this post?')) return;
    await db.unshare(id);
    await db.collection('posts').delete(id);
    await db.sync();
    refreshFeed();
};

(window as any).editPost = async (id: string) => {
    if (!db) return;
    const post = await db.collection('posts').get<Post>(id);
    if (!post) return;
    
    const newText = prompt('Edit post:', post.text);
    if (newText !== null && newText !== post.text) {
        post.text = newText;
        await db.collection('posts').save(post);
        // Reshare to update public metadata/content
        await db.share(id, true, 'posts'); 
        await db.sync();
        refreshFeed();
    }
};

(window as any).deleteComment = async (id: string) => {
    if (!db || !confirm('Delete comment?')) return;
    await db.unshare(id);
    await db.collection('comments').delete(id);
    // Find post id to refresh
    // We might need to refresh whole feed or just find parent
    // For simplicity, refresh feed or finding parent is hard without the doc
    await db.sync();
    refreshFeed();
};

// --- Network Logic ---
async function loadFollowing() {
    if (!db) return;

    // 1. My Address
    const myAddr = db.getAddress();
    (document.getElementById('my-address') as HTMLInputElement).value = JSON.stringify(myAddr);

    // 2. Following List
    const following = await db.social.getFollowing();
    const followList = document.getElementById('following-list')!;
    followList.innerHTML = '';
    
    following.forEach(addr => {
        const li = document.createElement('li');
        li.innerHTML = `
            <strong>${addr.userId}</strong> (${addr.appId})
            <button onclick="window.unfollowUser('${addr.appId}.${addr.userId}')" class="btn" style="padding:2px 5px; font-size:0.7em; background:#ef4444; margin-left:10px;">Unfollow</button>
        `;
        followList.appendChild(li);
    });

    // 3. Global Directory & Auto-Follow
    const directory = await db.social.getGlobalDirectory();
    const dirList = document.getElementById('directory-list')!;
    dirList.innerHTML = '';
    
    let newFollows = 0;
    for (const addr of directory) {
        // Don't show/follow myself
        if (addr.userId === currentUser) continue;
        
        const isFollowing = following.some(f => f.userId === addr.userId && f.appId === addr.appId);
        
        if (!isFollowing) {
            // Auto-Follow Logic requested by user ("view all other users posts")
            console.log(`Auto-following discovered user: ${addr.userId}`);
            await db.social.follow(addr);
            newFollows++;
        }

        const li = document.createElement('li');
        li.innerHTML = `
            <strong>${addr.userId}</strong>
            <span style="color:green; font-size:0.8em;">Following (Auto)</span>
        `;
        dirList.appendChild(li);
    }
    
    if (newFollows > 0) {
        showToast(`Auto-followed ${newFollows} new users found in directory`, 'success');
        // Trigger sync to pull their content
        db.sync().then(() => refreshFeed()); 
    }
}

document.getElementById('btn-follow')?.addEventListener('click', async () => {
    if (!db) return;
    const input = document.getElementById('follow-address') as HTMLInputElement;
    const val = input.value.trim();
    if (!val) return;

    try {
        let addr: SovereignAddress;
        if (val.startsWith('{')) {
            addr = JSON.parse(val);
        } else if (val.startsWith('s3://')) {
             const parts = val.substring(5).split('/');
             addr = {
                bucket: parts[0],
                appId: parts[1],
                userId: parts[2],
                region: 'us-east-1'
            };
        } else {
            showToast('Invalid address format. Please paste the JSON object from another user.', 'error');
            return;
        }

        await db.social.follow(addr);
        input.value = '';
        loadFollowing();
        showToast(`Followed ${addr.userId}!`, 'success');
    } catch (e) {
        showToast('Failed to follow: ' + e, 'error');
    }
});

(window as any).followUser = async (addr: SovereignAddress) => {
    if (!db) return;
    await db.social.follow(addr);
    loadFollowing();
    showToast(`Followed ${addr.userId}!`, 'success');
};

(window as any).unfollowUser = async (id: string) => {
    if (!db) return;
    if (!confirm('Unfollow this user?')) return;
    await db.social.unfollow(id);
    loadFollowing();
};

if (typeof window !== 'undefined') {
    window.addEventListener('load', () => {
        console.log('Binding navigation events on load...');
        navLinks.feed.onclick = () => switchView('feed');
        navLinks.profile.onclick = () => switchView('profile');
        navLinks.network.onclick = () => { switchView('network'); loadFollowing(); };
    });
}

