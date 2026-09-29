import React from 'react';
import { Post } from '../../../../src/modules/Feed';
import { UserAvatar } from './MediaAndUser';
import { PostItem } from './PostItem';

export interface FeedTabProps {
    config: any;
    newPost: string;
    setNewPost: (val: string) => void;
    handlePostKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    newImagePreview: string | null;
    postFileRef: React.RefObject<HTMLInputElement | null>;
    handleImageChange: (e: React.ChangeEvent<HTMLInputElement>, isMessage: boolean) => void;
    handlePost: () => void;
    posts: Post[];
    setCurrentTab: (tab: any) => void;
    handleLoadMore: () => void;
    highlights: Record<string, number>;
    isUserAnAdmin: (userId: string) => boolean;
    handleEditPost: (post: Post) => void;
    handleDeletePost: (post: Post) => void;
    handleReportPost: (post: Post) => void;
    handleLike: (postId: string) => void;
    handleComment: (post: Post) => void;
    handleShare: (post: Post) => void;
}

export const FeedTab: React.FC<FeedTabProps> = ({
    config,
    newPost,
    setNewPost,
    handlePostKeyDown,
    newImagePreview,
    postFileRef,
    handleImageChange,
    handlePost,
    posts,
    setCurrentTab,
    handleLoadMore,
    highlights,
    isUserAnAdmin,
    handleEditPost,
    handleDeletePost,
    handleReportPost,
    handleLike,
    handleComment,
    handleShare
}) => {
    return (
        <div className="feed-container mobile-full-width">
            <div className="card post-card p-3 mb-4">
                <div className="d-flex mb-3">
                    <UserAvatar userId={config.userId} />
                    <div className="ms-2 flex-grow-1">
                        <textarea
                            className="post-input w-100"
                            rows={1}
                            placeholder="What's on your mind?"
                            value={newPost}
                            onChange={e => setNewPost(e.target.value)}
                            onKeyDown={handlePostKeyDown}
                        />
                    </div>
                </div>
                {newImagePreview && <img src={newImagePreview} className="img-fluid rounded mb-2" style={{ maxHeight: '300px' }} />}
                <div className="d-flex justify-content-between border-top pt-2">
                    <input type="file" ref={postFileRef as any} className="form-control form-control-sm border-0 w-auto" onChange={(e) => handleImageChange(e, false)} />
                    <button className="btn btn-sov px-4" onClick={handlePost}>Post</button>
                </div>
            </div>

            {posts.length === 0 ? (
                <div className="text-center py-5 card border-0 shadow-sm rounded-4 mb-4">
                    <div className="card-body">
                        <div className="display-1 text-muted mb-4 opacity-25">
                            <i className="bi bi-chat-square-text"></i>
                        </div>
                        <h4 className="fw-bold text-secondary">No posts yet</h4>
                        <p className="text-muted mb-4">Follow some friends or create your first post to get started!</p>
                        <button className="btn btn-primary rounded-pill px-4 shadow-sm" onClick={() => setCurrentTab('friends')}>
                            Find People to Follow
                        </button>
                    </div>
                </div>
            ) : (
                posts
                    .filter(post => !post.parentId || !posts.some(p => p.id === post.parentId))
                    .map(post => (
                        <PostItem
                            key={post.id}
                            post={post}
                            allPosts={posts}
                            currentUserId={config.userId}
                            highlightsFeed={highlights.feed}
                            isUserAnAdmin={isUserAnAdmin}
                            onEdit={handleEditPost}
                            onDelete={handleDeletePost}
                            onReport={handleReportPost}
                            onLike={handleLike}
                            onComment={handleComment}
                            onShare={handleShare}
                        />
                    ))
            )}

            <div className="text-center mt-4 mb-5">
                <button className="btn btn-outline-secondary" onClick={handleLoadMore}>Load more history</button>
            </div>
        </div>
    );
};
