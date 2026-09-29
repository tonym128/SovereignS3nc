import React from 'react';
import { SovereignS3nc } from '../../../../src/SovereignS3nc';
import { ModerationModule, Report } from '../../../../src/modules/Moderation';
import { Post } from '../../../../src/modules/Feed';
import { UserName } from './MediaAndUser';

export interface AdminTabProps {
    isAdmin: boolean;
    adminKeyPublished: boolean;
    setAdminKeyPublished: (pub: boolean) => void;
    moderation: ModerationModule | null;
    sov: SovereignS3nc | null;
    sync: (manual?: boolean) => Promise<void>;
    loadData: (sovInstance: any) => Promise<void>;
    reports: Report[];
    setReports: React.Dispatch<React.SetStateAction<Report[]>>;
    setPreviewPost: (post: Post | null) => void;
    config: any;
    showAlert: (message: string, title?: string) => void;
    showPrompt: (message: string, onConfirm: (val?: any) => void) => void;
    showConfirm: (message: string, onConfirm: () => void, title?: string) => void;
}

export const AdminTab: React.FC<AdminTabProps> = ({
    isAdmin,
    adminKeyPublished,
    setAdminKeyPublished,
    moderation,
    sov,
    sync,
    loadData,
    reports,
    setReports,
    setPreviewPost,
    config,
    showAlert,
    showPrompt,
    showConfirm
}) => {
    if (!isAdmin) return null;

    return (
        <div className="col-md-10 mobile-full-width">
            <div className="card p-4 shadow-sm border-0 mb-4">
                <h4 className="mb-4 fw-bold text-danger"><i className="bi bi-shield-lock me-2"></i>Admin Dashboard</h4>

                <div className="alert alert-secondary py-3 mb-4 border-0">
                    <h6 className="fw-bold mb-1">Admin Status</h6>
                    {adminKeyPublished ? (
                        <div className="text-success small"><i className="bi bi-check-circle-fill me-1"></i> Reporting is ACTIVE. Your public key is published.</div>
                    ) : (
                        <div className="text-warning small"><i className="bi bi-exclamation-triangle-fill me-1"></i> Reporting is INACTIVE. You must publish your admin key for users to send reports.</div>
                    )}
                </div>

                <div className="row">
                    <div className="col-md-6 mb-4">
                        <div className="card h-100 border-0 bg-light">
                            <div className="card-body">
                                <h5 className="fw-bold mb-3">Governance</h5>
                                <button className="btn btn-outline-danger w-100 mb-2" onClick={async () => {
                                    const uid = await new Promise<string | undefined>(resolve => showPrompt('Enter User ID to blacklist:', resolve));
                                    if (uid && moderation) {
                                        try {
                                            await (moderation as any).blacklistUser(uid);
                                            await sync();
                                            showAlert(`User ${uid} has been blacklisted globally.`);
                                        } catch (e: any) {
                                            showAlert('Failed to blacklist: ' + e.message, 'Error');
                                        }
                                    }
                                }}>
                                    <i className="bi bi-person-x me-2"></i> Blacklist User
                                </button>
                                <button className="btn btn-outline-secondary w-100 mb-2" onClick={async () => {
                                    if (sov) {
                                        await sov.syncBlacklist();
                                        showAlert('Blacklist synchronized with cloud.');
                                    }
                                }}>
                                    <i className="bi bi-arrow-repeat me-2"></i> Sync Blacklist
                                </button>
                                <button className="btn btn-outline-primary w-100" onClick={async () => {
                                    if (moderation) {
                                        try {
                                            await moderation.publishAdminKey();
                                            setAdminKeyPublished(true);
                                            showAlert('Admin public key published successfully for E2EE reporting.');
                                        } catch (e: any) {
                                            showAlert('Failed to publish admin key: ' + e.message, 'Error');
                                        }
                                    }
                                }}>
                                    <i className="bi bi-key me-2"></i> Publish Admin Key
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="col-md-6 mb-4">
                        <div className="card h-100 border-0 bg-light">
                            <div className="card-body">
                                <h5 className="fw-bold mb-3">Provision User S3 Keys</h5>
                                <div className="small text-muted mb-3">Generate dedicated S3 credentials for a new user to ensure infrastructure isolation.</div>
                                <button className="btn btn-primary w-100 mb-2" onClick={async () => {
                                    showPrompt('Enter new User ID to provision:', (uid) => {
                                        if (uid) {
                                            showAlert(`To provision ${uid} in your S3 backend, ensure they have a key with read/write access to their prefixed paths and the global registry.`, 'Provisioning Instructions');
                                        }
                                    });
                                }}>
                                    <i className="bi bi-person-plus-fill me-2"></i> Create User Keys
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="row mb-4">
                    <div className="col-12">
                        <div className="card border-0 bg-light border-danger border-start border-4">
                            <div className="card-body">
                                <h5 className="fw-bold text-danger mb-3"><i className="bi bi-exclamation-triangle-fill me-2"></i>Data Management (Root Access)</h5>
                                <div className="d-flex gap-3 flex-wrap">
                                    <button className="btn btn-outline-primary" onClick={async () => {
                                        if (moderation) {
                                            try {
                                                const data = await moderation.exportAllData();
                                                const blob = new Blob([data], { type: 'application/json' });
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = url;
                                                a.download = `sovereign_export_${config.appId}_${new Date().toISOString().split('T')[0]}.json`;
                                                a.click();
                                                URL.revokeObjectURL(url);
                                                showAlert('Data exported successfully.');
                                            } catch (e: any) {
                                                showAlert('Export failed: ' + e.message, 'Error');
                                            }
                                        }
                                    }}>
                                        <i className="bi bi-download me-2"></i> Export All Data
                                    </button>
                                    <label className="btn btn-outline-secondary mb-0">
                                        <i className="bi bi-upload me-2"></i> Import Data
                                        <input type="file" className="d-none" accept=".json" onChange={async (e) => {
                                            const file = e.target.files?.[0];
                                            if (file && moderation) {
                                                const reader = new FileReader();
                                                reader.onload = async (ev) => {
                                                    try {
                                                        const content = ev.target?.result as string;
                                                        await moderation.importAllData(content);
                                                        showAlert('Data imported successfully.');
                                                        e.target.value = '';
                                                    } catch (err: any) {
                                                        showAlert('Import failed: ' + err.message, 'Error');
                                                    }
                                                };
                                                reader.readAsText(file);
                                            }
                                        }} />
                                    </label>
                                    <button className="btn btn-danger ms-auto" onClick={() => {
                                        showConfirm('WARNING: This will permanently delete ALL user data, posts, and DMs for this App ID across the entire S3 bucket. This action CANNOT be undone. Are you absolutely sure?', async () => {
                                            if (moderation) {
                                                try {
                                                    await moderation.burnItToTheGround();
                                                    showAlert('All data has been burned to the ground.', 'System Purged');
                                                } catch (e: any) {
                                                    showAlert('Purge failed: ' + e.message, 'Error');
                                                }
                                            }
                                        }, 'BURN IT TO THE GROUND');
                                    }}>
                                        <i className="bi bi-fire me-2"></i> BURN IT TO THE GROUND
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="d-flex align-items-center mt-2 mb-3">
                    <h5 className="fw-bold mb-0 flex-grow-1">Abuse Reports</h5>
                    <button className="btn btn-sm btn-outline-secondary" onClick={async () => {
                        if (moderation) {
                            const r = await moderation.getReports();
                            setReports(r);
                            showAlert(`Fetched ${r.length} reports.`);
                        }
                    }}>
                        <i className="bi bi-arrow-repeat me-1"></i> Refresh
                    </button>
                </div>
                <div className="table-responsive">
                    <table className="table table-hover align-middle">
                        <thead className="table-light">
                            <tr>
                                <th>Reporter</th>
                                <th>Target</th>
                                <th>Type</th>
                                <th>Reason</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {reports.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="text-center py-4 text-muted">No pending reports found in this session.</td>
                                </tr>
                            ) : (
                                reports.map(report => (
                                    <tr key={report.id}>
                                        <td><UserName userId={report.reporterId} /></td>
                                        <td><UserName userId={report.targetUserId} /></td>
                                        <td><span className="badge bg-info">{report.contentType}</span></td>
                                        <td className="small">{report.reason}</td>
                                        <td>
                                            <div className="d-flex gap-2">
                                                {report.evidence && (
                                                    <button title="View Content" className="btn btn-sm btn-outline-primary" onClick={() => setPreviewPost(report.evidence)}>
                                                        <i className="bi bi-eye"></i>
                                                    </button>
                                                )}
                                                <button title="Delete Post Only" className="btn btn-sm btn-outline-danger" onClick={async () => {
                                                    if (moderation && report.evidence && sov) {
                                                        try {
                                                            const today = SovereignS3nc.getDateStr(new Date(report.evidence.timestamp));
                                                            const path = `${report.targetUserId}/social/public/modules/feed/${today}.db`;
                                                            await moderation.deleteUserFile(path);
                                                            await moderation.deleteReport(report.id);

                                                            await sov.sync(true);
                                                            await loadData(sov);

                                                            showAlert('Post deleted and report closed.');
                                                        } catch (e: any) { showAlert(e.message); }
                                                    }
                                                }}>
                                                    <i className="bi bi-trash"></i>
                                                </button>
                                                <button title="Ban User" className="btn btn-sm btn-danger" onClick={async () => {
                                                    if (moderation && sov) {
                                                        try {
                                                            await moderation.banUser(report.targetUserId);
                                                            await moderation.deleteReport(report.id);

                                                            await sov.sync(true);
                                                            await loadData(sov);

                                                            showAlert('User banned and all data purged.');
                                                        } catch (e: any) { showAlert(e.message); }
                                                    }
                                                }}><i className="bi bi-person-x"></i> Ban</button>
                                                <button title="Ignore Report" className="btn btn-sm btn-light" onClick={async () => {
                                                    if (moderation) {
                                                        await moderation.deleteReport(report.id);
                                                        const r = await moderation.getReports();
                                                        setReports(r);
                                                    }
                                                }}><i className="bi bi-x-lg"></i></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="alert alert-info py-2 small mb-0">
                    <i className="bi bi-info-circle me-2"></i>
                    Reports are encrypted with the Admin Public Key and stored in <code>{config.appId}/admin/reports/</code>. A background worker or Lambda is typically used to decrypt and aggregate these.
                </div>
            </div>
        </div>
    );
};
