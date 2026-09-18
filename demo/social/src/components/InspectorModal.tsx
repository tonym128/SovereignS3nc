import React, { useState, useEffect, useCallback } from 'react';
import { SovereignS3nc } from '../../../../src/SovereignS3nc';
import { DebugSnapshot, StoragePartitionNode, SemanticConflictDiff } from '../../../../src/utils/Inspector';

interface InspectorModalProps {
    sov: SovereignS3nc;
    onClose: () => void;
}

export const InspectorModal: React.FC<InspectorModalProps> = ({ sov, onClose }) => {
    const [snapshot, setSnapshot] = useState<DebugSnapshot | null>(null);
    const [activeTab, setActiveTab] = useState<'storage' | 'sync' | 'mesh' | 'conflicts'>('storage');
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({ '': true, 'public': true, 'private': true });

    const loadSnapshot = useCallback(async () => {
        try {
            const snap = await sov.getDebugSnapshot();
            setSnapshot(snap);
        } catch (e) {
            console.error('Failed to load debug snapshot', e);
        }
    }, [sov]);

    useEffect(() => {
        loadSnapshot();
        if (!autoRefresh) return;
        const timer = setInterval(loadSnapshot, 2000);
        return () => clearInterval(timer);
    }, [loadSnapshot, autoRefresh]);

    const formatBytes = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const toggleFolder = (path: string) => {
        setExpandedFolders(prev => ({ ...prev, [path]: !prev[path] }));
    };

    const renderTreeNode = (node: StoragePartitionNode, depth: number = 0) => {
        const isDir = node.type === 'directory';
        const isExpanded = !!expandedFolders[node.path];

        return (
            <div key={node.path} style={{ marginLeft: `${depth * 16}px`, marginTop: '4px' }}>
                <div 
                    onClick={() => isDir && toggleFolder(node.path)}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: isDir ? 'pointer' : 'default',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        background: isDir ? 'rgba(255, 255, 255, 0.03)' : 'transparent',
                        fontSize: '13px'
                    }}
                >
                    <span style={{ width: '16px', textAlign: 'center' }}>
                        {isDir ? (isExpanded ? '📂' : '📁') : '📄'}
                    </span>
                    <span style={{ fontWeight: isDir ? 600 : 400, color: isDir ? '#90caf9' : '#e0e0e0' }}>
                        {node.name}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#9e9e9e' }}>
                        {formatBytes(node.size)}
                    </span>
                    {node.timestamp && (
                        <span style={{ fontSize: '10px', color: '#757575' }}>
                            {new Date(node.timestamp).toLocaleTimeString()}
                        </span>
                    )}
                </div>
                {isDir && isExpanded && node.children && (
                    <div style={{ borderLeft: '1px solid rgba(255, 255, 255, 0.1)', marginLeft: '8px' }}>
                        {node.children.map(child => renderTreeNode(child, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    const handleResolveConflict = (conflictId: string, choice: 'local' | 'remote' | 'abort') => {
        sov.resolveConflict(conflictId, choice);
        loadSnapshot();
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '20px'
        }}>
            <div style={{
                background: '#1e1e24',
                color: '#fff',
                width: '900px',
                maxWidth: '95vw',
                height: '85vh',
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                border: '1px solid #333'
            }}>
                {/* Header */}
                <div style={{
                    padding: '16px 20px',
                    borderBottom: '1px solid #333',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '20px' }}>🛠️</span>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Sovereign Storage Inspector</h3>
                            <span style={{ fontSize: '12px', color: '#888' }}>
                                App: {snapshot?.appId || '...'} | User: {snapshot?.userId || '...'}
                            </span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                            <input 
                                type="checkbox" 
                                checked={autoRefresh} 
                                onChange={e => setAutoRefresh(e.target.checked)} 
                            />
                            Live Update
                        </label>
                        <button 
                            onClick={loadSnapshot} 
                            style={{ padding: '6px 12px', background: '#333', border: 'none', color: '#fff', borderRadius: '6px', cursor: 'pointer' }}
                        >
                            🔄 Refresh
                        </button>
                        <button 
                            onClick={onClose} 
                            style={{ padding: '6px 12px', background: '#d32f2f', border: 'none', color: '#fff', borderRadius: '6px', cursor: 'pointer' }}
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid #333', background: '#25252d' }}>
                    {[
                        { id: 'storage', label: '📁 Storage & Footprint' },
                        { id: 'sync', label: '🔄 Remote Sync & ETags' },
                        { id: 'mesh', label: `🌐 WebRTC Mesh (${snapshot?.mesh.peerCount || 0})` },
                        { id: 'conflicts', label: `⚠️ Conflicts (${snapshot?.conflicts.length || 0})` }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            style={{
                                flex: 1,
                                padding: '12px',
                                background: activeTab === tab.id ? '#1e1e24' : 'transparent',
                                border: 'none',
                                borderBottom: activeTab === tab.id ? '2px solid #2196f3' : 'none',
                                color: activeTab === tab.id ? '#2196f3' : '#aaa',
                                fontWeight: activeTab === tab.id ? 600 : 400,
                                cursor: 'pointer',
                                fontSize: '13px'
                            }}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
                    {!snapshot ? (
                        <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>Loading snapshot...</div>
                    ) : (
                        <>
                            {activeTab === 'storage' && (
                                <div>
                                    {/* Footprint summary cards */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
                                        <div style={{ background: '#262630', padding: '12px', borderRadius: '8px' }}>
                                            <div style={{ fontSize: '11px', color: '#888' }}>TOTAL USAGE</div>
                                            <div style={{ fontSize: '18px', fontWeight: 600, marginTop: '4px' }}>
                                                {formatBytes(snapshot.storage.footprint.totalBytes)}
                                            </div>
                                            <div style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>
                                                {snapshot.storage.footprint.fileCount} files
                                            </div>
                                        </div>
                                        <div style={{ background: '#262630', padding: '12px', borderRadius: '8px' }}>
                                            <div style={{ fontSize: '11px', color: '#888' }}>PUBLIC PARTITIONS</div>
                                            <div style={{ fontSize: '18px', fontWeight: 600, marginTop: '4px', color: '#81c784' }}>
                                                {formatBytes(snapshot.storage.footprint.byCategory.public)}
                                            </div>
                                        </div>
                                        <div style={{ background: '#262630', padding: '12px', borderRadius: '8px' }}>
                                            <div style={{ fontSize: '11px', color: '#888' }}>PRIVATE PARTITIONS</div>
                                            <div style={{ fontSize: '18px', fontWeight: 600, marginTop: '4px', color: '#e57373' }}>
                                                {formatBytes(snapshot.storage.footprint.byCategory.private)}
                                            </div>
                                        </div>
                                        <div style={{ background: '#262630', padding: '12px', borderRadius: '8px' }}>
                                            <div style={{ fontSize: '11px', color: '#888' }}>MEDIA BLOBS</div>
                                            <div style={{ fontSize: '18px', fontWeight: 600, marginTop: '4px', color: '#ba68c8' }}>
                                                {formatBytes(snapshot.storage.footprint.byCategory.blobs)}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Storage Tree */}
                                    <h4 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Local Storage Partition Tree</h4>
                                    <div style={{ background: '#18181c', padding: '14px', borderRadius: '8px', border: '1px solid #2a2a30' }}>
                                        {snapshot.storage.tree.length === 0 ? (
                                            <div style={{ color: '#888', fontSize: '13px' }}>No local files found.</div>
                                        ) : (
                                            snapshot.storage.tree.map(node => renderTreeNode(node))
                                        )}
                                    </div>
                                </div>
                            )}

                            {activeTab === 'sync' && (
                                <div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
                                        <div style={{ background: '#262630', padding: '12px', borderRadius: '8px' }}>
                                            <div style={{ fontSize: '11px', color: '#888' }}>SYNC MODE</div>
                                            <div style={{ fontSize: '16px', fontWeight: 600, marginTop: '4px', textTransform: 'uppercase' }}>
                                                {snapshot.remoteSync.syncMode}
                                            </div>
                                        </div>
                                        <div style={{ background: '#262630', padding: '12px', borderRadius: '8px' }}>
                                            <div style={{ fontSize: '11px', color: '#888' }}>STATUS</div>
                                            <div style={{ fontSize: '16px', fontWeight: 600, marginTop: '4px', color: snapshot.remoteSync.isSyncing ? '#ffb74d' : '#81c784' }}>
                                                {snapshot.remoteSync.isSyncing ? '⏳ Syncing...' : ' Idle'}
                                            </div>
                                        </div>
                                        <div style={{ background: '#262630', padding: '12px', borderRadius: '8px' }}>
                                            <div style={{ fontSize: '11px', color: '#888' }}>LAST SYNC CHECK</div>
                                            <div style={{ fontSize: '16px', fontWeight: 600, marginTop: '4px' }}>
                                                {snapshot.remoteSync.lastSyncDate || 'Never'}
                                            </div>
                                        </div>
                                    </div>

                                    <h4 style={{ margin: '20px 0 10px 0', fontSize: '14px' }}>Cached Remote ETags & Hashes</h4>
                                    <div style={{ background: '#18181c', padding: '12px', borderRadius: '8px', border: '1px solid #2a2a30', maxHeight: '250px', overflowY: 'auto' }}>
                                        {Object.keys(snapshot.remoteSync.etagCache).length === 0 ? (
                                            <div style={{ color: '#888', fontSize: '13px' }}>No cached ETags recorded yet.</div>
                                        ) : (
                                            <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                                                <thead>
                                                    <tr style={{ color: '#888', borderBottom: '1px solid #333', textAlign: 'left' }}>
                                                        <th style={{ padding: '6px' }}>Path</th>
                                                        <th style={{ padding: '6px' }}>ETag / Hash</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {Object.entries(snapshot.remoteSync.etagCache).map(([path, etag]) => (
                                                        <tr key={path} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                                            <td style={{ padding: '6px', color: '#90caf9', fontFamily: 'monospace' }}>{path}</td>
                                                            <td style={{ padding: '6px', color: '#ffb74d', fontFamily: 'monospace' }}>{etag}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                </div>
                            )}

                            {activeTab === 'mesh' && (
                                <div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
                                        <div style={{ background: '#262630', padding: '12px', borderRadius: '8px' }}>
                                            <div style={{ fontSize: '11px', color: '#888' }}>PACKETS SENT</div>
                                            <div style={{ fontSize: '18px', fontWeight: 600, marginTop: '4px', color: '#81c784' }}>
                                                {snapshot.mesh.stats.packetsSent}
                                            </div>
                                        </div>
                                        <div style={{ background: '#262630', padding: '12px', borderRadius: '8px' }}>
                                            <div style={{ fontSize: '11px', color: '#888' }}>PACKETS RECV</div>
                                            <div style={{ fontSize: '18px', fontWeight: 600, marginTop: '4px', color: '#90caf9' }}>
                                                {snapshot.mesh.stats.packetsReceived}
                                            </div>
                                        </div>
                                        <div style={{ background: '#262630', padding: '12px', borderRadius: '8px' }}>
                                            <div style={{ fontSize: '11px', color: '#888' }}>PACKETS DROPPED</div>
                                            <div style={{ fontSize: '18px', fontWeight: 600, marginTop: '4px', color: '#e57373' }}>
                                                {snapshot.mesh.stats.packetsDropped}
                                            </div>
                                        </div>
                                        <div style={{ background: '#262630', padding: '12px', borderRadius: '8px' }}>
                                            <div style={{ fontSize: '11px', color: '#888' }}>DEDUP CACHE SIZE</div>
                                            <div style={{ fontSize: '18px', fontWeight: 600, marginTop: '4px' }}>
                                                {snapshot.mesh.stats.seenMessagesCount}
                                            </div>
                                        </div>
                                    </div>

                                    <h4 style={{ margin: '20px 0 10px 0', fontSize: '14px' }}>Active Mesh Peers ({snapshot.mesh.peerCount})</h4>
                                    <div style={{ background: '#18181c', padding: '12px', borderRadius: '8px', border: '1px solid #2a2a30' }}>
                                        {snapshot.mesh.peers.length === 0 ? (
                                            <div style={{ color: '#888', fontSize: '13px' }}>No active WebRTC peer connections.</div>
                                        ) : (
                                            <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                                                <thead>
                                                    <tr style={{ color: '#888', borderBottom: '1px solid #333', textAlign: 'left' }}>
                                                        <th style={{ padding: '8px' }}>Peer ID</th>
                                                        <th style={{ padding: '8px' }}>Status</th>
                                                        <th style={{ padding: '8px' }}>Latency</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {snapshot.mesh.peers.map(peer => (
                                                        <tr key={peer.peerId} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                                            <td style={{ padding: '8px', fontFamily: 'monospace' }}>{peer.peerId}</td>
                                                            <td style={{ padding: '8px', color: '#81c784' }}>Connected</td>
                                                            <td style={{ padding: '8px', color: '#ffb74d' }}>
                                                                {peer.latencyMs !== undefined ? `${peer.latencyMs} ms` : 'N/A'}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                </div>
                            )}

                            {activeTab === 'conflicts' && (
                                <div>
                                    <h4 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>
                                        Unresolved Conflict Queue ({snapshot.conflicts.length})
                                    </h4>
                                    {snapshot.conflicts.length === 0 ? (
                                        <div style={{ background: '#18181c', padding: '30px', borderRadius: '8px', textAlign: 'center', color: '#81c784' }}>
                                            No sync conflicts detected. Local and remote files are completely consistent.
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                            {snapshot.conflicts.map(conflict => (
                                                <div key={conflict.id} style={{ background: '#18181c', borderRadius: '8px', padding: '16px', border: '1px solid #e57373' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                                        <div>
                                                            <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#90caf9' }}>{conflict.path}</span>
                                                            <span style={{ marginLeft: '12px', fontSize: '12px', color: '#888' }}>
                                                                {new Date(conflict.timestamp).toLocaleTimeString()}
                                                            </span>
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '8px' }}>
                                                            <button 
                                                                onClick={() => handleResolveConflict(conflict.id, 'local')}
                                                                style={{ padding: '6px 12px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                                                            >
                                                                Keep Local
                                                            </button>
                                                            <button 
                                                                onClick={() => handleResolveConflict(conflict.id, 'remote')}
                                                                style={{ padding: '6px 12px', background: '#c62828', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                                                            >
                                                                Keep Remote
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '12px' }}>
                                                        <div style={{ background: '#202028', padding: '10px', borderRadius: '6px' }}>
                                                            <div style={{ fontWeight: 600, color: '#81c784', marginBottom: '6px' }}>
                                                                Local ({formatBytes(conflict.localSize)})
                                                            </div>
                                                            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#ddd' }}>
                                                                {conflict.preview.localTextSnippet}
                                                            </pre>
                                                        </div>
                                                        <div style={{ background: '#202028', padding: '10px', borderRadius: '6px' }}>
                                                            <div style={{ fontWeight: 600, color: '#e57373', marginBottom: '6px' }}>
                                                                Remote ({formatBytes(conflict.remoteSize)})
                                                            </div>
                                                            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#ddd' }}>
                                                                {conflict.preview.remoteTextSnippet}
                                                            </pre>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
