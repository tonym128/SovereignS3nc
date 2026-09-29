import React from 'react';
import { SovereignS3nc } from '../../../../src/SovereignS3nc';
import { ProfileModule } from '../../../../src/modules/Profile';
import { Post } from '../../../../src/modules/Feed';

export interface ProfileTabProps {
    profile: any;
    setProfile: React.Dispatch<React.SetStateAction<any>>;
    config: any;
    profileModule: ProfileModule | null;
    sync: (manual?: boolean) => Promise<void>;
    showAlert: (message: string, title?: string) => void;
    posts: Post[];
    sov: SovereignS3nc | null;
    allUsers: any[];
    exportAllPosts: boolean;
    setExportAllPosts: (val: boolean) => void;
    oldPassword: string;
    setOldPassword: (val: string) => void;
    newPassword: string;
    setNewPassword: (val: string) => void;
    handleChangePassword: () => Promise<void>;
    handleConnectRemote: () => void;
    logout: () => void;
}

export const ProfileTab: React.FC<ProfileTabProps> = ({
    profile,
    setProfile,
    config,
    profileModule,
    sync,
    showAlert,
    posts,
    sov,
    allUsers,
    exportAllPosts,
    setExportAllPosts,
    oldPassword,
    setOldPassword,
    newPassword,
    setNewPassword,
    handleChangePassword,
    handleConnectRemote,
    logout
}) => {
    return (
        <div className="col-md-6 mobile-full-width">
            <div className="card p-4 shadow-sm border-0">
                <h4 className="mb-4 fw-bold">Edit Profile</h4>

                <div className="text-center mb-4">
                    {profile?.avatar ? (
                        <img src={profile.avatar} style={{ width: '120px', height: '120px', borderRadius: '50%', objectFit: 'cover' }} className="mb-2 shadow-sm" />
                    ) : (
                        <div className="bg-secondary text-white rounded-circle mx-auto d-flex align-items-center justify-content-center mb-2 shadow-sm" style={{ width: '120px', height: '120px', fontSize: '3rem' }}>
                            {config.userId[0]?.toUpperCase() || '?'}
                        </div>
                    )}
                    <div>
                        <label className="btn btn-sm btn-outline-primary rounded-pill">
                            Change Avatar
                            <input type="file" className="d-none" accept="image/*" onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                    const reader = new FileReader();
                                    reader.onload = (ev) => {
                                        setProfile({ ...profile, avatar: ev.target?.result as string });
                                    };
                                    reader.readAsDataURL(file);
                                }
                            }} />
                        </label>
                    </div>
                </div>

                <div className="mb-3">
                    <label className="form-label small fw-bold text-muted text-uppercase">Display Name</label>
                    <input className="form-control" value={profile?.name || ''} onChange={e => setProfile({ ...profile, name: e.target.value })} placeholder="Your Name" />
                </div>
                <div className="mb-3">
                    <label className="form-label small fw-bold text-muted text-uppercase">User ID (Share this for P2P)</label>
                    <div className="input-group">
                        <input type="text" className="form-control bg-light" value={config.userId} readOnly />
                        <button className="btn btn-outline-secondary" onClick={() => {
                            navigator.clipboard.writeText(config.userId);
                            showAlert('User ID copied!', 'Clipboard');
                        }}>Copy</button>
                    </div>
                </div>
                <div className="mb-4">
                    <label className="form-label small fw-bold text-muted text-uppercase">Bio</label>
                    <textarea className="form-control" rows={3} value={profile?.bio || ''} onChange={e => setProfile({ ...profile, bio: e.target.value })} placeholder="Tell us about yourself..." />
                </div>
                <button className="btn btn-primary w-100 py-2 fw-bold" onClick={async () => {
                    await profileModule?.updateProfile(profile?.name || config.userId, profile?.bio || '', profile?.avatar);
                    await sync();
                    showAlert('Profile updated!', 'Success');
                }}>Save Changes</button>

                <hr className="my-4" />

                <h5 className="fw-bold mb-3">Portable Archive</h5>
                <div className="small text-muted mb-3">
                    Export your profile and social feed as a single, standalone HTML file.
                    All images will be embedded directly in the file so it can be viewed offline.
                </div>

                <div className="form-check mb-3">
                    <input className="form-check-input" type="checkbox" id="exportAllPosts" checked={exportAllPosts} onChange={e => setExportAllPosts(e.target.checked)} />
                    <label className="form-check-label small" htmlFor="exportAllPosts">
                        Include posts from everyone I follow (otherwise only my posts)
                    </label>
                </div>

                <button className="btn btn-outline-success w-100 py-2 fw-bold" onClick={async () => {
                    try {
                        showAlert('Generating static export... this may take a moment.', 'Exporting');

                        // 1. Gather Profile and Posts
                        const exportProfile = profile;
                        const exportPosts = [...posts]
                            .filter(p => exportAllPosts || p.userId === config.userId)
                            .sort((a, b) => b.timestamp - a.timestamp);

                        // 2. Helper to embed images as Base64
                        const embedImages = async (postList: any[]) => {
                            for (const post of postList) {
                                if (post.image && post.image.startsWith('public/blobs/')) {
                                    const blob = await sov?.getBlob(post.image, post.userId);
                                    if (blob) {
                                        const reader = new FileReader();
                                        const dataUrl = await new Promise<string>((resolve) => {
                                            reader.onload = (e) => resolve(e.target?.result as string);
                                            reader.readAsDataURL(new Blob([blob]));
                                        });
                                        post.image = dataUrl;
                                    }
                                }
                            }
                        };

                        await embedImages(exportPosts);

                        // 3. Generate HTML
                        const sanitize = (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

                        const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sovereign Archive - ${exportProfile?.name || config.userId}</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #f0f2f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        .archive-header { background: white; padding: 2rem 0; border-bottom: 1px solid #ddd; margin-bottom: 2rem; }
        .avatar-large { width: 120px; height: 120px; border-radius: 50%; object-fit: cover; border: 4px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .post-card { background: white; border-radius: 8px; border: none; box-shadow: 0 1px 2px rgba(0,0,0,0.1); margin-bottom: 1.5rem; }
        .post-img { max-height: 500px; width: 100%; object-fit: contain; background: #000; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="archive-header">
        <div class="container text-center">
            ${exportProfile?.avatar ? `<img src="${exportProfile.avatar}" class="avatar-large mb-3">` : `<div class="bg-secondary text-white rounded-circle mx-auto d-flex align-items-center justify-content-center mb-3" style="width: 120px; height: 120px; font-size: 3rem;">${config.userId[0]?.toUpperCase() || '?'}</div>`}
            <h1 class="fw-bold">${sanitize(exportProfile?.name || config.userId)}</h1>
            <p class="text-muted">${sanitize(exportProfile?.bio || 'No bio provided.')}</p>
            <div class="badge bg-light text-dark border">${config.userId}</div>
        </div>
    </div>
    
    <div class="container pb-5" style="max-width: 700px;">
        <h4 class="fw-bold mb-4">Feed Archive (${exportPosts.length} posts)</h4>
        ${exportPosts.map(post => {
            const postUser = allUsers.find(u => u.userId === post.userId);
            const userName = postUser?.userId || post.userId;
            const initials = userName[0]?.toUpperCase() || '?';

            return `
            <div class="card post-card">
                <div class="card-body">
                    <div class="d-flex mb-3">
                        <div class="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center me-2" style="width: 40px; height: 40px;">${initials}</div>
                        <div>
                            <div class="fw-bold">${sanitize(userName)}</div>
                            <div class="text-muted small">${new Date(post.timestamp).toLocaleString()}</div>
                        </div>
                    </div>
                    <p style="white-space: pre-wrap;">${sanitize(post.content)}</p>
                    ${post.image ? `<img src="${post.image}" class="post-img mt-2">` : ''}
                </div>
            </div>
        `;
        }).join('')}
        
        <div class="text-center text-muted mt-5 small">
            Exported from SovereignS3nc on ${new Date().toLocaleString()}
        </div>
    </div>
</body>
</html>`;

                        // 4. Download
                        const blob = new Blob([htmlContent], { type: 'text/html' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `sovereign_archive_${config.userId}_${new Date().toISOString().split('T')[0]}.html`;
                        a.click();
                        URL.revokeObjectURL(url);

                        showAlert('Portable archive exported successfully!', 'Success');
                    } catch (e: any) {
                        showAlert('Export failed: ' + e.message, 'Error');
                    }
                }}>
                    <i className="bi bi-file-earmark-arrow-down me-2"></i> Export Static Website
                </button>

            </div>

            <div className="card p-4 shadow-sm border-0 mt-4">
                <h4 className="mb-4 fw-bold">Security</h4>
                <div className="mb-3">
                    <label className="form-label small fw-bold text-muted text-uppercase">Old Password</label>
                    <input className="form-control" type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} placeholder="Enter old password" />
                </div>
                <div className="mb-4">
                    <label className="form-label small fw-bold text-muted text-uppercase">New Password</label>
                    <input className="form-control" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Enter new password" />
                </div>
                <button className="btn btn-danger w-100 py-2 fw-bold" onClick={handleChangePassword}>Change Password</button>
                <div className="mt-3 small text-muted">
                    <b>Note:</b> Changing your password will migrate your private data on the remote storage to a new path derived from your new password.
                </div>
            </div>

            <div className="card p-4 shadow-sm border-0 mt-4 d-md-none">
                <h4 className="mb-4 fw-bold">Account Actions</h4>
                {config.syncMode === 'offline' && (
                    <button className="btn btn-primary w-100 py-2 fw-bold mb-3" onClick={handleConnectRemote}>
                        <i className="bi bi-cloud-upload me-2"></i> Connect Remote
                    </button>
                )}
                <button className="btn btn-outline-danger w-100 py-2 fw-bold" onClick={logout}>
                    <i className="bi bi-box-arrow-right me-2"></i> Logout
                </button>
            </div>
        </div>
    );
};
