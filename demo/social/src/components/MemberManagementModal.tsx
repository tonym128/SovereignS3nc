import React from 'react';

export interface MemberManagementModalProps {
    show: boolean;
    onClose: () => void;
    group: any;
    profileCache: Record<string, any>;
    onUpdateRole: (userId: string, role: string) => void;
    onRemove: (userId: string) => void;
    onAdd: () => void;
    onLeave: () => void;
    currentUserId: string;
}

export const MemberManagementModal: React.FC<MemberManagementModalProps> = ({
    show,
    onClose,
    group,
    profileCache,
    onUpdateRole,
    onRemove,
    onAdd,
    onLeave,
    currentUserId
}) => {
    if (!show || !group) return null;

    const myRole = group.members?.find((m: any) => m.userId === currentUserId)?.role;

    return (
        <div className="modal show d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="memberModalTitle" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 2000 }}>
            <div className="modal-dialog modal-dialog-centered modal-lg" role="document">
                <div className="modal-content shadow-lg border-0 rounded-4">
                    <div className="modal-header border-0 pb-0">
                        <h5 id="memberModalTitle" className="modal-title fw-bold text-primary">Manage Members: {group.name}</h5>
                        <button type="button" className="btn-close" aria-label="Close" onClick={onClose}></button>
                    </div>
                    <div className="modal-body py-4">
                        <div className="d-flex justify-content-between align-items-center mb-3">
                            <h6 className="mb-0 fw-bold">Group Members ({group.members?.length || 0})</h6>
                            <button className="btn btn-sm btn-primary rounded-pill px-3" onClick={onAdd}>+ Add Members</button>
                        </div>
                        <div className="list-group">
                            {group.members?.map((member: any) => {
                                const profile = profileCache[member.userId];
                                const isMe = member.userId === currentUserId;
                                const canManage = !isMe && (myRole === 'owner' || (myRole === 'admin' && member.role === 'member'));

                                return (
                                    <div key={member.userId} className="list-group-item d-flex align-items-center justify-content-between border-0 py-3 border-bottom">
                                        <div className="d-flex align-items-center">
                                            {profile?.avatar ? (
                                                <img src={profile.avatar} alt={`${profile?.name || member.userId} avatar`} className="rounded-circle me-3" style={{ width: '40px', height: '40px', objectFit: 'cover' }} />
                                            ) : (
                                                <div className="rounded-circle bg-secondary text-white me-3 d-flex align-items-center justify-content-center" style={{ width: '40px', height: '40px' }}>
                                                    {member.userId[0]?.toUpperCase() || '?'}
                                                </div>
                                            )}
                                            <div>
                                                <div className="fw-bold">{profile?.name || member.userId} {isMe && "(You)"}</div>
                                                <div className="small text-muted">
                                                    <span className={`badge rounded-pill ${member.role === 'owner' ? 'bg-danger' : member.role === 'admin' ? 'bg-primary' : 'bg-secondary'} me-2`}>
                                                        {member.role}
                                                    </span>
                                                    <span className="text-capitalize">{member.status || 'pending'}</span>
                                                </div>
                                            </div>
                                        </div>
                                        {canManage && (
                                            <div className="d-flex gap-2">
                                                {member.role === 'member' && (
                                                    <button className="btn btn-sm btn-outline-primary rounded-pill px-3" onClick={() => onUpdateRole(member.userId, 'admin')}>Make Admin</button>
                                                )}
                                                {member.role === 'admin' && myRole === 'owner' && (
                                                    <button className="btn btn-sm btn-outline-secondary rounded-pill px-3" onClick={() => onUpdateRole(member.userId, 'member')}>Remove Admin</button>
                                                )}
                                                <button className="btn btn-sm btn-outline-danger rounded-pill px-3" onClick={() => {
                                                    if (confirm(`Are you sure you want to remove ${member.userId}?`)) onRemove(member.userId);
                                                }}>Remove</button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <div className="modal-footer border-0 pt-0 d-flex justify-content-between">
                        {myRole !== 'owner' ? (
                            <button type="button" className="btn btn-outline-danger rounded-pill px-4" onClick={onLeave}>Leave Room</button>
                        ) : <div></div>}
                        <button type="button" className="btn btn-light rounded-pill px-4" onClick={onClose}>Close</button>
                    </div>
                </div>
            </div>
        </div>
    );
};
