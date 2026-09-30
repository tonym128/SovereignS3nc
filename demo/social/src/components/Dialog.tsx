import React, { useState, useEffect } from 'react';

export interface DialogProps {
    dialog: {
        title: string;
        message: string;
        type: 'alert' | 'confirm' | 'prompt' | 'multiselect' | 'config';
        defaultValue?: string;
        options?: { value: string; label: string }[];
        onConfirm: (value?: any) => void;
        onCancel: () => void;
    } | null;
    setDialog: (dialog: any) => void;
    profileCache: Record<string, any>;
}

export const Dialog: React.FC<DialogProps> = ({ dialog, setDialog, profileCache }) => {
    const [inputValue, setInputValue] = useState(dialog?.defaultValue || '');
    const [selectedValues, setSelectedValues] = useState<string[]>([]);
    const [searchQuery, setSearchSearchQuery] = useState('');
    const [configData, setConfigData] = useState({
        syncMode: 's3',
        region: 'us-east-1',
        endpoint: '',
        accessKeyId: '',
        secretAccessKey: '',
        bucketName: ''
    });

    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setDialog(null);
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [setDialog]);

    useEffect(() => {
        setInputValue(dialog?.defaultValue || '');
        setSelectedValues([]);
        setSearchSearchQuery('');
    }, [dialog]);

    if (!dialog) return null;

    const toggleOption = (val: string) => {
        setSelectedValues(prev =>
            prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
        );
    };

    const filteredOptions = dialog.options?.filter((opt: any) =>
        opt.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        opt.value.toLowerCase().includes(searchQuery.toLowerCase())
    ) || [];

    return (
        <div className="modal show d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="dialogTitle" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 2000 }}>
            <div className="modal-dialog modal-dialog-centered" role="document">
                <div className="modal-content shadow-lg border-0 rounded-4">
                    <div className="modal-header border-0 pb-0">
                        <h5 id="dialogTitle" className="modal-title fw-bold text-primary">{dialog.title}</h5>
                        <button type="button" className="btn-close" aria-label="Close" onClick={dialog.onCancel}></button>
                    </div>
                    <div className="modal-body py-4">
                        <p className="mb-3 text-secondary">{dialog.message}</p>
                        {dialog.type === 'prompt' && (
                            <input
                                autoFocus
                                aria-label={dialog.title || 'Dialog Input'}
                                className="form-control rounded-pill px-3 shadow-sm"
                                value={inputValue}
                                onChange={e => setInputValue(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && dialog.onConfirm(inputValue)}
                            />
                        )}
                        {dialog.type === 'config' && (
                            <div className="config-form">
                                <label className="form-label small fw-bold">Sync Mode</label>
                                <select className="form-select mb-3 rounded-pill" aria-label="Sync Mode" value={configData.syncMode} onChange={e => setConfigData({ ...configData, syncMode: e.target.value })}>
                                    <option value="s3">S3 Cloud</option>
                                    <option value="webrtc">WebRTC Mesh</option>
                                </select>

                                {configData.syncMode === 's3' && (
                                    <>
                                        <input className="form-control mb-2 rounded-pill" placeholder="Region" aria-label="Region" value={configData.region} onChange={e => setConfigData({ ...configData, region: e.target.value })} />
                                        <input className="form-control mb-2 rounded-pill" placeholder="Endpoint (optional)" aria-label="Endpoint" value={configData.endpoint} onChange={e => setConfigData({ ...configData, endpoint: e.target.value })} />
                                        <input className="form-control mb-2 rounded-pill" placeholder="Access Key" aria-label="Access Key" value={configData.accessKeyId} onChange={e => setConfigData({ ...configData, accessKeyId: e.target.value })} />
                                        <input className="form-control mb-2 rounded-pill" type="password" placeholder="Secret Key" aria-label="Secret Key" value={configData.secretAccessKey} onChange={e => setConfigData({ ...configData, secretAccessKey: e.target.value })} />
                                        <input className="form-control mb-2 rounded-pill" placeholder="Bucket Name" aria-label="Bucket Name" value={configData.bucketName} onChange={e => setConfigData({ ...configData, bucketName: e.target.value })} />
                                    </>
                                )}
                            </div>
                        )}
                        {dialog.type === 'multiselect' && (
                            <>
                                <div className="mb-3">
                                    <input
                                        type="text"
                                        className="form-control form-control-sm rounded-pill px-3"
                                        placeholder="Search members..."
                                        aria-label="Search members"
                                        value={searchQuery}
                                        onChange={e => setSearchSearchQuery(e.target.value)}
                                    />
                                </div>
                                <div className="list-group overflow-y-auto" style={{ maxHeight: '300px' }}>
                                    {filteredOptions.length > 0 ? (
                                        filteredOptions.map((opt: any) => {
                                            const userProfile = profileCache[opt.value];
                                            return (
                                                <label key={opt.value} className="list-group-item d-flex align-items-center border-0 py-2 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        className="form-check-input me-3"
                                                        checked={selectedValues.includes(opt.value)}
                                                        onChange={() => toggleOption(opt.value)}
                                                    />
                                                    <div className="d-flex align-items-center flex-grow-1">
                                                        {userProfile?.avatar ? (
                                                            <img src={userProfile.avatar} alt={`${userProfile?.name || opt.label} avatar`} className="rounded-circle me-2" style={{ width: '30px', height: '30px', objectFit: 'cover' }} />
                                                        ) : (
                                                            <div className="rounded-circle bg-secondary text-white me-2 d-flex align-items-center justify-content-center" style={{ width: '30px', height: '30px', fontSize: '0.8rem' }}>
                                                                {opt.value[0]?.toUpperCase() || '?'}
                                                            </div>
                                                        )}
                                                        <div>
                                                            <div className="fw-bold small">{userProfile?.name || opt.label}</div>
                                                            <div className="text-muted" style={{ fontSize: '0.7rem' }}>{opt.value}</div>
                                                        </div>
                                                    </div>
                                                </label>
                                            );
                                        })
                                    ) : (
                                        <div className="text-center py-3 text-muted small">No members found</div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                    <div className="modal-footer border-0 pt-0">
                        {dialog.type !== 'alert' && (
                            <button type="button" className="btn btn-light rounded-pill px-4" onClick={dialog.onCancel}>Cancel</button>
                        )}
                        <button
                            type="button"
                            className="btn btn-primary rounded-pill px-4 shadow-sm"
                            onClick={() => dialog.onConfirm(dialog.type === 'multiselect' ? selectedValues : (dialog.type === 'config' ? configData : inputValue))}
                        >
                            {dialog.type === 'alert' ? 'OK' : 'Confirm'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
