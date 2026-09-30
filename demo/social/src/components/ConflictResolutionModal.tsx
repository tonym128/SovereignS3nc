import React, { useEffect } from 'react';

export interface ConflictResolutionModalProps {
    conflict: {
        id: string;
        path: string;
        localData: Uint8Array;
        remoteData: Uint8Array;
        resolve: (choice: 'local' | 'remote' | 'abort' | { mergedData: Uint8Array }) => void;
    } | null;
    onResolve: (choice: 'local' | 'remote' | 'abort' | { mergedData: Uint8Array }) => void;
}

export const ConflictResolutionModal: React.FC<ConflictResolutionModalProps> = ({ conflict, onResolve }) => {
    if (!conflict) return null;

    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onResolve('abort');
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onResolve]);

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const tryParse = (data: Uint8Array) => {
        try {
            return JSON.parse(new TextDecoder().decode(data));
        } catch (e) {
            return null;
        }
    };

    const localJson = tryParse(conflict.localData);
    const remoteJson = tryParse(conflict.remoteData);

    const handleMerge = () => {
        if (localJson && remoteJson) {
            // Merge objects: remote fields are kept, local fields overwrite
            const merged = { ...remoteJson, ...localJson };
            const mergedData = new TextEncoder().encode(JSON.stringify(merged));
            onResolve({ mergedData });
        }
    };

    const getPreview = (data: Uint8Array) => {
        try {
            const str = new TextDecoder().decode(data);
            return str.length > 500 ? str.substring(0, 500) + '...' : str;
        } catch (e) {
            return 'Binary Data';
        }
    };

    return (
        <div className="modal show d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="conflictModalTitle" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 3000 }}>
            <div className="modal-dialog modal-dialog-centered modal-lg" role="document">
                <div className="modal-content shadow-lg border-0 rounded-4">
                    <div className="modal-header border-0 pb-0">
                        <h5 id="conflictModalTitle" className="modal-title fw-bold text-danger"><i className="bi bi-exclamation-triangle-fill me-2"></i>Sync Conflict</h5>
                        <button type="button" className="btn-close" aria-label="Close" onClick={() => onResolve('abort')}></button>
                    </div>
                    <div className="modal-body py-4">
                        <p className="text-secondary">A conflict was detected during sync for the following file:</p>
                        <div className="alert alert-light border small mb-4">
                            <code>{conflict.path}</code>
                        </div>

                        {localJson && remoteJson && (
                            <div className="card border-info-subtle bg-info-subtle bg-opacity-10 mb-4 rounded-3">
                                <div className="card-body">
                                    <h6 className="fw-bold mb-2 text-info"><i className="bi bi-info-circle-fill me-2"></i>Semantic Comparison</h6>
                                    <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
                                        {Object.keys({ ...localJson, ...remoteJson }).map(key => {
                                            if (JSON.stringify(localJson[key]) !== JSON.stringify(remoteJson[key])) {
                                                return (
                                                    <div key={key} className="mb-2 x-small">
                                                        <div className="fw-bold text-dark">{key}:</div>
                                                        <div className="ps-2 border-start border-danger text-danger text-decoration-line-through">{JSON.stringify(remoteJson[key])}</div>
                                                        <div className="ps-2 border-start border-success text-success">{JSON.stringify(localJson[key])}</div>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="row g-3">
                            <div className="col-md-6">
                                <div className="card h-100 border-primary-subtle bg-primary-subtle bg-opacity-10">
                                    <div className="card-body">
                                        <h6 className="fw-bold text-primary mb-3">Local Version</h6>
                                        <div className="small mb-2"><strong>Size:</strong> {formatSize(conflict.localData.length)}</div>
                                        <div className="bg-white p-2 border rounded small" style={{ height: '120px', overflowY: 'auto' }}>
                                            <pre className="mb-0 text-dark" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                                {getPreview(conflict.localData)}
                                            </pre>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="col-md-6">
                                <div className="card h-100 border-success-subtle bg-success-subtle bg-opacity-10">
                                    <div className="card-body">
                                        <h6 className="fw-bold text-success mb-3">Remote Version</h6>
                                        <div className="small mb-2"><strong>Size:</strong> {formatSize(conflict.remoteData.length)}</div>
                                        <div className="bg-white p-2 border rounded small" style={{ height: '120px', overflowY: 'auto' }}>
                                            <pre className="mb-0 text-dark" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                                {getPreview(conflict.remoteData)}
                                            </pre>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="modal-footer border-0 pt-0 d-flex flex-wrap justify-content-center gap-2">
                        {localJson && remoteJson && (
                            <button type="button" className="btn btn-info text-white rounded-pill px-4 shadow-sm" onClick={handleMerge}>
                                <i className="bi bi-intersect me-2"></i>Smart Merge
                            </button>
                        )}
                        <button type="button" className="btn btn-primary rounded-pill px-4 shadow-sm" onClick={() => onResolve('local')}>Keep Local</button>
                        <button type="button" className="btn btn-success rounded-pill px-4 shadow-sm" onClick={() => onResolve('remote')}>Take Remote</button>
                        <button type="button" className="btn btn-outline-secondary rounded-pill px-4" onClick={() => onResolve('abort')}>Skip for Now</button>
                    </div>
                </div>
            </div>
        </div>
    );
};
