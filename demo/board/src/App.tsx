import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { SovereignS3nc } from '../../../src/SovereignS3nc';
import { FeedModule, Post } from '../../../src/modules/Feed';
import { ProfileModule } from '../../../src/modules/Profile';
import { WebRTCRemoteAdapter } from '../../../src/adapters/WebRTCRemoteAdapter';
import { IRemoteAdapter } from '../../../src/interfaces/IRemoteAdapter';
import { Buffer } from 'buffer';
import { SyncStatusIndicator, QuickStartCard, toast, ToastContainer } from '@sovereigns3nc/demo-shared';

const App = () => {
    // --- State ---
    const [config, setConfig] = useState({
        syncMode: 's3',
        endpoint: 'http://127.0.0.1:9000',
        region: 'rustfs',
        accessKeyId: 'user-key',
        secretAccessKey: 'user-secret-123',
        bucketName: 'sovereign-demo',
        appId: 'sov-board',
        userId: 'user-' + Math.random().toString(36).substring(7),
        password: 'password123',
    });

    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [sov, setSov] = useState<SovereignS3nc | null>(null);
    const [boardModule, setBoardModule] = useState<FeedModule | null>(null);
    const [profileModule, setProfileModule] = useState<ProfileModule | null>(null);
    
    const [tasks, setTasks] = useState<Post[]>([]);
    const [syncing, setSyncing] = useState(false);
    const [lastSync, setLastSync] = useState<Date | null>(null);
    const [selectedGroup, setSelectedGroup] = useState<any | null>(null);
    const [groups, setGroups] = useState<any[]>([]);
    
    const [showCreateBoard, setShowCreateBoard] = useState(false);
    const [newBoardName, setNewBoardName] = useState('');

    const COLUMNS = ['Todo', 'In Progress', 'Done'];

    useEffect(() => {
        const isLocalHost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
        const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
        const requestedMode = urlParams.get('mode');

        fetch('config.json')
            .then(res => res.json())
            .then(data => {
                const endpointIsLocal = data.endpoint && (data.endpoint.includes('127.0.0.1') || data.endpoint.includes('localhost'));
                let defaultMode = data.syncMode || (isLocalHost ? 's3' : 'webrtc');
                if (requestedMode) defaultMode = requestedMode;
                if (!isLocalHost && endpointIsLocal && !requestedMode) {
                    defaultMode = 'webrtc';
                }
                setConfig(prev => ({
                    ...prev,
                    endpoint: data.endpoint || prev.endpoint,
                    region: data.region || prev.region,
                    accessKeyId: data.accessKeyId || prev.accessKeyId,
                    secretAccessKey: data.secretAccessKey || prev.secretAccessKey,
                    bucketName: data.bucketName || prev.bucketName,
                    syncMode: defaultMode
                }));
            })
            .catch(() => {
                if (!isLocalHost) {
                    setConfig(prev => ({ ...prev, syncMode: requestedMode || 'webrtc' }));
                }
            });
    }, []);

    // --- Core Logic ---
    const login = async () => {
        setSyncing(true);
        try {
            let remoteAdapter: IRemoteAdapter | undefined;
            if (config.syncMode === 'webrtc') {
                const webrtc = new WebRTCRemoteAdapter(config.userId);
                const bc = new BroadcastChannel('sov-board-mesh');
                const peer = webrtc.connectPeer((msg) => bc.postMessage(msg));
                if (peer) {
                    bc.onmessage = (e) => peer.receive(e.data);
                }
                remoteAdapter = webrtc;
            }

            const instance = await SovereignS3nc.create({
                s3: config.syncMode === 's3' ? {
                    endpoint: config.endpoint,
                    region: config.region,
                    credentials: {
                        accessKeyId: config.accessKeyId,
                        secretAccessKey: config.secretAccessKey
                    },
                    bucketName: config.bucketName,
                    forcePathStyle: true
                } : undefined,
                offline: config.syncMode === 'offline',
                paths: {
                    appId: config.appId,
                    userId: config.userId,
                    storeId: 'main'
                },
                password: config.password,
                useWorker: true,
                workerUrl: 'sync-worker.js'
            }, remoteAdapter);

            setSov(instance);
            setProfileModule(new ProfileModule(instance));
            const feed = new FeedModule(instance);
            setBoardModule(feed);
            
            setIsLoggedIn(true);
            await instance.sync();
            setLastSync(new Date());
            
            // Load groups (boards)
            const myGroups = await instance.getGroups();
            setGroups(myGroups);
            if (myGroups && myGroups.length > 0) {
                setSelectedGroup(myGroups[0]);
            } else {
                setSelectedGroup(null);
                setShowCreateBoard(true); // Suggest creation if none exist
            }
        } catch (err) {
            console.error('Login failed', err);
            toast.error('Login failed: ' + (err as Error).message);
        } finally {
            setSyncing(false);
        }
    };

    const createBoard = async () => {
        if (!sov || !newBoardName) return;
        setSyncing(true);
        try {
            console.log('Creating board:', newBoardName);
            const pubKey = sov.getConfig().publicEncryptionKey;
            if (!pubKey) throw new Error('Identity keys not initialized');

            const members = [{
                userId: config.userId,
                publicKey: pubKey,
                role: 'owner' as const
            }];
            
            const group = await sov.createGroup(newBoardName, members);
            console.log('Board created:', group);
            
            const updatedGroups = [...groups, group];
            setGroups(updatedGroups);
            setSelectedGroup(group);
            setNewBoardName('');
            setShowCreateBoard(false);
            await sov.sync();
            toast.success(`Board "${newBoardName}" created successfully!`);
            console.log('Sync complete after board creation');
        } catch (err) {
            console.error('Failed to create board', err);
            toast.error('Failed to create board: ' + (err as Error).message);
        } finally {
            setSyncing(false);
        }
    };

    const loadTasks = async () => {
        if (!boardModule || !selectedGroup || typeof selectedGroup === 'string') return;
        try {
            const today = new Date().toISOString().split('T')[0];
            const posts = await boardModule.getGroupPosts(selectedGroup.id, today);
            setTasks(posts);
        } catch (err) {
            console.error('Failed to load tasks', err);
        }
    };

    const addTask = async (column: string) => {
        if (!selectedGroup || typeof selectedGroup === 'string') {
            toast.warning('Please select or create a board first.');
            return;
        }
        const title = prompt('Task Title');
        if (!title || !boardModule) return;
        
        try {
            await boardModule.postToGroup(selectedGroup.id, selectedGroup.sharedKey, JSON.stringify({
                title,
                column,
                priority: 'medium',
                createdAt: Date.now()
            }));
            
            await loadTasks();
            sov?.sync();
            toast.success(`Task "${title}" added to ${column}`);
        } catch (err) {
            console.error('Failed to add task', err);
            toast.error('Failed to add task: ' + (err as Error).message);
        }
    };

    const moveTask = async (task: Post, newColumn: string) => {
        if (!boardModule || !selectedGroup) return;
        const today = new Date().toISOString().split('T')[0];
        const data = JSON.parse(task.content);
        data.column = newColumn;
        
        await boardModule.editGroupPost(selectedGroup.id, selectedGroup.sharedKey, task.id, today, JSON.stringify(data));
        await loadTasks();
        sov?.sync();
    };

    const deleteTask = async (task: Post) => {
        if (!boardModule || !selectedGroup || !confirm('Delete task?')) return;
        const today = new Date().toISOString().split('T')[0];
        await boardModule.deleteGroupPost(selectedGroup.id, selectedGroup.sharedKey, task.id, today, task.userId);
        await loadTasks();
        sov?.sync();
    };

    useEffect(() => {
        if (isLoggedIn) {
            loadTasks();
            const interval = setInterval(() => {
                sov?.sync().then(() => {
                    setLastSync(new Date());
                    loadTasks();
                });
            }, 30000);
            return () => clearInterval(interval);
        }
    }, [isLoggedIn, selectedGroup]);

    // --- Render Helpers ---
    if (!isLoggedIn) {
        return (
            <div className="container mt-5">
                <div className="row justify-content-center">
                    <div className="col-md-6">
                        <div className="card shadow">
                            <div className="card-body">
                                <h3 className="card-title mb-3">Sovereign Board Login</h3>

                                {/* Quick Start Card */}
                                <QuickStartCard
                                    title="⚡ Quick Start (Offline Board)"
                                    subtitle="Instant Kanban Sandbox"
                                    description="Try Kanban boards locally with IndexedDB storage. No credentials needed."
                                    buttonText="⚡ Launch Instant Board"
                                    className="mb-4"
                                    onLaunch={() => {
                                        setConfig(prev => ({ ...prev, syncMode: 'offline' }));
                                        setTimeout(login, 50);
                                    }}
                                />

                                <div className="d-flex align-items-center my-3">
                                    <hr className="flex-grow-1 my-0 text-muted" />
                                    <span className="px-2 text-muted x-small text-uppercase fw-bold">Or Custom Mode</span>
                                    <hr className="flex-grow-1 my-0 text-muted" />
                                </div>

                                <div className="mb-3">
                                    <label className="form-label fw-bold">Sync Mode</label>
                                    <div className="btn-group w-100 mb-2" role="group" aria-label="Sync Mode Selection">
                                        <button type="button" className={`btn btn-sm ${config.syncMode === 'webrtc' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setConfig({...config, syncMode: 'webrtc'})}>
                                            ⚡ WebRTC Mesh
                                        </button>
                                        <button type="button" className={`btn btn-sm ${config.syncMode === 's3' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setConfig({...config, syncMode: 's3'})}>
                                            ☁️ S3 Remote
                                        </button>
                                        <button type="button" className={`btn btn-sm ${config.syncMode === 'offline' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setConfig({...config, syncMode: 'offline'})}>
                                            💾 Offline IDB
                                        </button>
                                    </div>
                                    <small className="text-muted d-block">
                                        {config.syncMode === 'webrtc' && 'Peer-to-peer gossip mesh across open tabs & local peers.'}
                                        {config.syncMode === 's3' && 'Two-way sync with an S3-compatible bucket.'}
                                        {config.syncMode === 'offline' && 'Purely local storage via IndexedDB & SQLite WASM.'}
                                    </small>
                                </div>
                                {config.syncMode === 's3' && (
                                    <div className="mb-3">
                                        <label htmlFor="boardEndpoint" className="form-label">S3 Endpoint</label>
                                        <input id="boardEndpoint" type="text" className="form-control" aria-label="S3 Endpoint" value={config.endpoint} onChange={e => setConfig({...config, endpoint: e.target.value})} />
                                    </div>
                                )}
                                <div className="mb-3">
                                    <label htmlFor="boardUserId" className="form-label">User ID</label>
                                    <input id="boardUserId" type="text" className="form-control" aria-label="User ID" value={config.userId} onChange={e => setConfig({...config, userId: e.target.value})} />
                                </div>
                                <div className="mb-3">
                                    <label htmlFor="boardPassword" className="form-label">Password</label>
                                    <input id="boardPassword" type="password" className="form-control" aria-label="Password" value={config.password} onChange={e => setConfig({...config, password: e.target.value})} />
                                </div>
                                <button className="btn btn-primary w-100" onClick={login} disabled={syncing}>
                                    {syncing ? 'Connecting...' : 'Join Workspace'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <ToastContainer />
            </div>
        );
    }

    return (
        <div className="d-flex flex-column" style={{ height: '100vh' }}>
            <nav className="navbar navbar-expand-lg navbar-dark bg-dark px-4">
                <span className="navbar-brand">SOVEREIGN BOARD</span>
                <div className="ms-auto d-flex align-items-center gap-3">
                    {groups.length > 0 && (
                        <select className="form-select form-select-sm bg-dark text-white border-secondary" 
                            aria-label="Select Board"
                            value={selectedGroup?.id || ''} 
                            onChange={e => setSelectedGroup(groups.find(g => g.id === e.target.value))}>
                            <option value="" disabled>Select Board...</option>
                            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                    )}

                    {showCreateBoard ? (
                        <div className="d-flex gap-2">
                            <input type="text" className="form-control form-control-sm" placeholder="Board Name" aria-label="Board Name" value={newBoardName} onChange={e => setNewBoardName(e.target.value)} autoFocus />
                            <button className="btn btn-sm btn-success" onClick={createBoard}>Create</button>
                            <button className="btn btn-sm btn-outline-secondary text-white" onClick={() => setShowCreateBoard(false)}>Cancel</button>
                        </div>
                    ) : (
                        <button className="btn btn-sm btn-primary" onClick={() => setShowCreateBoard(true)}>
                            <i className="bi bi-plus-lg me-1"></i> New Board
                        </button>
                    )}

                    <SyncStatusIndicator
                        syncing={syncing}
                        lastSync={lastSync}
                        syncMode={config.syncMode}
                        onSync={() => sov?.sync().then(() => { setLastSync(new Date()); loadTasks(); })}
                    />
                </div>
            </nav>

            <div className="kanban-board" role="main" aria-label="Kanban Board">
                {COLUMNS.map(col => (
                    <div key={col} className="kanban-column" role="region" aria-label={`${col} column`} onDragOver={e => e.preventDefault()} onDrop={e => {
                        const taskData = e.dataTransfer.getData('task');
                        if (taskData) moveTask(JSON.parse(taskData), col);
                    }}>
                        <div className="kanban-column-header">
                            <span>{col.toUpperCase()}</span>
                            <span className="badge bg-secondary rounded-pill">
                                {tasks.filter(t => JSON.parse(t.content).column === col).length}
                            </span>
                        </div>
                        <div className="kanban-tasks" role="list" aria-label={`${col} tasks`}>
                            {tasks.filter(t => JSON.parse(t.content).column === col).map(task => {
                                const data = JSON.parse(task.content);
                                return (
                                    <div key={task.id} className={`kanban-task priority-${data.priority}`} role="listitem" draggable onDragStart={e => e.dataTransfer.setData('task', JSON.stringify(task))}>
                                        <div className="d-flex justify-content-between align-items-center">
                                            <div className="kanban-task-title">{data.title}</div>
                                            <button type="button" className="btn btn-link p-0 text-danger border-0" aria-label={`Delete task ${data.title}`} onClick={() => deleteTask(task)}>
                                                <i className="bi bi-trash" style={{fontSize: '0.8rem'}}></i>
                                            </button>
                                        </div>
                                        <div className="kanban-task-meta">
                                            <div className="kanban-task-avatar">{task.userId.substring(0, 2).toUpperCase()}</div>
                                            <span>{new Date(data.createdAt).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="p-2">
                            <button className="add-task-btn" aria-label={`Add card to ${col}`} onClick={() => addTask(col)}>
                                <i className="bi bi-plus-lg me-2"></i>Add a card
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            <ToastContainer />
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
