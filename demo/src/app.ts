import { SovereignS3nc, Post, Profile, SovereignAddress } from '../../src/index';

// --- State ---
let db: SovereignS3nc | null = null;
let currentUser: string = '';

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
    const userId = (document.getElementById('user-id') as HTMLInputElement).value;

    if (!appId || !userId) return alert('Please fill in App ID and User ID');
    currentUser = userId;

    let config: any = {
        paths: { appId, userId, storeId: 'social' },
        encryptionKey: 'demo-secret-key-must-be-32-bytes-long!', // Demo key
        syncIntervalMs: 0 // Manual sync only
    };

    if (mode === 'oci') {
        const url = (document.getElementById('oci-url') as HTMLInputElement).value;
        if (!url) return alert('Please enter OCI PAR URL');
        
        config.ociParUrl = url;
        config.useManifest = true; // CRITICAL for OCI PAR
    
    } else {
        const endpoint = (document.getElementById('s3-endpoint') as HTMLInputElement).value;
        const bucket = (document.getElementById('s3-bucket') as HTMLInputElement).value;
        const region = (document.getElementById('s3-region') as HTMLInputElement).value || 'us-east-1';
        const accessKeyId = (document.getElementById('s3-access-key') as HTMLInputElement).value;
        const secretAccessKey = (document.getElementById('s3-secret-key') as HTMLInputElement).value;

        if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
            return alert('Please fill in all S3 fields');
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
        db = new SovereignS3nc(config);

        db.on('syncStart', () => loading.style.display = 'block');
        db.on('syncComplete', (stats) => {
            loading.style.display = 'none';
            if (stats.pulled > 0) {
                console.log('New data received');
            }
        });

        await db.init();
        // Connect passes minimal config if needed, but we initialized with full config.
        // The connect() method signature is: connect(config: { s3?: ..., ociParUrl?: ... })
        // But since we passed config to constructor, we might not need to pass it again IF we used the constructor that takes everything.
        // Wait, the constructor takes (config, localStore, crypto).
        // Let's check if we need to call connect().
        // If we provided s3/ociParUrl in constructor, init() prepares local, but does it prepare remote?
        // Checking SovereignS3nc.ts: constructor calls initRemote(config).
        // So we don't strictly need to call connect() unless we want to "re-connect" or if the constructor didn't have it.
        // BUT, the existing code called db.connect().
        // Let's call it just to be safe or skip it if initialized. 
        // Actually, db.init() does NOT trigger a sync automatically unless interval is set.
        // Let's just do an initial sync manually.
        
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
        alert('Failed to connect: ' + e);
    }
});

// --- Navigation ---
function switchView(viewName: 'feed' | 'profile' | 'network') {
    Object.values(views).forEach(el => el.classList.add('hidden'));
    Object.values(navLinks).forEach(el => el.classList.remove('active'));

    views[viewName].classList.remove('hidden');
    navLinks[viewName].classList.add('active');
}

navLinks.feed.onclick = () => switchView('feed');
navLinks.profile.onclick = () => switchView('profile');
navLinks.network.onclick = () => { switchView('network'); loadFollowing(); };

document.getElementById('btn-refresh')?.addEventListener('click', async () => {
    if (!db) return;
    await db.sync();
    refreshFeed();
});

// --- Profile Logic ---
async function loadProfile() {
    if (!db) return;
    const profile = await db.profile.get();
    if (profile) {
        (document.getElementById('profile-name') as HTMLInputElement).value = profile.displayName;
        (document.getElementById('profile-bio') as HTMLInputElement).value = profile.bio || '';
        
        if (profile.avatarUrl) {
           renderImage(profile.avatarUrl, document.getElementById('profile-avatar-preview') as HTMLImageElement);
        }
    }
}

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
    alert('Profile updated!');
    loadProfile();
});

// --- Feed Logic ---
async function refreshFeed() {
    if (!db) return;
    console.log('Refreshing feed...');
    const feed = await db.social.getFeed();
    console.log(`Feed loaded: ${feed.length} posts`);
    
    // Optimization: Fetch all comments once instead of N+1
    const myComments = await db.collection('comments').getAll<any>();
    const followedDocs = await db.collection('followed_content').getAll<any>();
    const followedComments = followedDocs.filter(d => d.text !== undefined && d.postId !== undefined);
    
    const allComments = [...myComments, ...followedComments];
    console.log(`Comments loaded: ${allComments.length} total`);
    if (allComments.length > 0) console.log('Sample comment:', allComments[0]);

    const commentsByPost = new Map<string, any[]>();
    
    for (const c of allComments) {
        if (!commentsByPost.has(c.postId)) {
            commentsByPost.set(c.postId, []);
        }
        commentsByPost.get(c.postId)!.push(c);
    }
    
    console.log('Comments Map Keys:', Array.from(commentsByPost.keys()));

    const container = document.getElementById('feed-list')!;
    container.innerHTML = '';

    for (const post of feed) {
        const el = document.createElement('div');
        el.className = 'card';
        
        const authorName = post.authorId === 'me' ? 'Me' : post.authorId;
        
        let imgHtml = '';
        if (post.attachments && post.attachments.length > 0) {
            imgHtml = `<img id="img-${post.attachments[0]}" class="post-img" src="">`;
        }

        el.innerHTML = `
            <div class="post-header">
                <img id="avatar-post-${post._id}" class="avatar">
                <div>
                    <strong>${authorName}</strong><br>
                    <span class="timestamp">${new Date(post.createdAt).toLocaleString()}</span>
                </div>
            </div>
            <p>${post.text}</p>
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
            renderImage(post.attachments[0], el.querySelector(`#img-${post.attachments[0]}`) as HTMLImageElement);
        }

        // Render Avatar
        loadAvatarForPost(post.authorId, el.querySelector(`#avatar-post-${post._id}`) as HTMLImageElement);

        // Render comments immediately from cache
        let postComments = commentsByPost.get(post._id) || [];
        
        // Fallback for followed posts (where post._id = follow_user_origId, but comment.postId = origId)
        if (postComments.length === 0 && post._id.startsWith('follow_')) {
             const parts = post._id.split('_');
             // Format: follow_userId_originalId
             // Since userId might contain underscores? No, userId is usually a GUID or simple string.
             // But originalId definitely is a GUID.
             // Let's assume the first two underscores separate prefix and user.
             if (parts.length >= 3) {
                 const originalId = parts.slice(2).join('_');
                 const fallback = commentsByPost.get(originalId);
                 if (fallback) {
                     console.log(`Matched comments for ${post._id} using fallback ID ${originalId}`);
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
        // Format: follow_{userId}_me
        const id = `follow_${authorId}_me`;
        const doc = await db.collection('followed_content').get<Profile>(id);
        if (doc) {
            avatarId = doc.avatarUrl;
        }
    }

    if (avatarId) {
        await renderImage(avatarId, imgEl);
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

    container.innerHTML = comments.map(c => `
        <div class="comment">
            <strong>${c.authorId}</strong>: ${c.text}
        </div>
    `).join('');
}

async function renderImage(blobId: string, imgEl: HTMLImageElement) {
    if (!db) return;
    try {
        // Fetch metadata to get Content-Type
        const meta = await db.collection('blobs').get<any>(blobId);
        // In this demo, all images are uploaded as public. 
        // We explicitly skip decryption to avoid issues if metadata is missing/delayed.
        const data = await db.storage.download(blobId, { decrypt: false });
        
        if (data) {
            const options = meta ? { type: meta.contentType } : undefined;
            const blob = new Blob([data as any], options);
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

        await db.collection('posts').save({
            text,
            authorId: 'me',
            createdAt: Date.now(),
            attachments
        });

        textInput.value = '';
        fileInput.value = '';
        await refreshFeed();
    } catch (e) {
        console.error(e);
        alert('Failed to post: ' + (e instanceof Error ? e.message : String(e)));
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

    await db.collection('comments').save({
        postId,
        text,
        authorId: 'me',
        createdAt: Date.now()
    });

    input.value = '';
    loadComments(postId);
};

// --- Network ---
async function loadFollowing() {
    if (!db) return;
    const list = await db.social.getFollowing();
    const container = document.getElementById('following-list')!;
    container.innerHTML = list.map(addr => `<li>${addr.userId} (${addr.bucket}) <button onclick="window.unfollow('${addr.appId}.${addr.userId}')">Unfollow</button></li>`).join('');
    
    populateMyAddress();
    loadGlobalDirectory();
}

function populateMyAddress() {
    if (!db) return;
    const addr = db.getAddress();
    // Format: s3://bucket/appId/userId
    const str = `s3://${addr.bucket}/${addr.appId}/${addr.userId}`;
    (document.getElementById('my-address') as HTMLInputElement).value = str;
}

async function loadGlobalDirectory() {
    if (!db) return;
    const container = document.getElementById('directory-list')!;
    container.innerHTML = '<li><small>Scanning...</small></li>';

    try {
        const users = await db.social.getGlobalDirectory();
        
        if (users.length === 0) {
            container.innerHTML = '<li><small>No users found in directory.</small></li>';
            return;
        }

        container.innerHTML = users.map(u => {
            // Check if already following
            // This is a simple check, ideally we use the full address
            return `<li>${u.userId} (${u.appId}) <button onclick="window.followUser('${u.bucket}', '${u.appId}', '${u.userId}')">Follow</button></li>`;
        }).join('');
    
    } catch (e) {
        container.innerHTML = '<li><small>Failed to scan directory.</small></li>';
    }
}

(window as any).followUser = async (bucket: string, appId: string, userId: string) => {
    if (!db) return;
    // Assuming standard S3 address for now, or construct manually
    const addr: SovereignAddress = {
        bucket, appId, userId, region: 'us-east-1' // Defaulting region if unknown
    };
    await db.social.follow(addr);
    alert(`Followed ${userId}`);
    loadFollowing();
};

document.getElementById('btn-follow')?.addEventListener('click', async () => {
    if (!db) return;
    const addr = (document.getElementById('follow-address') as HTMLInputElement).value;
    
    // Quick hack to support OCI URLs as addresses if they match the pattern
    // Otherwise expect s3://
    if (addr.startsWith('http')) {
        // Construct a pseudo address object for OCI
        // URL format: https://.../p/.../n/{namespace}/b/{bucket}/o/
        // User must provide standard parts. 
        // For this demo, let's assume they paste the base URL and we prompt for details or they use JSON
        alert('Please use s3://bucket/appId/userId format for now, or edit code to parse OCI URLs.');
        return;
    }

    await db.social.follow(addr);
    alert('Followed!');
    loadFollowing();
});

(window as any).unfollow = async (id: string) => {
    if (!db) return;
    await db.social.unfollow(id);
    loadFollowing();
};
