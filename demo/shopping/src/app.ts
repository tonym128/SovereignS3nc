import { SovereignS3nc, IndexedDBStorage, deriveKey, createCryptoAdapter, SovereignAddress } from '../../../src/index';

// --- Interfaces ---
interface ShoppingList {
    _id: string;
    title: string;
    ownerId: string;
    createdAt: number;
    type: 'list';
}

interface ShoppingItem {
    _id: string;
    listId: string;
    text: string;
    createdAt: number;
    authorId: string;
    type: 'item';
}

interface ItemState {
    _id: string;
    itemId: string;
    isChecked: boolean;
    updatedAt: number;
    authorId: string;
    type: 'item_state';
}

// --- Global State ---
let db: SovereignS3nc | null = null;
let currentListId: string | null = null;
let currentUser: string = '';

// --- DOM Elements ---
const views = {
    auth: document.getElementById('view-auth')!,
    lists: document.getElementById('view-lists')!,
    detail: document.getElementById('view-list-detail')!,
    network: document.getElementById('view-network')!,
    settings: document.getElementById('view-settings')!,
    app: document.getElementById('app-area')!
};

const navLinks = {
    lists: document.getElementById('nav-lists')!,
    network: document.getElementById('nav-network')!,
    settings: document.getElementById('nav-settings')!
};

// --- Helpers ---
function showToast(msg: string) {
    const toastEl = document.getElementById('liveToast')!;
    document.getElementById('toast-body')!.textContent = msg;
    const toast = new (window as any).bootstrap.Toast(toastEl);
    toast.show();
}

function showLoading(show: boolean) {
    document.getElementById('loading')!.style.display = show ? 'flex' : 'none';
}

function switchView(viewName: keyof typeof views) {
    Object.values(views).forEach(el => el.style.display = 'none');
    if (viewName === 'app') {
        // App is container
        views.app.style.display = 'block';
        views.lists.style.display = 'block';
    } else if (viewName === 'auth') {
        views.auth.style.display = 'block';
    } else {
        views.app.style.display = 'block';
        views[viewName].style.display = 'block';
    }
}

// --- Logic ---

async function connect() {
    const appId = (document.getElementById('app-id') as HTMLInputElement).value.trim();
    let userId = (document.getElementById('user-id') as HTMLInputElement).value.trim();
    
    // Auth Mode
    const isOci = document.querySelector('.nav-link.active[data-bs-target="#tab-oci"]');
    
    const config: any = {
        paths: { appId, userId, storeId: 'shopping' },
        auth: {
            privatePassphrase: (document.getElementById('private-passphrase') as HTMLInputElement).value,
            publicPassphrase: (document.getElementById('public-passphrase') as HTMLInputElement).value
        },
        syncIntervalMs: 5000 // Auto sync every 5s
    };

    if (!config.auth.privatePassphrase || !config.auth.publicPassphrase) {
        return showToast('Both passphrases are required');
    }

    if (!userId) {
        userId = crypto.randomUUID().split('-')[0]; // Short ID
        (document.getElementById('user-id') as HTMLInputElement).value = userId;
        config.paths.userId = userId;
        alert(`Generated User ID: ${userId}. Save this!`);
    }

    if (isOci) {
        config.ociParUrl = (document.getElementById('oci-url') as HTMLInputElement).value;
        config.useManifest = true;
    } else {
        config.s3 = {
            endpoint: (document.getElementById('s3-endpoint') as HTMLInputElement).value,
            region: (document.getElementById('s3-region') as HTMLInputElement).value,
            bucketName: (document.getElementById('s3-bucket') as HTMLInputElement).value,
            credentials: {
                accessKeyId: (document.getElementById('s3-access-key') as HTMLInputElement).value,
                secretAccessKey: (document.getElementById('s3-secret-key') as HTMLInputElement).value
            },
            forcePathStyle: true
        };
        config.useManifest = true;
    }

    try {
        showLoading(true);
        const storage = new IndexedDBStorage(userId);
        
        // Verify Passphrase (decryption check)
        await storage.init();
        const identity = await storage.get('_sovereign_identity');
        if (identity && typeof identity.data === 'string') {
            try {
                const key = await deriveKey(config.auth.privatePassphrase, userId);
                const adapter = createCryptoAdapter(key);
                await adapter.decrypt(identity.data);
            } catch (e) {
                showLoading(false);
                return showToast('Incorrect Private Passphrase');
            }
        }

        db = new SovereignS3nc(config, storage);
        
        db.on('syncStart', () => console.log('Syncing...'));
        db.on('syncComplete', (stats) => {
            console.log('Sync complete', stats);
            if (stats.pulled > 0) {
                refreshUI();
            }
        });

        await db.init();
        currentUser = userId;

        switchView('app');
        refreshLists();
        loadNetwork();
        
        await db.sync();
        refreshUI();

    } catch (e) {
        console.error(e);
        showToast('Connection Failed: ' + e);
    } finally {
        showLoading(false);
    }
}

function refreshUI() {
    refreshLists();
    if (currentListId) {
        loadListDetails(currentListId);
    }
    loadNetwork();
}

async function refreshLists() {
    if (!db) return;
    
    // 1. My Lists
    const myLists = await db.collection('lists').getAll<ShoppingList>();
    
    // 2. Shared Lists (from followed content)
    const followedDocs = await db.collection('followed_content').getAll<any>();
    const sharedLists: ShoppingList[] = [];
    
    for (const doc of followedDocs) {
        // followed_content stores the original doc inside 'data' (which is encrypted locally)
        // BUT db.getAll automatically decrypts. 
        // The structure of followed content after decryption (in getAll) is:
        // { ...doc, _id: 'follow_user_originalId' }
        // Wait, getAll decrypts the 'data' field of the wrapper?
        // Let's look at SovereignS3nc.ts: pullFollowedContent stores encrypted data in 'data'.
        // getAll decrypts 'data'. So 'doc' here IS the inner document.
        if (doc.type === 'list') {
            sharedLists.push(doc);
        }
    }

    const container = document.getElementById('lists-container')!;
    container.innerHTML = '';

    const allLists = [...myLists, ...sharedLists];
    // Dedup by original ID (shared lists might appear twice if we follow ourselves? unlikely)
    
    allLists.sort((a, b) => b.createdAt - a.createdAt);

    if (allLists.length === 0) {
        container.innerHTML = '<div class="col-12 text-center text-muted mt-5">No lists found. Create one!</div>';
        return;
    }

    allLists.forEach(list => {
        const isMine = list.ownerId === currentUser || list.ownerId === 'me' || !list.ownerId; // 'me' legacy
        const col = document.createElement('div');
        col.className = 'col-md-4 mb-3';
        col.innerHTML = `
            <div class="card list-card h-100 shadow-sm" onclick="window.openList('${list._id}')">
                <div class="card-body">
                    <h5 class="card-title">${list.title}</h5>
                    <p class="card-text text-muted small">
                        Owner: ${isMine ? 'Me' : list.ownerId}<br>
                        Created: ${new Date(list.createdAt).toLocaleDateString()}
                    </p>
                </div>
            </div>
        `;
        container.appendChild(col);
    });
}

(window as any).openList = async (id: string) => {
    currentListId = id;
    views.lists.style.display = 'none';
    views.detail.style.display = 'block';
    await loadListDetails(id);
};

(window as any).closeList = () => {
    currentListId = null;
    views.detail.style.display = 'none';
    views.lists.style.display = 'block';
    refreshLists();
};

async function loadListDetails(listId: string) {
    if (!db) return;

    // Resolve List ID (could be local or followed)
    let list: ShoppingList | null = null;
    
    // Try local
    list = await db.collection('lists').get<ShoppingList>(listId);
    
    // Try followed
    if (!list) {
        list = await db.collection('followed_content').get<ShoppingList>(listId);
    }
    
    if (!list) {
        showToast('List not found');
        (window as any).closeList();
        return;
    }

    document.getElementById('detail-title')!.textContent = list.title;
    document.getElementById('detail-owner')!.textContent = `Owner: ${list.ownerId === currentUser ? 'Me' : list.ownerId}`;

    // Get Items
    // 1. Local Items
    const myItems = await db.collection('items').getAll<ShoppingItem>();
    
    // 2. Followed Items
    const followedItems = (await db.collection('followed_content').getAll<ShoppingItem>()).filter(i => i.type === 'item');
    
    // Filter by listId
    // Note: shared items might have listId matching the *original* list ID.
    // If we are viewing a shared list, 'listId' is the local ID (e.g., 'follow_alice_123').
    // But the items inside it refer to '123'. 
    // We need to handle ID resolution.
    
    // Heuristic:
    // If listId starts with 'follow_', extract the suffix (original ID).
    let targetListId = listId;
    if (listId.startsWith('follow_')) {
        const parts = listId.split('_');
        // format: follow_userId_originalId
        if (parts.length >= 3) {
            targetListId = parts.slice(2).join('_');
        }
    }

    const allItems = [...myItems, ...followedItems].filter(i => i.listId === targetListId || i.listId === listId);

    // Get States (Toggles)
    const myStates = await db.collection('item_states').getAll<ItemState>();
    const followedStates = (await db.collection('followed_content').getAll<ItemState>()).filter(s => s.type === 'item_state');
    const allStates = [...myStates, ...followedStates];

    // Map latest state to item
    const itemStates = new Map<string, boolean>(); // itemId -> isChecked
    
    // Group states by itemId
    const statesByItem = new Map<string, ItemState[]>();
    allStates.forEach(s => {
        if (!statesByItem.has(s.itemId)) statesByItem.set(s.itemId, []);
        statesByItem.get(s.itemId)!.push(s);
    });

    statesByItem.forEach((states, itemId) => {
        // Sort by time descending
        states.sort((a, b) => b.updatedAt - a.updatedAt);
        if (states.length > 0) {
            itemStates.set(itemId, states[0].isChecked);
        }
    });

    const ul = document.getElementById('items-container')!;
    ul.innerHTML = '';

    allItems.sort((a, b) => a.createdAt - b.createdAt);

    allItems.forEach(item => {
        // Resolve Item ID for state lookup
        // If item is followed, its ID is 'follow_user_origId'.
        // State might refer to 'origId'.
        // We need to be careful.
        // Actually, the ITEM doc contains its own ID. 
        // If it was created by me, ID is UUID.
        // If it was created by alice, ID in 'followed_content' is 'follow_alice_UUID'.
        // But the 'itemId' in 'ItemState' (created by me or alice) refers to... what?
        // It refers to the *Original ID* usually.
        
        let originalItemId = item._id;
        if (originalItemId.startsWith('follow_')) {
             const parts = originalItemId.split('_');
             if (parts.length >= 3) originalItemId = parts.slice(2).join('_');
        }

        // However, if *I* create a state for a shared item, I must refer to the ID that everyone agrees on.
        // Everyone agrees on the Creator's ID.
        
        // Let's assume 'targetListId' logic applies to items too.
        
        const isChecked = itemStates.get(originalItemId) || false;

        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between align-items-center';
        li.innerHTML = `
            <div style="cursor:pointer;" onclick="window.toggleItem('${originalItemId}')">
                <input type="checkbox" class="form-check-input me-2" ${isChecked ? 'checked' : ''} disabled>
                <span class="${isChecked ? 'completed' : ''}">${item.text}</span>
            </div>
            <small class="text-muted" style="font-size:0.7em;">${item.authorId}</small>
        `;
        ul.appendChild(li);
    });
}

(window as any).createList = async () => {
    if (!db) return;
    const name = (document.getElementById('input-list-name') as HTMLInputElement).value;
    if (!name) return;

    const modalEl = document.getElementById('modal-new-list');
    const modal = (window as any).bootstrap.Modal.getInstance(modalEl);
    
    const id = await db.collection('lists').save({
        title: name,
        ownerId: currentUser,
        createdAt: Date.now(),
        type: 'list'
    });
    
    // Share immediately
    await db.share(id, true, 'lists');
    
    modal.hide();
    (document.getElementById('input-list-name') as HTMLInputElement).value = '';
    
    refreshLists();
    db.sync(); // push
};

(window as any).addItem = async () => {
    if (!db || !currentListId) return;
    const input = document.getElementById('input-new-item') as HTMLInputElement;
    const text = input.value.trim();
    if (!text) return;

    // Resolve List ID (we want the canonical/original ID if it's shared)
    let targetListId = currentListId;
    if (currentListId.startsWith('follow_')) {
        const parts = currentListId.split('_');
        if (parts.length >= 3) targetListId = parts.slice(2).join('_');
    }

    const item: any = {
        listId: targetListId,
        text,
        createdAt: Date.now(),
        authorId: currentUser,
        type: 'item'
    };

    const id = await db.collection('items').save(item);
    await db.share(id, true, 'items');

    input.value = '';
    loadListDetails(currentListId); // Refresh UI immediately
    db.sync();
};

(window as any).toggleItem = async (originalItemId: string) => {
    if (!db) return;
    
    // Get current state to flip it
    // We need to fetch all states again? Or just pass it?
    // Let's just assume we need to calculate it or we pass it.
    // Simpler: Just get the UI state.
    // Actually, safer to re-calculate.
    
    // Quick Hack: Toggle based on UI check for responsiveness, but logic needs state.
    // Let's just create a NEW state that is "Latest".
    // Problem: We don't know if we are checking or unchecking without knowing current state.
    
    // Let's query states for this item.
    const myStates = (await db.collection('item_states').getAll<ItemState>()).filter(s => s.itemId === originalItemId);
    const followedStates = (await db.collection('followed_content').getAll<ItemState>()).filter(s => s.type === 'item_state' && s.itemId === originalItemId);
    
    const allStates = [...myStates, ...followedStates];
    allStates.sort((a, b) => b.updatedAt - a.updatedAt);
    
    const currentState = allStates.length > 0 ? allStates[0].isChecked : false;
    const newState = !currentState;

    const stateDoc: any = {
        itemId: originalItemId,
        isChecked: newState,
        updatedAt: Date.now(),
        authorId: currentUser,
        type: 'item_state'
    };
    
    const id = await db.collection('item_states').save(stateDoc);
    await db.share(id, true, 'item_states');
    
    if (currentListId) loadListDetails(currentListId);
    db.sync();
};

// --- Network ---
async function loadNetwork() {
    if (!db) return;
    const addr = db.getAddress();
    (document.getElementById('my-address') as HTMLInputElement).value = JSON.stringify(addr);

    const following = await db.social.getFollowing();
    const ul = document.getElementById('following-list')!;
    ul.innerHTML = '';
    
    following.forEach(f => {
        const li = document.createElement('li');
        li.className = 'list-group-item';
        li.innerHTML = `<strong>${f.userId}</strong> (${f.appId})`;
        ul.appendChild(li);
    });
}

document.getElementById('btn-follow')!.addEventListener('click', async () => {
    if (!db) return;
    const val = (document.getElementById('input-follow-address') as HTMLInputElement).value.trim();
    try {
        const addr = JSON.parse(val);
        await db.social.follow(addr);
        showToast(`Followed ${addr.userId}`);
        loadNetwork();
        db.sync(); // Pull their lists
    } catch (e) {
        showToast('Invalid JSON');
    }
});

// --- Event Listeners ---
document.getElementById('btn-connect')!.addEventListener('click', connect);
document.getElementById('btn-create-list')!.addEventListener('click', (window as any).createList);
document.getElementById('btn-add-item')!.addEventListener('click', (window as any).addItem);

document.getElementById('nav-lists')!.addEventListener('click', () => {
    switchView('lists');
    refreshLists();
});
document.getElementById('nav-network')!.addEventListener('click', () => {
    switchView('network');
    loadNetwork();
});
document.getElementById('nav-settings')!.addEventListener('click', () => switchView('settings'));

document.getElementById('btn-clear-data')!.addEventListener('click', async () => {
    if (confirm('Delete all local data?')) {
        indexedDB.deleteDatabase('sovereign_db_' + currentUser);
        location.reload();
    }
});

// Auto-fill config
window.addEventListener('load', async () => {
    try {
        const c = await (await fetch('config.json')).json();
        if (c.s3) {
            (document.getElementById('s3-endpoint') as HTMLInputElement).value = c.s3.endpoint;
            (document.getElementById('s3-bucket') as HTMLInputElement).value = c.s3.bucketName;
            (document.getElementById('s3-region') as HTMLInputElement).value = c.s3.region;
            (document.getElementById('s3-access-key') as HTMLInputElement).value = c.s3.accessKeyId;
            (document.getElementById('s3-secret-key') as HTMLInputElement).value = c.s3.secretAccessKey;
        }
        if (c.appId) (document.getElementById('app-id') as HTMLInputElement).value = c.appId;
    } catch (e) {}
});
