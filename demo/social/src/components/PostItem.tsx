import React from 'react';
import { Post } from '../../../../src/modules/Feed';
import { UserAvatar, UserName, BlobImage } from './MediaAndUser';

export interface PostItemProps {
    post: Post;
    allPosts: Post[];
    depth?: number;
    currentUserId?: string;
    highlightsFeed?: number;
    isUserAnAdmin?: (userId: string) => boolean;
    onEdit?: (post: Post) => void;
    onDelete?: (post: Post) => void;
    onReport?: (post: Post) => void;
    onLike?: (postId: string) => void;
    onComment?: (post: Post) => void;
    onShare?: (post: Post) => void;
}

export const PostItem: React.FC<PostItemProps> = ({
    post,
    allPosts,
    depth = 0,
    currentUserId = '',
    highlightsFeed = 0,
    isUserAnAdmin = () => false,
    onEdit = () => {},
    onDelete = () => {},
    onReport = () => {},
    onLike = () => {},
    onComment = () => {},
    onShare = () => {}
}) => {
    const replies = allPosts.filter(p => p.parentId === post.id);
    const isNew = highlightsFeed > 0 && post.timestamp > highlightsFeed && post.userId !== currentUserId;
    const isAdminPost = post.userId !== currentUserId && isUserAnAdmin(post.userId);

    return (
        <div className={`mb-3 ${depth > 0 ? 'ms-4 border-start ps-3 mt-2' : ''}`}>
            <div key={post.id} className={`card post-card p-3 ${isAdminPost ? 'border-danger shadow-sm' : isNew ? 'border-primary shadow-sm' : ''}`} style={isAdminPost ? { borderWidth: '2px' } : isNew ? { borderWidth: '2px', backgroundColor: '#f0f7ff' } : {}}>
                <div className="d-flex align-items-center mb-3">
                    <UserAvatar userId={post.userId} />
                    {isAdminPost && <span className="ms-2 badge bg-danger"><i className="bi bi-shield-check me-1"></i>Admin Action</span>}
                    <div className="ms-2 flex-grow-1">
                        <div className="text-muted x-small">
                            {new Date(post.timestamp).toLocaleString()}
                            {post.isEdited && <span className="ms-1 badge bg-light text-muted fw-normal">Edited</span>}
                            {post.parentUserId && (
                                <span className="ms-1">
                                    replied to <UserName userId={post.parentUserId} className="fw-normal text-primary" />
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="dropdown">
                        <button className="btn btn-sm btn-light rounded-circle" data-bs-toggle="dropdown">⋮</button>
                        <ul className="dropdown-menu dropdown-menu-end">
                            {post.userId === currentUserId && !post.isDeleted && (
                                <>
                                    <li><button className="dropdown-item" onClick={() => onEdit(post)}>Edit</button></li>
                                    <li><button className="dropdown-item text-danger" onClick={() => onDelete(post)}>Delete</button></li>
                                </>
                            )}
                            {post.userId !== currentUserId && (
                                <li><button className="dropdown-item text-warning" onClick={() => onReport(post)}>Report Abuse</button></li>
                            )}
                        </ul>
                    </div>
                </div>
                <div className="mb-3">
                    {post.isDeleted ? (
                        <i className="text-muted small">This post was deleted</i>
                    ) : (
                        post.content
                    )}
                </div>
                {post.image && !post.isDeleted && <BlobImage path={post.image} userId={post.userId} />}
                <div className="border-top mt-3 pt-2 d-flex justify-content-around">
                    <button
                        className={`btn btn-link text-decoration-none ${post.likedByMe ? 'text-primary fw-bold' : 'text-muted'}`}
                        onClick={() => onLike(post.id)}
                        disabled={post.isDeleted}
                    >
                        Like {post.likesCount ? `(${post.likesCount})` : ''}
                    </button>
                    <button className="btn btn-link text-muted text-decoration-none" onClick={() => onComment(post)} disabled={post.isDeleted}>Comment</button>
                    <button className="btn btn-link text-muted text-decoration-none" onClick={() => onShare(post)} disabled={post.isDeleted}>Share</button>
                </div>
            </div>
            {replies.sort((a, b) => a.timestamp - b.timestamp).map(reply => (
                <PostItem
                    key={reply.id}
                    post={reply}
                    allPosts={allPosts}
                    depth={depth + 1}
                    currentUserId={currentUserId}
                    highlightsFeed={highlightsFeed}
                    isUserAnAdmin={isUserAnAdmin}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onReport={onReport}
                    onLike={onLike}
                    onComment={onComment}
                    onShare={onShare}
                />
            ))}
        </div>
    );
};
