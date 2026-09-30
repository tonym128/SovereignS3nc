import React from 'react';
import { Message } from '../../../../src/modules/Messaging';
import { UserAvatar, BlobImage } from './MediaAndUser';

export interface MessagesTabProps {
    following: any[];
    messages: Message[];
    config: any;
    selectedUser: string | null;
    setSelectedUser: (userId: string | null) => void;
    isUserAnAdmin: (userId: string) => boolean;
    userUnreadCounts: Record<string, number>;
    handleNewChat: () => void;
    groups: any[];
    handleAcceptGroup: (info: any) => Promise<void>;
    handleDeclineGroup: (info: any) => Promise<void>;
    handleEditMessage: (msg: Message) => void;
    handleDeleteMessage: (msg: Message) => void;
    msgImage: Uint8Array | null;
    msgImagePreview: string | null;
    msgFileRef: React.RefObject<HTMLInputElement | null>;
    msgInput: string;
    setMsgInput: (val: string) => void;
    handleImageChange: (e: React.ChangeEvent<HTMLInputElement>, isMessage: boolean) => void;
    handleSendMessage: () => void;
}

export const MessagesTab: React.FC<MessagesTabProps> = ({
    following,
    messages,
    config,
    selectedUser,
    setSelectedUser,
    isUserAnAdmin,
    userUnreadCounts,
    handleNewChat,
    groups,
    handleAcceptGroup,
    handleDeclineGroup,
    handleEditMessage,
    handleDeleteMessage,
    msgImage,
    msgImagePreview,
    msgFileRef,
    msgInput,
    setMsgInput,
    handleImageChange,
    handleSendMessage
}) => {
    return (
        <div className="col-md-10">
            <div className="card shadow-sm border-0 mobile-full-width" style={{ height: '75vh' }}>
                <div className="row g-0 h-100">
                    <div className={`col-md-4 border-end overflow-y-auto h-100 ${selectedUser ? 'mobile-hide' : ''}`}>
                        <div className="p-3 border-bottom bg-light d-flex justify-content-between align-items-center">
                            <h5 className="mb-0">Chats</h5>
                            <button className="btn btn-sm btn-outline-primary rounded-circle" onClick={handleNewChat} style={{ display: 'none' }}>+</button>
                        </div>
                        <div className="list-group list-group-flush">
                            {(() => {
                                const chatUsers = [...following];
                                messages.forEach(m => {
                                    const otherId = m.senderId === config.userId ? m.recipientId : m.senderId;
                                    if (!chatUsers.find(u => u.userId === otherId)) {
                                        chatUsers.push({ userId: otherId } as any);
                                    }
                                });
                                if (chatUsers.length === 0) return <div className="p-4 text-center text-muted small">No conversations yet. Follow someone to start chatting!</div>;
                                return chatUsers.map(user => (
                                    <button key={user.userId} data-testid={`chat-item-${user.userId}`} className={`list-group-item list-group-item-action border-0 d-flex justify-content-between align-items-center py-3 ${selectedUser === user.userId ? 'bg-light' : ''}`} onClick={() => setSelectedUser(user.userId)}>
                                        <div className="d-flex align-items-center flex-grow-1 overflow-hidden">
                                            <UserAvatar userId={user.userId} />
                                            {isUserAnAdmin(user.userId) && <span className="ms-1 badge bg-danger" style={{ fontSize: '0.6rem' }}>Admin</span>}
                                        </div>
                                        {(userUnreadCounts[user.userId] || 0) > 0 && <span className="badge rounded-pill bg-primary">{userUnreadCounts[user.userId]}</span>}
                                    </button>
                                ));
                            })()}
                        </div>
                    </div>
                    <div className={`col-md-8 d-flex flex-column h-100 overflow-hidden ${!selectedUser ? 'mobile-hide' : ''}`}>
                        {selectedUser ? (
                            <>
                                <div className="p-3 border-bottom bg-light d-flex align-items-center">
                                    <button className="btn btn-sm btn-light rounded-circle me-3 d-md-none" onClick={() => setSelectedUser(null)}>
                                        <i className="bi bi-arrow-left"></i>
                                    </button>
                                    <UserAvatar userId={selectedUser} />
                                    {isUserAnAdmin(selectedUser) && <span className="ms-2 badge bg-danger mobile-hide">Official Administrator</span>}
                                </div>
                                <div className="flex-grow-1 p-3 overflow-y-auto bg-white d-flex flex-column-reverse">
                                    {messages
                                        .filter(m => (m.senderId === selectedUser && m.recipientId === config.userId) || (m.senderId === config.userId && m.recipientId === selectedUser))
                                        .sort((a, b) => b.timestamp - a.timestamp)
                                        .map((m) => {
                                            const isAdminMsg = m.senderId !== config.userId && isUserAnAdmin(m.senderId);
                                            return (
                                                <div key={m.id} data-testid="message-bubble" className={`d-flex mb-2 ${m.senderId === config.userId ? 'justify-content-end' : 'justify-content-start'}`}>
                                                    <div className={`p-2 rounded-4 px-3 ${m.senderId === config.userId ? 'bg-primary text-white' : isAdminMsg ? 'border border-danger bg-light text-dark shadow-sm' : 'bg-light text-dark'}`} style={{ maxWidth: '85%', ...(isAdminMsg ? { borderWidth: '2px' } : {}) }}>
                                                        {isAdminMsg && <div className="badge bg-danger mb-1" style={{ fontSize: '0.65rem' }}><i className="bi bi-shield-check me-1"></i>Admin Action</div>}
                                                        {m.isDeleted ? (
                                                            <i className="small opacity-75">Message deleted</i>
                                                        ) : m.content.startsWith('INVITE_GROUP:') ? (
                                                            <div className="p-2 border rounded bg-white text-dark">
                                                                <div className="fw-bold text-primary mb-1">Group Invitation</div>
                                                                {(() => {
                                                                    try {
                                                                        const info = JSON.parse(m.content.substring(13));
                                                                        const localGroup = groups.find(g => g.id === info.id);
                                                                        const localStatus = localGroup?.members?.find((mb: any) => mb.userId === config.userId)?.status;

                                                                        return (
                                                                            <>
                                                                                <div className="small mb-2">
                                                                                    <b>{m.senderId}</b> invited you to join <b>{info.name}</b>.
                                                                                </div>
                                                                                {localStatus === 'joined' ? (
                                                                                    <span className="badge bg-success w-100">Joined</span>
                                                                                ) : localStatus === 'declined' ? (
                                                                                    <span className="badge bg-secondary w-100">Declined</span>
                                                                                ) : (
                                                                                    <div className="d-flex gap-2">
                                                                                        <button className="btn btn-sm btn-success flex-grow-1" onClick={() => handleAcceptGroup(info)}>Accept</button>
                                                                                        <button className="btn btn-sm btn-outline-danger flex-grow-1" onClick={() => handleDeclineGroup(info)}>Decline</button>
                                                                                    </div>
                                                                                )}
                                                                            </>
                                                                        );
                                                                    } catch (e) { return <span>Invalid Invite</span>; }
                                                                })()}
                                                            </div>
                                                        ) : (
                                                            <>
                                                                {m.image && <BlobImage path={m.image} userId={m.senderId} message={m} />}
                                                                <div>{m.content}</div>
                                                            </>
                                                        )}
                                                        <div style={{ fontSize: '0.6rem' }} className={`mt-1 ${m.senderId === config.userId ? 'opacity-75' : 'text-muted'} d-flex justify-content-between align-items-center`}>
                                                            <span>{new Date(m.timestamp).toLocaleTimeString()} {m.isEdited && "(Edited)"}</span>
                                                            <div className="d-flex align-items-center">
                                                                {m.senderId === config.userId && !m.isDeleted && (
                                                                    <div className="me-2 d-flex">
                                                                        {m.status === 'read' ? (
                                                                            <i className="bi bi-check-all text-info" style={{ fontSize: '0.9rem' }} title="Read"></i>
                                                                        ) : m.status === 'delivered' ? (
                                                                            <i className="bi bi-check-all" style={{ fontSize: '0.9rem' }} title="Delivered"></i>
                                                                        ) : (
                                                                            <i className="bi bi-check" style={{ fontSize: '0.9rem' }} title="Sent"></i>
                                                                        )}
                                                                    </div>
                                                                )}
                                                                {m.senderId === config.userId && !m.isDeleted && (
                                                                    <span className="d-flex gap-2">
                                                                        <button type="button" className="btn btn-link p-0 text-decoration-none border-0" onClick={() => handleEditMessage(m)} title="Edit" aria-label="Edit message">✎</button>
                                                                        <button type="button" className="btn btn-link p-0 text-decoration-none border-0" onClick={() => handleDeleteMessage(m)} title="Delete" aria-label="Delete message">🗑</button>
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    }
                                </div>
                                <div className="p-3 border-top bg-light">
                                    {msgImagePreview && <div className="mb-2"><img src={msgImagePreview} alt="Attached image preview" style={{ maxHeight: '100px' }} className="rounded" /></div>}
                                    <div className="input-group">
                                        <input type="file" ref={msgFileRef as any} className="d-none" id="msgFile" aria-label="Attach image file" onChange={(e) => handleImageChange(e, true)} />
                                        <label htmlFor="msgFile" aria-label="Attach image" className="btn btn-outline-secondary rounded-pill me-2">📷</label>
                                        <input data-testid="message-input" aria-label="Type a message" className="form-control rounded-pill" placeholder="Type a message..." value={msgInput} onChange={e => setMsgInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} />
                                        <button data-testid="message-send-btn" className="btn btn-primary rounded-pill ms-2" onClick={handleSendMessage}>Send</button>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="flex-grow-1 d-flex align-items-center justify-content-center text-muted">Select a friend to start chatting</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
