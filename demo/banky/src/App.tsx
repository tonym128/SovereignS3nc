import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { SovereignS3nc } from '../../../src/SovereignS3nc';
import { ProfileModule } from '../../../src/modules/Profile';
import { MessagingModule } from '../../../src/modules/Messaging';
import { BankyManager, BankAccount, Transaction, Goal } from './Banky';
import { IRemoteAdapter, DownloadResult } from '../../../src/interfaces/IRemoteAdapter';
import { S3RemoteAdapter } from '../../../src/adapters/S3RemoteAdapter';
import { IndexedDBStorage } from '../../../src/adapters/IndexedDBStorage';

const DEBUG = true;

const App = () => {
    const [config, setConfig] = useState<any>({
        paths: {
            userId: localStorage.getItem('sov_banky_userId') || '',
            appId: 'banky-sov',
            storeId: 'main'
        },
        password: ''
    });
    
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    // ... rest of state
    const [sov, setSov] = useState<SovereignS3nc | null>(null);
    const [banky, setBanky] = useState<BankyManager | null>(null);
    const [accounts, setAccounts] = useState<BankAccount[]>([]);
    const [sharedAccounts, setSharedAccounts] = useState<any[]>([]);
    const [selectedAccount, setSelectedAccount] = useState<BankAccount | null>(null);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [goals, setGoals] = useState<Goal[]>([]);
    const chartRef = useRef<HTMLCanvasElement>(null);
    const chartInstance = useRef<any>(null);
    const [following, setFollowing] = useState<any[]>([]);
    const [registry, setRegistry] = useState<any[]>([]);
    const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [currentTab, setCurrentTab] = useState<'accounts' | 'sharing' | 'profile'>('accounts');
    const [profile, setProfile] = useState<any>({ name: '', avatar: '' });
    const [dialog, setDialog] = useState<any>(null);
    const accountFileRef = useRef<HTMLInputElement>(null);

    const handleLogout = () => {
        setIsLoggedIn(false);
        setSov(null);
        setBanky(null);
        setSelectedAccount(null);
        // We keep the userId in localStorage for convenience on next login
    };

    const handleClearCache = async () => {
        showConfirm('This will delete all local data. You will need to re-sync from S3. Continue?', async () => {
            // 1. Wipe all possible Sovereign databases for this app
            const dbs = await indexedDB.databases();
            for (const db of dbs) {
                if (db.name && db.name.startsWith(`sov_${config.paths.appId}_`)) {
                    console.log(`[Cache] Deleting database: ${db.name}`);
                    indexedDB.deleteDatabase(db.name);
                }
            }
            
            // 2. Clear all local storage
            localStorage.clear();
            
            // 3. Reset state and logout
            handleLogout();
            showAlert('Local cache cleared. Please login again.');
        });
    };

    // Load dynamic config
    useEffect(() => {
        fetch('config.json')
            .then(res => res.json())
            .then(data => {
                setConfig((prev: any) => ({ ...prev, s3: data }));
            })
            .catch(e => console.error('Failed to load config.json', e));
    }, []);

    // Initial Login
    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!config.paths.userId || !config.password) return;
        
        try {
            // Use the config loaded from config.json
            const instance = new SovereignS3nc(config);
            await instance.init();
            setSov(instance);
            
            const bm = new BankyManager(instance);
            setBanky(bm);
            
            localStorage.setItem('sov_banky_userId', config.paths.userId);
            setIsLoggedIn(true);
            await loadData(instance, bm);
        } catch (e: any) {
            alert('Login failed: ' + e.message);
        }
    };

    const loadData = async (v: SovereignS3nc, bm: BankyManager) => {
        setSyncing(true);
        try {
            const accs = await bm.getAccounts();
            setAccounts(accs);

            const reg = await v.getPublicRegistry();
            setRegistry(reg);
            
            const f = await v.getFollowing();
            setFollowing(f);

            // Auto-join logic using MessagingModule
            const messaging = new MessagingModule(v);
            const inbox = await messaging.getInboxMessages(2);
            for (const msg of inbox) {
                if (msg.content.startsWith('INVITE_GROUP:')) {
                    try {
                        const groupInfo = JSON.parse(msg.content.substring(13));
                        const groups = await v.getGroups();
                        if (!groups.find(g => g.id === groupInfo.id)) {
                            await v.joinGroup(groupInfo);
                            await v.respondToGroup(groupInfo.id, 'joined');
                        }
                    } catch(e) {}
                }
            }

            // Load groups (shared accounts)
            const groups = await v.getGroups();
            setSharedAccounts(groups);

            // Load profile using ProfileModule
            const profileModule = new ProfileModule(v);
            const p = await profileModule.getProfile();
            if (p) setProfile(p);

            setLastSyncTime(new Date().toLocaleTimeString());
        } catch (e) {}
        setSyncing(false);
    };

    const sync = async () => {
        if (!sov || !banky) return;
        setSyncing(true);
        await sov.sync();
        await loadData(sov, banky);
        setSyncing(false);
    };

    const handleCreateAccount = async () => {
        if (!banky) return;
        showPrompt('Enter Account Name:', async (name) => {
            if (name) {
                await banky.createAccount(name);
                await sync();
            }
        });
    };

    const handleRenameAccount = async (acc: BankAccount) => {
        if (!banky) return;
        showPrompt('New Account Name:', async (newName) => {
            if (newName && newName !== acc.name) {
                await banky.renameAccount(acc.id, newName);
                await sync();
                if (selectedAccount?.id === acc.id) {
                    setSelectedAccount({ ...acc, name: newName });
                }
            }
        }, acc.name);
    };

    const handleDeleteAccount = async (acc: BankAccount) => {
        if (!banky) return;
        showConfirm(`Delete account "${acc.name}"? This cannot be undone.`, async () => {
            await banky.deleteAccount(acc.id);
            await sync();
            if (selectedAccount?.id === acc.id) setSelectedAccount(null);
        });
    };

    const handleAccountImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!banky || !selectedAccount) return;
        const file = e.target.files?.[0];
        if (!file) return;
        
        try {
            const reader = new FileReader();
            reader.onload = async (ev) => {
                const img = await SovereignS3nc.compressImage(ev.target?.result as string, 100 * 1024);
                await banky.updateAccountImage(selectedAccount.id, img);
                await sync();
                setSelectedAccount({ ...selectedAccount, image: img });
            };
            reader.readAsDataURL(file);
        } catch (e) {
            showAlert('Failed to process image');
        }
    };

    const handleRemoveAccountImage = async () => {
        if (!banky || !selectedAccount) return;
        await banky.updateAccountImage(selectedAccount.id, null);
        await sync();
        setSelectedAccount({ ...selectedAccount, image: undefined });
    };

    const handleAddTransaction = async (isCredit: boolean) => {
        if (!banky || !selectedAccount) return;
        const type = isCredit ? 'Credit' : 'Debit';
        showPrompt(`Enter ${type} Amount:`, async (amt) => {
            const amount = parseFloat(amt);
            if (isNaN(amount)) return;
            
            showPrompt(`Enter description for ${type}:`, async (desc) => {
                if (desc) {
                    // Find if this is a shared account
                    const shared = sharedAccounts.find(g => g.id === selectedAccount.id);
                    await banky.addTransaction(selectedAccount.id, desc, isCredit ? amount : -amount, 'other', undefined, shared?.id, shared?.sharedKey);
                    await sync();
                    loadTransactions(selectedAccount);
                }
            });
        });
    };

    const loadTransactions = async (acc: BankAccount) => {
        if (!banky) return;
        setSelectedAccount(acc);
        const shared = sharedAccounts.find(g => g.id === acc.id);
        const txs = await banky.getTransactions(acc.id, 365, shared?.id, shared?.sharedKey);
        setTransactions(txs);
        
        const g = await banky.getGoals(acc.id);
        setGoals(g);
    };

    useEffect(() => {
        if (!chartRef.current || transactions.length === 0) return;
        
        const ctx = chartRef.current.getContext('2d');
        if (!ctx) return;

        // Destroy previous chart instance
        if (chartInstance.current) {
            chartInstance.current.destroy();
        }

        // Calculate running balance (transactions are sorted newest first)
        const sorted = [...transactions].reverse();
        let balance = 0;
        const data = sorted.map(tx => {
            balance += tx.amount;
            return balance;
        });
        const labels = sorted.map(tx => tx.date);

        // Render chart
        chartInstance.current = new (window as any).Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Balance',
                    data,
                    borderColor: '#0d6efd',
                    backgroundColor: 'rgba(13, 110, 253, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: { beginAtZero: true }
                }
            }
        });
    }, [transactions]);

    const handleDeleteTransaction = async (tx: Transaction) => {
        if (!banky || !selectedAccount) return;
        showConfirm('Delete this transaction?', async () => {
            const shared = sharedAccounts.find(g => g.id === selectedAccount.id);
            await banky.deleteTransaction(selectedAccount.id, tx.id, tx.date, shared?.id, shared?.sharedKey);
            await sync();
            loadTransactions(selectedAccount);
        });
    };

    const handleCreateGoal = async () => {
        if (!banky || !selectedAccount) return;
        showPrompt('Enter Goal Name:', async (name) => {
            if (name) {
                showPrompt('Enter Target Amount:', async (amount) => {
                    const target = parseFloat(amount);
                    if (!isNaN(target)) {
                        await banky.createGoal(selectedAccount.id, name, target);
                        await sync();
                        loadTransactions(selectedAccount);
                    }
                });
            }
        });
    };

    const handleGoalTransfer = async (goal: Goal, isContribute: boolean) => {
        if (!banky || !selectedAccount) return;
        const type = isContribute ? 'Contribute to' : 'Withdraw from';
        showPrompt(`Enter amount to ${type.toLowerCase()} ${goal.name}:`, async (amt) => {
            const amount = parseFloat(amt);
            if (isNaN(amount) || amount <= 0) return;

            const finalAmount = isContribute ? amount : -amount;
            const description = isContribute ? `Saved for ${goal.name}` : `Withdrew from ${goal.name}`;
            
            // Adjust goal amount
            await banky.updateGoalAmount(goal.id, finalAmount);
            
            // Create transaction in account (deduct balance if saving, add if withdrawing)
            const shared = sharedAccounts.find(g => g.id === selectedAccount.id);
            await banky.addTransaction(selectedAccount.id, description, -finalAmount, 'goals', undefined, shared?.id, shared?.sharedKey);
            
            await sync();
            loadTransactions(selectedAccount);
        });
    };

    const handleSetAllowance = () => {
        if (!banky || !selectedAccount) return;
        // Basic prompt based allowance
        showPrompt('Enter weekly allowance amount (or 0 to disable):', async (amt) => {
            const amount = parseFloat(amt);
            if (!isNaN(amount)) {
                if (amount > 0) {
                    await banky.updateAccountAllowance(selectedAccount.id, true, amount, 'weekly', Date.now() + 7 * 24 * 60 * 60 * 1000);
                    showAlert('Weekly allowance enabled.');
                } else {
                    await banky.updateAccountAllowance(selectedAccount.id, false, 0, 'weekly', 0);
                    showAlert('Allowance disabled.');
                }
                await sync();
                loadData(sov!, banky);
            }
        });
    };

    const handleShareAccount = async (acc: BankAccount) => {
        if (!sov || !banky) return;
        
        // Only allow sharing with users who have a public key locally
        const options = following
            .filter(f => f.publicKey && f.publicKey.length === 64)
            .map(f => ({ value: f.userId, label: f.userId }));

        if (options.length === 0) {
            showAlert('Follow someone with a valid public key (Try Syncing first) to share accounts.');
            return;
        }

        showMultiSelect(`Share ${acc.name} with:`, options, async (userIds) => {
            const members: any[] = [
                { userId: config.paths.userId, publicKey: sov.getConfig().publicEncryptionKey!, role: 'owner', status: 'joined' }
            ];
            
            userIds.forEach(uid => {
                const f = following.find(u => u.userId === uid);
                if (f) members.push({ userId: f.userId, publicKey: f.publicKey, role: 'admin', status: 'pending' });
            });

            // Create a "Group" for this account
            const group = await sov.createGroup(`Shared Account: ${acc.name}`, members);
            
            // Link local account to group
            await banky.linkAccountToGroup(acc.id, group.id);

            // Publish existing transactions to the group space
            await banky.publishTransactionsToGroup(acc.id, group.id, group.sharedKey);

            // Invite others via E2EE DM
            for (const uid of userIds) {
                const inviteMsg = `INVITE_GROUP:${JSON.stringify(group)}`;
                // Use the core library's internal message sender if available, 
                // or just write a generic encrypted DM.
                // In this demo, we'll reuse the Social module's logic via a generic DM write.
                // But since we don't have Social module here, we use the core SovereignS3nc.
                
                // Let's implement a simple E2EE DM for Banky too
                const recipient = following.find(f => f.userId === uid);
                if (recipient) {
                    const sharedSecret = sov.deriveSharedSecret(recipient.publicKey);
                    const message = { 
                        id: Math.random().toString(36).substring(7), 
                        content: inviteMsg, 
                        timestamp: Date.now(), 
                        senderId: config.paths.userId, 
                        recipientId: uid 
                    };
                    const encrypted = await sov.encrypt(new TextEncoder().encode(JSON.stringify(message)), sharedSecret);
                    
                    // Direct DM transport path
                    const dateStr = new Date().toISOString().split('T')[0];
                    const dmPath = `public/modules/social/dms/${uid}/${dateStr}.db`;
                    
                    const existingData = await sov.getStorage().getFile(dmPath);
                    const SQL = await (globalThis as any).initSqlJs(window.SQL_CONFIG);
                    const db = new SQL.Database(existingData || undefined);
                    db.exec(`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, encrypted_data BLOB);`);
                    db.run('INSERT OR REPLACE INTO messages (id, encrypted_data) VALUES (?, ?)', [message.id, encrypted]);
                    await sov.getStorage().saveFile(dmPath, db.export());
                    db.close();
                }
            }
            await sync();
            showAlert(`Created shared account and sent ${userIds.length} invites.`);
        });
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!banky) return;
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const data = JSON.parse(ev.target?.result as string);
                await banky.importFromBanky(data);
                await sync();
                showAlert('Import successful!');
            } catch (e) {
                showAlert('Import failed: Invalid JSON');
            }
        };
        reader.readAsText(file);
    };

    const handleImportTransactions = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!banky || !selectedAccount) return;
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const data = JSON.parse(ev.target?.result as string);
                // Format: [{ description, amount, date }]
                const shared = sharedAccounts.find(g => g.id === selectedAccount.id);
                for (const tx of data) {
                    await banky.addTransaction(selectedAccount.id, tx.description, tx.amount, tx.category || 'other', tx.date, shared?.id, shared?.sharedKey);
                }
                await sync();
                loadTransactions(selectedAccount);
                showAlert('Transactions imported!');
            } catch (e) {
                showAlert('Import failed');
            }
        };
        reader.readAsText(file);
    };

    const handleExportData = () => {
        const data = {
            userId: config.paths.userId,
            exportDate: new Date().toISOString(),
            transactions: transactions
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `banky-export-${selectedAccount?.name || 'account'}.json`;
        a.click();
    };

    const handleUpdateProfile = () => {
        showPrompt('Enter your display name:', async (name) => {
            if (name && sov) {
                const profileModule = new ProfileModule(sov);
                await profileModule.updateProfile(name, profile.bio || '');
                setProfile({ ...profile, name });
                await sync();
                showAlert('Profile updated!');
            }
        }, profile.name);
    };

    // UI Helpers
    const showAlert = (message: string) => setDialog({ type: 'alert', message, onConfirm: () => setDialog(null) });
    const showConfirm = (message: string, onConfirm: () => void) => setDialog({ type: 'confirm', message, onConfirm: () => { setDialog(null); onConfirm(); } });
    const showPrompt = (message: string, onConfirm: (val: string) => void, defaultValue: string = '') => setDialog({ type: 'prompt', message, defaultValue, onConfirm: (val: string) => { setDialog(null); onConfirm(val); } });
    const showMultiSelect = (message: string, options: any[], onConfirm: (vals: string[]) => void) => setDialog({ type: 'multiselect', message, options, onConfirm: (vals: string[]) => { setDialog(null); onConfirm(vals); } });

    if (!isLoggedIn) {
        return (
            <div className="container mt-5">
                <div className="row justify-content-center">
                    <div className="col-md-4">
                        <div className="card p-4 shadow-sm border-0">
                            <h2 className="text-center mb-4 fw-bold text-primary">Banky-Sov</h2>
                            <form onSubmit={handleLogin}>
                                <div className="mb-3">
                                    <label className="form-label">User ID</label>
                                    <input className="form-control rounded-pill" value={config.paths.userId} onChange={e => setConfig({...config, paths: { ...config.paths, userId: e.target.value }})} placeholder="e.g. kids-parent" required />
                                </div>
                                <div className="mb-3">
                                    <label className="form-label">Password</label>
                                    <input className="form-control rounded-pill" type="password" value={config.password} onChange={e => setConfig({...config, password: e.target.value})} placeholder="Master Password" required />
                                </div>
                                <button type="submit" className="btn btn-primary w-100 rounded-pill mb-3">Login / Register</button>
                                <button type="button" className="btn btn-link text-muted w-100 x-small" onClick={handleClearCache}>Clear Local Data</button>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div>
            <nav className="navbar navbar-expand-lg sticky-top mb-4 shadow-sm">
                <div className="container">
                    <div className="d-flex align-items-center">
                        <span className="small text-muted me-3" style={{ opacity: 0.6 }}>[{config.paths.userId}]</span>
                        <span className="navbar-brand fw-bold text-primary mb-0"><i className="bi bi-bank me-2"></i>Banky-Sov</span>
                    </div>
                    <div className="d-flex">
                        <button className={`btn mx-1 ${currentTab === 'accounts' ? 'btn-primary' : 'btn-light'}`} onClick={() => setCurrentTab('accounts')}>Accounts</button>
                        <button className={`btn mx-1 ${currentTab === 'sharing' ? 'btn-primary' : 'btn-light'}`} onClick={() => setCurrentTab('sharing')}>Friends</button>
                        <button className="btn btn-outline-secondary ms-2 rounded-pill" onClick={sync} disabled={syncing}>
                            {syncing ? 'Syncing...' : <><i className="bi bi-arrow-repeat me-1"></i> Sync</>}
                        </button>
                        <div className="dropdown ms-2">
                            <button className="btn btn-light rounded-circle shadow-sm" data-bs-toggle="dropdown"><i className="bi bi-list"></i></button>
                            <ul className="dropdown-menu dropdown-menu-end shadow border-0 mt-2 rounded-4 p-2" style={{minWidth: '250px'}}>
                                <li className="px-3 py-2 border-bottom mb-2">
                                    <div className="fw-bold">{profile.name || 'User'}</div>
                                    <div className="x-small text-muted">@{config.paths.userId}</div>
                                </li>
                                <li><button className="dropdown-item rounded-3" onClick={handleUpdateProfile}><i className="bi bi-person-gear me-2"></i> Edit Profile</button></li>
                                <li><hr className="dropdown-divider" /></li>
                                <li className="dropdown-header x-small text-uppercase fw-bold">Legacy Data</li>
                                <li>
                                    <label className="dropdown-item rounded-3 cursor-pointer">
                                        <i className="bi bi-file-earmark-arrow-up me-2"></i> Import Legacy JSON
                                        <input type="file" className="d-none" accept=".json" onChange={handleImport} />
                                    </label>
                                </li>
                                <li><hr className="dropdown-divider" /></li>
                                <li className="dropdown-header x-small text-uppercase fw-bold">Transactions</li>
                                <li><button className="dropdown-item rounded-3" onClick={handleExportData} disabled={!selectedAccount}><i className="bi bi-file-earmark-arrow-down me-2"></i> Export Account JSON</button></li>
                                <li>
                                    <label className={`dropdown-item rounded-3 cursor-pointer ${!selectedAccount ? 'disabled' : ''}`}>
                                        <i className="bi bi-file-earmark-arrow-up me-2"></i> Import Account JSON
                                        <input type="file" className="d-none" accept=".json" onChange={handleImportTransactions} disabled={!selectedAccount} />
                                    </label>
                                </li>
                                <li><hr className="dropdown-divider" /></li>
                                <li><button className="dropdown-item rounded-3 text-warning" onClick={handleClearCache}><i className="bi bi-trash3 me-2"></i> Clear Local Cache</button></li>
                                <li><button className="dropdown-item rounded-3 text-danger" onClick={handleLogout}><i className="bi bi-box-arrow-right me-2"></i> Logout</button></li>
                            </ul>
                        </div>
                    </div>
                </div>
            </nav>

            <div className="container">
                {currentTab === 'accounts' && (
                    <div className="row">
                        <div className="col-md-4">
                            <div className="d-flex justify-content-between align-items-center mb-3">
                                <h4 className="mb-0 fw-bold">My Accounts</h4>
                                <button className="btn btn-sm btn-primary rounded-pill" onClick={handleCreateAccount}>+ New</button>
                            </div>
                            <div className="list-group">
                                {accounts.map(acc => (
                                    <button key={acc.id} className={`list-group-item list-group-item-action border-0 mb-2 card ${selectedAccount?.id === acc.id ? 'bg-primary text-white' : ''}`} onClick={() => loadTransactions(acc)}>
                                        <div className="d-flex align-items-center p-2">
                                            {acc.image ? (
                                                <img src={acc.image} className="account-img me-3 border border-white" style={{width: '50px', height: '50px'}} />
                                            ) : (
                                                <div className="bg-light rounded-circle p-3 me-3 text-primary">
                                                    <i className="bi bi-wallet2 fs-4"></i>
                                                </div>
                                            )}
                                            <div className="flex-grow-1">
                                                <div className="fw-bold">{acc.name}</div>
                                                <div className="x-small opacity-75">{acc.id}</div>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                                {sharedAccounts.map(group => (
                                    <button key={group.id} className={`list-group-item list-group-item-action border-0 mb-2 card ${selectedAccount?.id === group.id ? 'bg-info text-white' : ''}`} onClick={() => loadTransactions({ id: group.id, name: group.name, currency: 'USD', createdAt: group.createdAt, ownerId: 'shared' })}>
                                        <div className="d-flex align-items-center p-2">
                                            {group.image ? (
                                                <img src={group.image} className="account-img me-3 border border-white" style={{width: '50px', height: '50px'}} />
                                            ) : (
                                                <div className="bg-light rounded-circle p-3 me-3 text-info">
                                                    <i className="bi bi-people fs-4"></i>
                                                </div>
                                            )}
                                            <div className="flex-grow-1">
                                                <div className="fw-bold">{group.name}</div>
                                                <div className="x-small opacity-75">Shared Account</div>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="col-md-8">
                            {selectedAccount ? (
                                <div className="card border-0 p-4 mb-4">
                                    <div className="d-flex justify-content-between align-items-center mb-4">
                                        <div>
                                            <h3 className="fw-bold mb-0">{selectedAccount.name}</h3>
                                            <div className="text-muted">Balance: {selectedAccount.currency} {transactions.reduce((sum, tx) => sum + tx.amount, 0).toFixed(2)}</div>
                                            {(selectedAccount as any).allowanceActive && (
                                                <div className="badge bg-light text-primary border border-primary mt-1">
                                                    Allowance: {(selectedAccount as any).allowanceAmount} / {(selectedAccount as any).allowanceInterval}
                                                </div>
                                            )}
                                        </div>
                                        <div className="d-flex gap-2 flex-wrap justify-content-end">
                                            <button className="btn btn-success rounded-pill px-3" onClick={() => handleAddTransaction(true)}>Deposit</button>
                                            <button className="btn btn-danger rounded-pill px-3" onClick={() => handleAddTransaction(false)}>Spend</button>
                                            <div className="dropdown">
                                                <button className="btn btn-outline-secondary rounded-circle" data-bs-toggle="dropdown"><i className="bi bi-three-dots-vertical"></i></button>
                                                <ul className="dropdown-menu dropdown-menu-end shadow-sm">
                                                    <li><button className="dropdown-item" onClick={() => handleShareAccount(selectedAccount)}><i className="bi bi-share me-2"></i> Share Account</button></li>
                                                    <li><button className="dropdown-item" onClick={handleSetAllowance}><i className="bi bi-cash-coin me-2"></i> Set Allowance</button></li>
                                                    <li><hr className="dropdown-divider" /></li>
                                                    <li><button className="dropdown-item" onClick={() => handleRenameAccount(selectedAccount)}><i className="bi bi-pencil me-2"></i> Rename Account</button></li>
                                                    <li><button className="dropdown-item" onClick={() => accountFileRef.current?.click()}><i className="bi bi-image me-2"></i> Set Account Image</button></li>
                                                    {selectedAccount.image && (
                                                        <li><button className="dropdown-item text-warning" onClick={handleRemoveAccountImage}><i className="bi bi-image-fill me-2"></i> Remove Image</button></li>
                                                    )}
                                                    <li><hr className="dropdown-divider" /></li>
                                                    <li><button className="dropdown-item text-danger" onClick={() => handleDeleteAccount(selectedAccount)}><i className="bi bi-trash me-2"></i> Delete Account</button></li>
                                                </ul>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* Chart */}
                                    {transactions.length > 0 && (
                                        <div className="mb-4" style={{ height: '200px' }}>
                                            <canvas ref={chartRef}></canvas>
                                        </div>
                                    )}

                                    {/* Goals */}
                                    <div className="d-flex justify-content-between align-items-center mb-3">
                                        <h5 className="fw-bold mb-0">Goals</h5>
                                        <button className="btn btn-sm btn-outline-primary rounded-pill" onClick={handleCreateGoal}>+ New Goal</button>
                                    </div>
                                    <div className="row mb-4">
                                        {goals.map(goal => {
                                            const progress = Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100));
                                            return (
                                                <div key={goal.id} className="col-md-6 mb-3">
                                                    <div className="card bg-light border-0 p-3 h-100">
                                                        <div className="d-flex justify-content-between align-items-center mb-2">
                                                            <div className="fw-bold">{goal.name}</div>
                                                            <div className="dropdown">
                                                                <button className="btn btn-link btn-sm text-muted p-0" data-bs-toggle="dropdown"><i className="bi bi-three-dots-vertical"></i></button>
                                                                <ul className="dropdown-menu dropdown-menu-end shadow-sm">
                                                                    <li><button className="dropdown-item text-danger" onClick={async () => {
                                                                        await banky?.deleteGoal(goal.id);
                                                                        loadTransactions(selectedAccount);
                                                                    }}>Delete Goal</button></li>
                                                                </ul>
                                                            </div>
                                                        </div>
                                                        <div className="progress mb-2" style={{ height: '10px' }}>
                                                            <div className="progress-bar bg-success" style={{ width: `${progress}%` }}></div>
                                                        </div>
                                                        <div className="d-flex justify-content-between align-items-center">
                                                            <div className="small text-muted">{selectedAccount.currency} {goal.currentAmount} / {goal.targetAmount}</div>
                                                            <div className="btn-group btn-group-sm">
                                                                <button className="btn btn-outline-success" onClick={() => handleGoalTransfer(goal, true)}>+</button>
                                                                <button className="btn btn-outline-danger" onClick={() => handleGoalTransfer(goal, false)} disabled={goal.currentAmount <= 0}>-</button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <hr />
                                    <h5 className="fw-bold mb-3">Recent Transactions</h5>
                                    <div className="list-group list-group-flush">
                                        {transactions.map(tx => (
                                            <div key={tx.id} className={`list-group-item d-flex justify-content-between align-items-center px-0 py-3 transaction-item ${tx.amount >= 0 ? 'tx-credit' : 'tx-debit'}`}>
                                                <div className="ps-3 flex-grow-1">
                                                    <div className="fw-bold">{tx.description} {tx.category === 'goals' && <span className="badge bg-light text-secondary border ms-2">Goal</span>}</div>
                                                    <div className="x-small text-muted">{tx.date} • by {tx.userId}</div>
                                                </div>
                                                <div className="d-flex align-items-center">
                                                    <div className={`fw-bold fs-5 me-3 ${tx.amount >= 0 ? 'text-success' : 'text-danger'}`}>
                                                        {tx.amount >= 0 ? '+' : ''}{tx.amount.toFixed(2)}
                                                    </div>
                                                    <button className="btn btn-link text-danger p-0" onClick={() => handleDeleteTransaction(tx)}><i className="bi bi-trash"></i></button>
                                                </div>
                                            </div>
                                        ))}
                                        {transactions.length === 0 && <div className="text-center py-5 text-muted">No transactions yet.</div>}
                                    </div>
                                </div>
                            ) : (
                                <div className="d-flex flex-column align-items-center justify-content-center h-100 text-muted opacity-50 py-5">
                                    <i className="bi bi-bank fs-1 mb-3"></i>
                                    <h4>Select an account to view details</h4>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {currentTab === 'sharing' && (
                    <div className="row justify-content-center">
                        <div className="col-md-6">
                            <div className="card p-4 border-0 mb-4 shadow-sm">
                                <div className="d-flex justify-content-between align-items-center mb-4">
                                    <h4 className="mb-0 fw-bold">Friends & Sharing</h4>
                                    <button className="btn btn-primary rounded-pill btn-sm" onClick={() => {
                                        showPrompt('Enter User ID to follow:', async (uid) => {
                                            if (uid) {
                                                await sov?.follow(uid);
                                                await sync();
                                            }
                                        });
                                    }}>+ Follow User</button>
                                </div>
                                <div className="list-group list-group-flush">
                                    {following.map(f => (
                                        <div key={f.userId} className="list-group-item d-flex justify-content-between align-items-center px-0 py-3">
                                            <div className="d-flex align-items-center">
                                                <div className="bg-light rounded-circle p-2 me-3">
                                                    <i className="bi bi-person fs-4"></i>
                                                </div>
                                                <div>
                                                    <div className="fw-bold">{f.userId}</div>
                                                    <div className="x-small text-muted">Last sync: {f.lastSync}</div>
                                                </div>
                                            </div>
                                            <button className="btn btn-sm btn-outline-danger rounded-pill" onClick={async () => {
                                                await sov?.unfollow(f.userId);
                                                await sync();
                                            }}>Unfollow</button>
                                        </div>
                                    ))}
                                    {following.length === 0 && <div className="text-center py-4 text-muted">You are not following anyone yet.</div>}
                                </div>
                            </div>

                            <div className="card p-4 border-0 shadow-sm">
                                <h5 className="fw-bold mb-3">Discover Friends</h5>
                                <div className="list-group list-group-flush">
                                    {registry
                                        .filter(u => u.userId !== config.paths.userId && !following.find(f => f.userId === u.userId))
                                        .map(u => (
                                            <div key={u.userId} className="list-group-item d-flex justify-content-between align-items-center px-0 py-3">
                                                <div className="d-flex align-items-center">
                                                    <div className="bg-light rounded-circle p-2 me-3 text-secondary">
                                                        <i className="bi bi-search fs-4"></i>
                                                    </div>
                                                    <div>
                                                        <div className="fw-bold">{u.userId}</div>
                                                        <div className="x-small text-muted">Global Registry</div>
                                                    </div>
                                                </div>
                                                <button className="btn btn-sm btn-outline-primary rounded-pill" onClick={async () => {
                                                    await sov?.follow(u.userId);
                                                    await sync();
                                                }}>Follow</button>
                                            </div>
                                        ))
                                    }
                                    {registry.filter(u => u.userId !== config.paths.userId && !following.find(f => f.userId === u.userId)).length === 0 && (
                                        <div className="text-center py-4 text-muted">No new users discovered.</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Hidden file input for account images */}
            <input type="file" ref={accountFileRef} className="d-none" accept="image/*" onChange={handleAccountImageChange} />
            
            {/* Dialog Component adapted from social demo */}
            <Dialog dialog={dialog} setDialog={setDialog} />
        </div>
    );
};

const Dialog = ({ dialog, setDialog }: any) => {
    const [inputValue, setInputValue] = useState('');
    const [selectedValues, setSelectedValues] = useState<string[]>([]);
    
    useEffect(() => {
        setInputValue('');
        setSelectedValues([]);
    }, [dialog]);

    if (!dialog) return null;

    const toggleOption = (val: string) => {
        setSelectedValues(prev => 
            prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
        );
    };

    return (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 2000 }}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content shadow-lg border-0 rounded-4">
                    <div className="modal-header border-0 pb-0">
                        <h5 className="modal-title fw-bold text-primary">{dialog.type.toUpperCase()}</h5>
                        <button type="button" className="btn-close" onClick={() => setDialog(null)}></button>
                    </div>
                    <div className="modal-body py-4">
                        <p className="mb-3 text-secondary">{dialog.message}</p>
                        {dialog.type === 'prompt' && (
                            <input autoFocus className="form-control rounded-pill px-3 shadow-sm" value={inputValue} onChange={e => setInputValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && dialog.onConfirm(inputValue)} />
                        )}
                        {dialog.type === 'multiselect' && dialog.options && (
                            <div className="list-group">
                                {dialog.options.map((opt: any) => (
                                    <label key={opt.value} className="list-group-item d-flex align-items-center border-0 py-2">
                                        <input type="checkbox" className="form-check-input me-3" checked={selectedValues.includes(opt.value)} onChange={() => toggleOption(opt.value)} />
                                        <span>{opt.label}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="modal-footer border-0 pt-0">
                        <button type="button" className="btn btn-light rounded-pill px-4" onClick={() => setDialog(null)}>Cancel</button>
                        <button type="button" className="btn btn-primary rounded-pill px-4 shadow-sm" onClick={() => dialog.onConfirm(dialog.type === 'multiselect' ? selectedValues : inputValue)}>OK</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
