import React from 'react';
import { Post } from '../../../../src/modules/Feed';
import { UserAvatar, BlobImage } from './MediaAndUser';

export interface RoomsTabProps {
    groups: any[];
    selectedGroup: any | null;
    setSelectedGroup: (group: any | null) => void;
    config: any;
    lastViewed: Record<string, any>;
    handleCreateGroup: () => void;
    handleManageMembers: () => void;
    handleAcceptGroup: (group: any) => Promise<void>;
    handleDeclineGroup: (group: any) => Promise<void>;
    groupPosts: Post[];
    isUserAnAdmin: (userId: string) => boolean;
    handleEditGroupPost: (post: Post) => void;
    handleDeleteGroupPost: (post: Post) => void;
    groupImage: Uint8Array | null;
    groupImagePreview: string | null;
    setGroupImage: (img: Uint8Array | null) => void;
    setGroupImagePreview: (url: string | null) => void;
    groupFileRef: React.RefObject<HTMLInputElement | null>;
    groupInput: string;
    setGroupInput: (val: string) => void;
    handleGroupImageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handlePostToGroup: () => void;
}

export const RoomsTab: React.FC<RoomsTabProps> = ({
    groups,
    selectedGroup,
    setSelectedGroup,
    config,
    lastViewed,
    handleCreateGroup,
    handleManageMembers,
    handleAcceptGroup,
    handleDeclineGroup,
    groupPosts,
    isUserAnAdmin,
    handleEditGroupPost,
    handleDeleteGroupPost,
    groupImage,
    groupImagePreview,
    setGroupImage,
    setGroupImagePreview,
    groupFileRef,
    groupInput,
    setGroupInput,
    handleGroupImageChange,
    handlePostToGroup
}) => {
    return (
        <div className="col-md-10">
            <div className="card shadow-sm border-0 mobile-full-width" style={{ height: '75vh' }}>
                <div className="row g-0 h-100">
                    <div className={`col-md-4 border-end overflow-y-auto h-100 ${selectedGroup ? 'mobile-hide' : ''}`}>
                        <div className="p-3 border-bottom bg-light d-flex justify-content-between align-items-center">
                            <h5 className="mb-0">Rooms</h5>
                            <button className="btn btn-sm btn-primary rounded-pill" onClick={handleCreateGroup}>+</button>
                        </div>
                        <div className="list-group list-group-flush">
                            {groups.length === 0 ? (
                                <div className="p-4 text-center text-muted small">No rooms yet. Create one to start collaborating!</div>
                            ) : groups.map(group => {
                                const me = group.members?.find((mb: any) => mb.userId === config.userId);
                                const isPending = me?.status === 'pending';
                                return (
                                    <button key={group.id} className={`list-group-item list-group-item-action border-0 d-flex justify-content-between align-items-center py-3 ${selectedGroup?.id === group.id ? 'bg-light' : ''}`} onClick={() => setSelectedGroup(group)}>
                                        <div className="fw-bold text-truncate">{group.name}</div>
                                        {isPending && <span className="badge rounded-pill bg-warning text-dark">Invite</span>}
                                        {!isPending && group.createdAt > (lastViewed.roomChat?.[group.id] || 0) && <span className="badge rounded-pill bg-primary">New</span>}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div className={`col-md-8 d-flex flex-column h-100 overflow-hidden ${!selectedGroup ? 'mobile-hide' : ''}`}>
                        {selectedGroup ? (
                            <>
                                <div className="p-3 border-bottom bg-light">
                                    <div className="d-flex justify-content-between align-items-center mb-2">
                                        <div className="d-flex align-items-center">
                                            <button className="btn btn-sm btn-light rounded-circle me-3 d-md-none" onClick={() => setSelectedGroup(null)}>
                                                <i className="bi bi-arrow-left"></i>
                                            </button>
                                            <h6 className="mb-0 fw-bold">{selectedGroup.name}</h6>
                                        </div>
                                        <div className="d-flex align-items-center gap-2">
                                            <div className="small text-muted mobile-hide">{new Date(selectedGroup.createdAt).toLocaleDateString()}</div>
                                            {(selectedGroup.members?.find((m: any) => m.userId === config.userId)?.role === 'owner' || selectedGroup.members?.find((m: any) => m.userId === config.userId)?.role === 'admin') && (
                                                <button className="btn btn-sm btn-outline-primary rounded-pill py-0 px-2" style={{ fontSize: '0.7rem' }} onClick={handleManageMembers}>Manage</button>
                                            )}
                                        </div>
                                    </div>
                                    <div className="d-flex flex-wrap gap-1">
                                        {selectedGroup.members?.map((m: any) => (
                                            <span key={m.userId} className={`badge rounded-pill border ${
                                                m.status === 'joined' ? 'bg-success text-white border-success' :
                                                m.status === 'declined' ? 'bg-light text-muted border-secondary' :
                                                'bg-white text-dark border-warning'
                                            }`} style={{ fontSize: '0.65rem' }}>
                                                {m.userId} ({m.status || 'pending'})
                                            </span>
                                        ))}
                                    </div>
                                    {selectedGroup.members?.find((m: any) => m.userId === config.userId)?.status === 'pending' && (
                                        <div className="mt-3 p-2 bg-warning bg-opacity-10 border border-warning rounded d-flex justify-content-between align-items-center">
                                            <span className="small fw-bold">You have a pending invite to this room.</span>
                                            <div className="d-flex gap-2">
                                                <button className="btn btn-sm btn-success" onClick={() => handleAcceptGroup(selectedGroup)}>Accept</button>
                                                <button className="btn btn-sm btn-outline-danger" onClick={() => handleDeclineGroup(selectedGroup)}>Decline</button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="flex-grow-1 p-3 overflow-y-auto bg-white d-flex flex-column-reverse">
                                    <div className="d-flex flex-column">
                                        {groupPosts
                                            .sort((a, b) => a.timestamp - b.timestamp)
                                            .map((p) => {
                                                const isAdminGroupPost = p.userId !== config.userId && isUserAnAdmin(p.userId);
                                                return (
                                                    <div key={p.id} className={`mb-3 ${p.type === 'system' ? 'text-center' : ''}`}>
                                                        {p.type === 'system' ? (
                                                            <div className="x-small text-muted py-1 bg-light rounded-pill px-3 d-inline-block">
                                                                <UserAvatar userId={p.userId} size={16} /> <span className="ms-1">{p.content}</span>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <div className="d-flex align-items-center justify-content-between mb-1">
                                                                    <div className="d-flex align-items-center">
                                                                        <UserAvatar userId={p.userId} size={24} />
                                                                        {isAdminGroupPost && <span className="badge bg-danger ms-2" style={{ fontSize: '0.65rem' }}><i className="bi bi-shield-check me-1"></i>Admin Action</span>}
                                                                        <span className="ms-2 x-small text-muted">{new Date(p.timestamp).toLocaleString()}</span>
                                                                        {p.isEdited && <span className="ms-2 x-small text-muted italic">(edited)</span>}
                                                                    </div>
                                                                    {(() => {
                                                                        const isAuthor = p.userId === config.userId;
                                                                        const myRole = selectedGroup.members?.find((m: any) => m.userId === config.userId)?.role;
                                                                        const canDelete = isAuthor || myRole === 'owner' || myRole === 'admin';

                                                                        if (!isAuthor && !canDelete) return null;

                                                                        return (
                                                                            <div className="dropdown">
                                                                                <button className="btn btn-link btn-sm text-muted p-0" type="button" data-bs-toggle="dropdown">
                                                                                    <i className="bi bi-three-dots-vertical"></i>
                                                                                </button>
                                                                                <ul className="dropdown-menu dropdown-menu-end shadow-sm border-0 small">
                                                                                    {isAuthor && (
                                                                                        <li><button className="dropdown-item py-1" onClick={() => handleEditGroupPost(p)}>Edit</button></li>
                                                                                    )}
                                                                                    {canDelete && (
                                                                                        <li><button className="dropdown-item py-1 text-danger" onClick={() => handleDeleteGroupPost(p)}>Delete</button></li>
                                                                                    )}
                                                                                </ul>
                                                                            </div>
                                                                        );
                                                                    })()}
                                                                </div>
                                                                <div className={`ms-4 p-2 rounded bg-light shadow-sm ${isAdminGroupPost ? 'border border-danger' : ''}`} style={{ display: 'inline-block', maxWidth: '95%', ...(isAdminGroupPost ? { borderWidth: '2px' } : {}) }}>
                                                                    {p.image && <BlobImage path={p.image} userId={p.userId} />}
                                                                    <div>{p.content}</div>
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                );
                                            })
                                        }
                                    </div>
                                </div>
                                <div className="p-3 border-top bg-light">
                                    {groupImagePreview && (
                                        <div className="mb-2 position-relative d-inline-block">
                                            <img src={groupImagePreview} className="img-thumbnail" style={{ maxHeight: '100px' }} />
                                            <button className="btn btn-sm btn-danger rounded-circle position-absolute top-0 start-100 translate-middle" onClick={() => { setGroupImage(null); setGroupImagePreview(null); if (groupFileRef.current) groupFileRef.current.value = ''; }}>×</button>
                                        </div>
                                    )}
                                    <div className="input-group">
                                        <label className="btn btn-outline-secondary rounded-pill-start mb-0 d-flex align-items-center">
                                            <i className="bi bi-image"></i>
                                            <input type="file" ref={groupFileRef as any} className="d-none" accept="image/*" onChange={handleGroupImageChange} />
                                        </label>
                                        <input className="form-control" placeholder={`Post to ${selectedGroup.name}...`} value={groupInput} onChange={e => setGroupInput(e.target.value)} onKeyDown={e => (e.key === 'Enter' && (e.ctrlKey || !groupImage)) && handlePostToGroup()} />
                                        <button className="btn btn-primary rounded-pill-end px-4" onClick={handlePostToGroup}>Post</button>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="flex-grow-1 d-flex align-items-center justify-content-center text-muted">Select a room to start collaborating</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
