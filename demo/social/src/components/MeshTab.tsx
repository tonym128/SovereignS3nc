import React from 'react';

export interface MeshTabProps {
    meshStats: {
        connectedPeers: number;
        peerIds: string[];
    };
    config: any;
    meshLog: { time: number; msg: string }[];
}

export const MeshTab: React.FC<MeshTabProps> = ({ meshStats, config, meshLog }) => {
    return (
        <div className="col-md-8">
            <div className="card p-4 shadow-sm border-0 mb-4">
                <h4 className="fw-bold mb-4"><i className="bi bi-node-plus me-2 text-primary"></i>P2P Mesh Network</h4>

                <div className="row text-center mb-4">
                    <div className="col-6">
                        <div className="p-3 bg-light rounded shadow-sm">
                            <div className="display-4 fw-bold text-primary">{meshStats.connectedPeers}</div>
                            <div className="text-muted small text-uppercase">Connected Peers</div>
                        </div>
                    </div>
                    <div className="col-6">
                        <div className="p-3 bg-light rounded shadow-sm">
                            <div className="display-4 fw-bold text-success">{config.syncMode === 'webrtc' || config.syncMode === 'peerjs' ? 'ON' : 'OFF'}</div>
                            <div className="text-muted small text-uppercase">Mesh Status</div>
                        </div>
                    </div>
                </div>

                <h6 className="fw-bold mb-3">Gossip Activity Log</h6>
                <div className="bg-dark text-light p-3 rounded mb-4" style={{ height: '300px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                    {meshLog.length === 0 && <div className="text-muted italic">Waiting for mesh activity...</div>}
                    {meshLog.map((log, i) => (
                        <div key={i} className="mb-1 border-bottom border-secondary pb-1">
                            <span className="text-info">[{new Date(log.time).toLocaleTimeString()}]</span> {log.msg}
                        </div>
                    ))}
                </div>

                <h6 className="fw-bold mb-2">Connected Peer IDs</h6>
                <div className="d-flex flex-wrap gap-2">
                    {meshStats.peerIds.length === 0 && <div className="text-muted small">No active peer IDs discovered.</div>}
                    {meshStats.peerIds.map(id => (
                        <span key={id} className="badge bg-light text-dark border small">{id}</span>
                    ))}
                </div>

                <div className="mt-4 pt-4 border-top">
                    <h6>Persistence Engine</h6>
                    <p className="small text-muted">
                        Your browser is acting as a persistent node in the mesh.
                        Any data Alice or Bob requests that you have in local storage (IndexedDB) will be served automatically,
                        even if the original author is offline.
                    </p>
                </div>
            </div>
        </div>
    );
};
