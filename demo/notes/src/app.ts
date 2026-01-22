import { SovereignS3nc, IndexedDBStorage } from '../../../src/index';

interface Note {
    _id?: string;
    title: string;
    content: string;
    updatedAt: number;
}

// --- State ---
let db: SovereignS3nc | null = null;
let currentNoteId: string | null = null;

// --- DOM ---
const views = {
    login: document.getElementById('view-login')!,
    list: document.getElementById('view-list')!,
    editor: document.getElementById('view-editor')!
};

const inputs = {
    appId: document.getElementById('config-app-id') as HTMLInputElement,
    userId: document.getElementById('config-user-id') as HTMLInputElement,
    endpoint: document.getElementById('s3-endpoint') as HTMLInputElement,
    region: document.getElementById('s3-region') as HTMLInputElement,
    bucket: document.getElementById('s3-bucket') as HTMLInputElement,
    accessKey: document.getElementById('s3-access-key') as HTMLInputElement,
    secretKey: document.getElementById('s3-secret-key') as HTMLInputElement,
    
    title: document.getElementById('editor-title') as HTMLInputElement,
    content: document.getElementById('editor-content') as HTMLTextAreaElement
};

const loading = document.getElementById('loading')!;

// --- Helpers ---
function showToast(msg: string) {
    const el = document.getElementById('toast')!;
    el.textContent = msg;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 3000);
}

function showView(view: 'login' | 'list' | 'editor') {
    Object.values(views).forEach(el => el.classList.add('hidden'));
    views[view].classList.remove('hidden');
}

// --- Logic ---

async function connect() {
    const appId = inputs.appId.value.trim();
    let userId = inputs.userId.value.trim();
    
    const endpoint = inputs.endpoint.value.trim();
    const bucket = inputs.bucket.value.trim();
    const region = inputs.region.value.trim();
    const accessKeyId = inputs.accessKey.value.trim();
    const secretAccessKey = inputs.secretKey.value.trim();

    if (!appId || !endpoint || !bucket || !accessKeyId || !secretAccessKey) {
        showToast('Please fill in all fields');
        return;
    }

    if (!userId) {
        userId = crypto.randomUUID();
        inputs.userId.value = userId;
        alert(`New User ID generated: ${userId}\n\nSave this ID! You will need it to access these notes on other devices.`);
    }

    const config = {
        paths: { appId, userId, storeId: 'notes' },
        encryptionKey: 'demo-notes-secret-key-32-bytes!!', // Hardcoded for demo simplicity
        s3: {
            endpoint,
            region,
            bucketName: bucket,
            credentials: { accessKeyId, secretAccessKey },
            forcePathStyle: true
        },
        useManifest: true,
        syncIntervalMs: 0 // Manual sync
    };

    try {
        const storage = new IndexedDBStorage(userId);
        db = new SovereignS3nc(config, storage);

        db.on('syncStart', () => loading.style.display = 'block');
        db.on('syncComplete', () => {
            loading.style.display = 'none';
            refreshList(); // Refresh list after sync
        });

        await db.init();
        showToast('Connected!');
        
        showView('list');
        await db.sync();
        refreshList();

    } catch (e) {
        console.error(e);
        showToast('Error connecting: ' + (e instanceof Error ? e.message : String(e)));
    }
}

async function refreshList() {
    if (!db) return;
    const notes = await db.collection('notes').getAll<Note>();
    
    // Sort by updated descending
    notes.sort((a, b) => b.updatedAt - a.updatedAt);

    const container = document.getElementById('notes-container')!;
    container.innerHTML = '';

    if (notes.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #888;">No notes found.</p>';
        return;
    }

    notes.forEach(note => {
        const div = document.createElement('div');
        div.className = 'note-item';
        div.innerHTML = `
            <div>
                <strong>${escapeHtml(note.title || 'Untitled')}</strong><br>
                <span class="timestamp">${new Date(note.updatedAt).toLocaleString()}</span>
            </div>
            <span style="color: #888;">&rsaquo;</span>
        `;
        div.onclick = () => openNote(note);
        container.appendChild(div);
    });
}

function openNote(note: Note) {
    currentNoteId = note._id!;
    inputs.title.value = note.title;
    inputs.content.value = note.content;
    showView('editor');
}

function createNote() {
    currentNoteId = null;
    inputs.title.value = '';
    inputs.content.value = '';
    showView('editor');
}

async function saveNote() {
    if (!db) return; 
    
    const title = inputs.title.value.trim();
    const content = inputs.content.value;
    
    if (!title && !content) {
        showView('list');
        return;
    }

    const note: Note = {
        title,
        content,
        updatedAt: Date.now()
    };

    if (currentNoteId) {
        note._id = currentNoteId;
    }

    await db.collection('notes').save(note);
    showToast('Saved!');
    showView('list');
    
    // Sync in background
    db.sync(); 
    refreshList();
}

async function deleteNote() {
    if (!db || !currentNoteId) return;
    if (!confirm('Delete this note?')) return;

    await db.collection('notes').delete(currentNoteId);
    showToast('Deleted');
    showView('list');
    
    db.sync();
    refreshList();
}

function escapeHtml(text: string) {
    const map: any = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, (m) => map[m]);
}

// --- Event Listeners ---

document.getElementById('btn-connect')!.addEventListener('click', connect);
document.getElementById('btn-sync')!.addEventListener('click', async () => {
    if (db) {
        await db.sync();
        refreshList();
        showToast('Sync complete');
    }
});
document.getElementById('btn-create')!.addEventListener('click', createNote);
document.getElementById('btn-logout')!.addEventListener('click', () => {
    location.reload();
});

document.getElementById('btn-save')!.addEventListener('click', saveNote);
document.getElementById('btn-cancel')!.addEventListener('click', () => showView('list'));
document.getElementById('btn-delete')!.addEventListener('click', deleteNote);

// Try to auto-fill config if config.json exists (dev convenience)
fetch('config.json').then(r => r.json()).then(config => {
    if (config.s3) {
        inputs.endpoint.value = config.s3.endpoint || '';
        inputs.bucket.value = config.s3.bucketName || '';
        inputs.region.value = config.s3.region || '';
        inputs.accessKey.value = config.s3.accessKeyId || '';
        inputs.secretKey.value = config.s3.secretAccessKey || '';
    }
    if (config.appId) inputs.appId.value = config.appId;
}).catch(() => {});