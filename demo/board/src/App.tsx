import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { SovereignS3nc } from '../../../src/SovereignS3nc';
import { FeedModule, Post } from '../../../src/modules/Feed';
import { ProfileModule } from '../../../src/modules/Profile';
import { WebRTCRemoteAdapter } from '../../../src/adapters/WebRTCRemoteAdapter';
import { IRemoteAdapter } from '../../../src/interfaces/IRemoteAdapter';
import { Buffer } from 'buffer';

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

    // --- Core Logic ---
    const login = async () => {
        setSyncing(true);
        try {
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
                paths: {
                    appId: config.appId,
                    userId: config.userId,
                    storeId: 'main'
                },
                password: config.password,
                useWorker: true,
                workerUrl: 'sync-worker.js'
            });

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
            alert('Login failed: ' + (err as Error).message);
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
            console.log('Sync complete after board creation');
        } catch (err) {
            console.error('Failed to create board', err);
            alert('Failed to create board: ' + (err as Error).message);
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
            alert('Please select or create a board first.');
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
        } catch (err) {
            console.error('Failed to add task', err);
            alert('Failed to add task: ' + (err as Error).message);
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
                                <h3 className="card-title mb-4">Sovereign Board Login</h3>
                                <div className="mb-3">
                                    <label className="form-label">S3 Endpoint</label>
                                    <input type="text" className="form-control" value={config.endpoint} onChange={e => setConfig({...config, endpoint: e.target.value})} />
                                </div>
                                <div className="mb-3">
                                    <label className="form-label">User ID</label>
                                    <input type="text" className="form-control" value={config.userId} onChange={e => setConfig({...config, userId: e.target.value})} />
                                </div>
                                <div className="mb-3">
                                    <label className="form-label">Password</label>
                                    <input type="password" className="form-control" value={config.password} onChange={e => setConfig({...config, password: e.target.value})} />
                                </div>
                                <button className="btn btn-primary w-100" onClick={login} disabled={syncing}>
                                    {syncing ? 'Connecting...' : 'Join Workspace'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
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
                            value={selectedGroup?.id || ''} 
                            onChange={e => setSelectedGroup(groups.find(g => g.id === e.target.value))}>
                            <option value="" disabled>Select Board...</option>
                            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                    )}

                    {showCreateBoard ? (
                        <div className="d-flex gap-2">
                            <input type="text" className="form-control form-control-sm" placeholder="Board Name" value={newBoardName} onChange={e => setNewBoardName(e.target.value)} autoFocus />
                            <button className="btn btn-sm btn-success" onClick={createBoard}>Create</button>
                            <button className="btn btn-sm btn-outline-secondary text-white" onClick={() => setShowCreateBoard(false)}>Cancel</button>
                        </div>
                    ) : (
                        <button className="btn btn-sm btn-primary" onClick={() => setShowCreateBoard(true)}>
                            <i className="bi bi-plus-lg me-1"></i> New Board
                        </button>
                    )}

                    <div className="sync-indicator text-secondary d-none d-md-block">
                        {syncing ? <span className="spinner-border spinner-border-sm me-1"></span> : <i className="bi bi-cloud-check me-1"></i>}
                        {lastSync ? `Synced ${lastSync.toLocaleTimeString()}` : 'Never synced'}
                    </div>
                    <button className="btn btn-outline-light btn-sm" onClick={() => sov?.sync().then(loadTasks)}>Sync Now</button>
                </div>
            </nav>

            <div className="kanban-board">
                {COLUMNS.map(col => (
                    <div key={col} className="kanban-column" onDragOver={e => e.preventDefault()} onDrop={e => {
                        const taskData = e.dataTransfer.getData('task');
                        if (taskData) moveTask(JSON.parse(taskData), col);
                    }}>
                        <div className="kanban-column-header">
                            <span>{col.toUpperCase()}</span>
                            <span className="badge bg-secondary rounded-pill">
                                {tasks.filter(t => JSON.parse(t.content).column === col).length}
                            </span>
                        </div>
                        <div className="kanban-tasks">
                            {tasks.filter(t => JSON.parse(t.content).column === col).map(task => {
                                const data = JSON.parse(task.content);
                                return (
                                    <div key={task.id} className={`kanban-task priority-${data.priority}`} draggable onDragStart={e => e.dataTransfer.setData('task', JSON.stringify(task))}>
                                        <div className="d-flex justify-content-between">
                                            <div className="kanban-task-title">{data.title}</div>
                                            <i className="bi bi-trash text-danger" style={{fontSize: '0.8rem'}} onClick={() => deleteTask(task)}></i>
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
                            <button className="add-task-btn" onClick={() => addTask(col)}>
                                <i className="bi bi-plus-lg me-2"></i>Add a card
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
