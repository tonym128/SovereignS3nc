import { SovereignS3nc, IndexedDBStorage } from '../../../src/index';

interface Room {
    _id?: string;
    name: string;
    createdBy: string;
    createdAt: number;
    address?: any;
    _originalId?: string;
}

interface ChatMessage {
    _id?: string;
    roomId: string;
    authorId: string;
    authorName: string;
    text: string;
    createdAt: number;
}

// --- Session Management ---
interface SavedSession {
    id: string;
    userId: string;
    appId: string;
    config: any;
    lastActive: number;
}

function getSavedSessions(): SavedSession[] {
    try {
        return JSON.parse(localStorage.getItem('chat_sessions') || '[]');
    } catch { return []; }
}

function saveSession(config: any) {
    const sessions = getSavedSessions();
    const userId = config.paths.userId;
    const appId = config.paths.appId;
    const idx = sessions.findIndex(s => s.userId === userId && s.appId === appId);
    
    const session: SavedSession = {
        id: crypto.randomUUID(),
        userId,
        appId,
        config,
        lastActive: Date.now()
    };

    let sessionId = session.id;

    if (idx >= 0) {
        sessionId = sessions[idx].id;
        sessions[idx] = { ...session, id: sessionId }; 
    } else {
        sessions.push(session);
    }
    
    localStorage.setItem('chat_sessions', JSON.stringify(sessions));
    localStorage.setItem('chat_current_session_id', sessionId);
}

function clearCurrentSession() {
    localStorage.removeItem('chat_current_session_id');
}

function removeSession(id: string) {
    const sessions = getSavedSessions().filter(s => s.id !== id);
    localStorage.setItem('chat_sessions', JSON.stringify(sessions));
    renderSavedSessionsList();
}

// --- State ---
let db: SovereignS3nc | null = null;
let currentRoom: Room | null = null;
let profileMap = new Map<string, { name: string, avatarUrl?: string }>();

// --- DOM ---
const views = {
    auth: document.getElementById('view-auth')!,
    app: document.getElementById('app-area')!,
    chat: document.getElementById('chat-view')!,
    welcome: document.getElementById('welcome-view')!,
    profileModal: document.getElementById('profile-modal')!
};

const inputs = {
    appId: document.getElementById('app-id') as HTMLInputElement,
    userId: document.getElementById('user-id') as HTMLInputElement,
    endpoint: document.getElementById('s3-endpoint') as HTMLInputElement,
    bucket: document.getElementById('s3-bucket') as HTMLInputElement,
    accessKey: document.getElementById('s3-access-key') as HTMLInputElement,
    secretKey: document.getElementById('s3-secret-key') as HTMLInputElement,
    message: document.getElementById('message-input') as HTMLInputElement,
    displayName: document.getElementById('input-display-name') as HTMLInputElement,
    avatarFile: document.getElementById('input-avatar-file') as HTMLInputElement
};

const loading = document.getElementById('loading')!;

// --- Session UI Helpers ---
function renderSavedSessionsList() {
    const list = document.getElementById('saved-sessions-list');
    const area = document.getElementById('saved-sessions-area');
    const sessions = getSavedSessions();

    if (!list || !area) return;

    if (sessions.length === 0) {
        area.classList.add('hidden');
        toggleLoginView(false);
        return;
    }

    list.innerHTML = '';
    sessions.sort((a, b) => b.lastActive - a.lastActive);

    sessions.forEach(s => {
        const item = document.createElement('div');
        item.style.padding = '10px';
        item.style.border = '1px solid #ddd';
        item.style.borderRadius = '4px';
        item.style.cursor = 'pointer';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        item.style.background = '#f9f9f9';
        
        item.onclick = () => connect(s.config, false);

        item.innerHTML = `
            <div>
                <strong>${s.userId.substring(0, 8)}...</strong> <small>(${s.appId})</small><br>
                <small style="color:#666;">${new Date(s.lastActive).toLocaleDateString()}</small>
            </div>
            <button onclick="event.stopPropagation(); window.removeSession('${s.id}')" class="secondary" style="background:#ff4d4d; color:white; padding: 2px 6px; font-size: 0.8em; border-radius: 4px;">✕</button>
        `;
        list.appendChild(item);
    });

    document.getElementById('btn-show-new-login')?.addEventListener('click', () => toggleLoginView(false));
    toggleLoginView(true);
}

(window as any).removeSession = removeSession;

function toggleLoginView(showSaved: boolean) {
    const savedArea = document.getElementById('saved-sessions-area');
    const newArea = document.getElementById('new-login-area');
    
    if (showSaved && getSavedSessions().length > 0) {
        savedArea?.classList.remove('hidden');
        newArea?.classList.add('hidden');
    } else {
        savedArea?.classList.add('hidden');
        newArea?.classList.remove('hidden');
    }
}

// --- Initialization ---

async function connect(config?: any, save: boolean = true) {
    if (!config) {
        const appId = inputs.appId.value.trim();
        let userId = inputs.userId.value.trim();
        const endpoint = inputs.endpoint.value.trim();
        const bucket = inputs.bucket.value.trim();
        const accessKeyId = inputs.accessKey.value.trim();
        const secretAccessKey = inputs.secretKey.value.trim();

        if (!appId || !endpoint || !bucket || !accessKeyId || !secretAccessKey) {
            alert('Please fill in all connection details');
            return;
        }

        if (!userId) {
            userId = crypto.randomUUID();
            inputs.userId.value = userId;
        }
        
        config = {
            paths: { appId, userId, storeId: 'chat' },
            encryptionKey: 'chat-demo-encryption-key-32-chars!', // For demo
            s3: {
                endpoint,
                region: 'us-east-1',
                bucketName: bucket,
                credentials: { accessKeyId, secretAccessKey },
                forcePathStyle: true
            },
            useManifest: true,
            syncIntervalMs: 5000 // 5s auto-sync for chat
        };
    }

    try {
        const storage = new IndexedDBStorage(config.paths.userId);
        db = new SovereignS3nc(config, storage);

        db.on('syncStart', () => loading.style.display = 'block');
        db.on('syncComplete', async () => {
            loading.style.display = 'none';
            await refreshData();
        });

        await db.init();
        
        if (save) {
            saveSession(config);
        } else {
             saveSession(config); // Update last active
        }

        // Show App
        views.auth.classList.add('hidden');
        views.app.classList.remove('hidden');

        await loadMyProfile();
        await db.sync();
        await db.social.joinGlobalDirectory();
        
        // Initial data pull
        await refreshData();

    } catch (e) {
        console.error(e);
        alert('Connection failed: ' + e);
    }
}

// --- Data Management ---

function normalizeDoc(doc: any) {
    if (doc._id.startsWith('follow_')) {
        const parts = doc._id.split('_');
        const userId = parts[1];
        const originalId = doc._originalId || parts.slice(2).join('_');
        return { ...doc, _id: originalId, authorId: userId };
    }
    return { ...doc, authorId: doc.authorId || 'me' };
}

async function refreshData() {
    if (!db) return;
    
    // Discover and follow others
    const directory = await db.social.getGlobalDirectory();
    for (const addr of directory) {
        if (addr.userId !== db.config.paths.userId) {
             await db.social.follow(addr);
        }
    }

    await loadProfiles();
    await renderRooms();
    if (currentRoom) {
        await renderMessages();
    }
}

async function loadMyProfile() {
    if (!db) return;
    const profile = await db.profile.get();
    if (profile) {
        document.getElementById('my-name')!.textContent = profile.displayName;
        inputs.displayName.value = profile.displayName;
        if (profile.avatarUrl) {
            renderAvatar(profile.avatarUrl, document.getElementById('my-avatar') as HTMLImageElement);
        }
    }
}

async function loadProfiles() {
    if (!db) return;
    profileMap.clear();

    const myProfile = await db.profile.get();
    if (myProfile && db.publicId) {
        profileMap.set(db.publicId, { name: myProfile.displayName, avatarUrl: myProfile.avatarUrl });
    }

    const followedContent = await db.collection('followed_content').getAll<any>();
    for (const p of followedContent) {
        if (p.address && p.address.userId && p.displayName) {
             profileMap.set(p.address.userId, { name: p.displayName, avatarUrl: p.avatarUrl });
        }
    }
}

async function renderRooms() {
    if (!db) return;
    
    const myRooms = await db.collection('rooms').getAll<Room>();
    const followedContent = await db.collection('followed_content').getAll<any>();
    const otherRooms = followedContent.filter(d => d.name !== undefined && d.roomId === undefined);

    const allRooms = [...myRooms, ...otherRooms].map(r => normalizeDoc(r));
    
    // Deduplicate by ID
    const uniqueRooms = new Map<string, Room>();
    allRooms.forEach(r => uniqueRooms.set(r._id!, r));

    const sortedRooms = Array.from(uniqueRooms.values()).sort((a, b) => a.name.localeCompare(b.name));

    const container = document.getElementById('room-list')!;
    container.innerHTML = '';

    sortedRooms.forEach(room => {
        const div = document.createElement('div');
        const isActive = currentRoom && (currentRoom._id === room._id);
        div.className = 'room-item' + (isActive ? ' active' : '');
        
        const isMine = room.authorId === 'me' || room.authorId === db?.publicId;

        div.innerHTML = `
            <span># ${escapeHtml(room.name)}</span>
            ${isMine ? '<span class="delete-btn" title="Delete Room">🗑️</span>' : ''}
        `;
        
        div.onclick = (e) => {
            if ((e.target as HTMLElement).classList.contains('delete-btn')) {
                deleteRoom(room);
            } else {
                selectRoom(room);
            }
        };
        container.appendChild(div);
    });
}

async function selectRoom(room: Room) {
    currentRoom = room;
    views.welcome.classList.add('hidden');
    views.chat.classList.remove('hidden');
    document.getElementById('active-room-name')!.textContent = '# ' + room.name;
    
    await renderRooms();
    await renderMessages();
}

async function renderMessages() {
    if (!db || !currentRoom) return;

    const myMsgs = await db.collection('messages').getAll<ChatMessage>();
    const followedContent = await db.collection('followed_content').getAll<any>();
    
    const otherMsgs = followedContent.filter(d => d.roomId !== undefined && d.text !== undefined);

    const allMsgs = [...myMsgs, ...otherMsgs].map(m => normalizeDoc(m));
    
    // Filter by current room
    const roomMsgs = allMsgs.filter(m => m.roomId === currentRoom?._id);

    // Deduplicate
    const uniqueMsgs = new Map<string, ChatMessage>();
    roomMsgs.forEach(m => uniqueMsgs.set(m._id!, m));

    const sortedMsgs = Array.from(uniqueMsgs.values()).sort((a, b) => a.createdAt - b.createdAt);

    const container = document.getElementById('messages-container')!;
    const isAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 50;

    container.innerHTML = '';

    sortedMsgs.forEach(msg => {
        const isMine = msg.authorId === 'me' || msg.authorId === db?.publicId;
        const profile = profileMap.get(msg.authorId);
        const name = profile?.name || msg.authorName || msg.authorId;

        const div = document.createElement('div');
        div.className = `message ${isMine ? 'mine' : 'others'}`;
        div.innerHTML = `
            <div class="msg-info">${escapeHtml(name)} • ${new Date(msg.createdAt).toLocaleTimeString()}</div>
            <div class="msg-text">${escapeHtml(msg.text)}</div>
        `;
        container.appendChild(div);
    });

    if (isAtBottom) {
        container.scrollTop = container.scrollHeight;
    }
}

// --- Actions ---

async function createRoom() {
    if (!db) return;
    const name = prompt('Enter Room Name:');
    if (!name) return;

    const id = await db.collection('rooms').save({
        name,
        createdBy: 'me',
        createdAt: Date.now()
    });

    await db.share(id, true, 'rooms');
    await db.sync();
    await refreshData();
}

async function deleteRoom(room: Room) {
    if (!db || !confirm(`Delete room "${room.name}"?`)) return;
    
    if (room._id) {
        // Only if it's mine
        try {
            await db.unshare(room._id);
            await db.collection('rooms').delete(room._id);
        } catch (e) {
            console.error('Failed to delete room', e);
        }
    }
    
    if (currentRoom?._id === room._id) {
        currentRoom = null;
        views.chat.classList.add('hidden');
        views.welcome.classList.remove('hidden');
    }

    await db.sync();
    await refreshData();
}

async function sendMessage() {
    if (!db || !currentRoom) return;
    const text = inputs.message.value.trim();
    if (!text) return;

    const myProfile = await db.profile.get();

    const msg: ChatMessage = {
        roomId: currentRoom._id!,
        text,
        authorId: 'me',
        authorName: myProfile?.displayName || 'Anonymous',
        createdAt: Date.now()
    };

    const id = await db.collection('messages').save(msg);
    await db.share(id, true, 'messages');
    
    inputs.message.value = '';
    await renderMessages();
    
    db.sync();
}

async function saveProfile() {
    if (!db) return;
    const name = inputs.displayName.value.trim();
    if (!name) return;

    let avatarUrl = undefined;
    if (inputs.avatarFile.files?.[0]) {
        const file = inputs.avatarFile.files[0];
        const buffer = await file.arrayBuffer();
        const meta = await db.storage.upload(file.name, new Uint8Array(buffer), file.type, true);
        avatarUrl = meta._id;
    }

    await db.profile.update({ displayName: name, avatarUrl });
    await db.sync();
    await loadMyProfile();
    views.profileModal.classList.add('hidden');
}

async function renderAvatar(blobId: string, imgEl: HTMLImageElement) {
    if (!db) return;
    try {
        const data = await db.storage.download(blobId, { decrypt: false });
        if (data) {
            const blob = new Blob([data as any]);
            imgEl.src = URL.createObjectURL(blob);
        }
    } catch (e) { }
}

function escapeHtml(text: string) {
    const map: any = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, (m) => map[m]);
}

// --- Events ---

document.getElementById('btn-connect')!.onclick = () => connect(undefined, true);
document.getElementById('btn-logout')!.onclick = () => {
    if (db) db.stopAutoSync();
    clearCurrentSession();
    location.reload();
};
document.getElementById('btn-new-room')!.onclick = createRoom;
document.getElementById('btn-send')!.onclick = sendMessage;
document.getElementById('message-input')!.onkeypress = (e) => {
    if (e.key === 'Enter') sendMessage();
};

document.getElementById('btn-edit-profile')!.onclick = () => views.profileModal.classList.remove('hidden');
document.getElementById('btn-close-profile')!.onclick = () => views.profileModal.classList.add('hidden');
document.getElementById('btn-save-profile')!.onclick = saveProfile;
document.getElementById('btn-sync-small')!.onclick = async () => {
    if (db) {
        await db.sync();
        await refreshData();
    }
};

// Initialization
window.addEventListener('load', async () => {
    renderSavedSessionsList();

    const currentSessionId = localStorage.getItem('chat_current_session_id');
    if (currentSessionId) {
        const sessions = getSavedSessions();
        const session = sessions.find(s => s.id === currentSessionId);
        if (session) {
            console.log('Auto-logging in:', session.userId);
            // Show a simple loading indicator or toast if possible, but alert is too intrusive
            // Just connect
            await connect(session.config, false);
            return;
        }
    }

    // Auto-fill and Pre-generate GUID if not restoring
    // inputs.userId.value = crypto.randomUUID(); // Optional: pre-fill new ID

    fetch('config.json').then(r => r.json()).then(config => {
        if (config.s3) {
            inputs.endpoint.value = config.s3.endpoint || '';
            inputs.bucket.value = config.s3.bucketName || '';
            inputs.accessKey.value = config.s3.accessKeyId || '';
            inputs.secretKey.value = config.s3.secretAccessKey || '';
        }
    }).catch(() => {});
});