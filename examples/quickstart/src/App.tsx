import React, { useState } from 'react';
import { useSovereign, useProfile, useFeed, useSyncStatus } from '@sovereigns3nc/react';

export const App: React.FC = () => {
  const { client, isInitialized } = useSovereign();
  const { profile, updateProfile, loading: profileLoading } = useProfile();
  const { posts, addPost, loading: feedLoading, hasMore, loadMore } = useFeed({ limit: 5 });
  const { status, isOnline, triggerSync } = useSyncStatus();

  const [postText, setPostText] = useState('');
  const [profileName, setProfileName] = useState('');
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!postText.trim()) return;
    await addPost(postText.trim());
    setPostText('');
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileName.trim()) return;
    await updateProfile({ name: profileName.trim() });
    setIsEditingProfile(false);
  };

  if (!isInitialized) {
    return (
      <div className="container py-5 text-center">
        <div className="spinner-border text-primary mb-3" role="status"></div>
        <p className="text-secondary">Initializing SovereignS3nc offline storage...</p>
      </div>
    );
  }

  return (
    <div className="container py-5" style={{ maxWidth: '720px' }}>
      {/* Header */}
      <header className="d-flex justify-content-between align-items-center pb-3 mb-4 border-bottom border-secondary">
        <div>
          <h2 className="fw-bold mb-0 text-white d-flex align-items-center gap-2">
            <i className="bi bi-shield-lock-fill text-primary"></i> SovereignS3nc
          </h2>
          <small className="text-secondary">Offline-First Zero-Trust Starter</small>
        </div>
        <div className="d-flex align-items-center gap-2">
          <span className={`badge ${isOnline ? 'bg-success' : 'bg-warning text-dark'}`}>
            <i className={`bi ${isOnline ? 'bi-wifi' : 'bi-wifi-off'} me-1`}></i>
            {isOnline ? 'Online' : 'Offline Mode'}
          </span>
          <button
            onClick={() => triggerSync()}
            className="btn btn-sm btn-outline-light d-flex align-items-center gap-1"
            title="Trigger S3 / Mesh Sync"
          >
            <i className="bi bi-arrow-repeat"></i>
            Sync
          </button>
        </div>
      </header>

      {/* User Profile Card */}
      <div className="card bg-secondary bg-opacity-10 border border-secondary mb-4 p-3 rounded-3">
        <div className="d-flex justify-content-between align-items-center">
          <div>
            <h5 className="mb-0 text-white fw-bold">
              {profile?.name || client?.getUserId() || 'Anonymous User'}
            </h5>
            <small className="text-secondary font-monospace">
              User ID: {client?.getUserId()}
            </small>
          </div>
          <button
            className="btn btn-sm btn-outline-primary"
            onClick={() => {
              setProfileName(profile?.name || '');
              setIsEditingProfile(!isEditingProfile);
            }}
          >
            <i className="bi bi-pencil me-1"></i> Edit Profile
          </button>
        </div>

        {isEditingProfile && (
          <form onSubmit={handleSaveProfile} className="mt-3 pt-3 border-top border-secondary">
            <div className="input-group">
              <input
                type="text"
                className="form-control bg-dark text-white border-secondary"
                placeholder="Display Name"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={profileLoading}>
                Save
              </button>
            </div>
          </form>
        )}
      </div>

      {/* New Post Form */}
      <div className="card bg-secondary bg-opacity-10 border border-secondary mb-4 p-3 rounded-3">
        <h6 className="text-white fw-bold mb-3">Publish Sovereign Post</h6>
        <form onSubmit={handleCreatePost}>
          <div className="mb-3">
            <textarea
              className="form-control bg-dark text-white border-secondary"
              rows={3}
              placeholder="What's happening? Data is encrypted and stored in local IndexedDB first..."
              value={postText}
              onChange={(e) => setPostText(e.target.value)}
            />
          </div>
          <div className="d-flex justify-content-between align-items-center">
            <span className="small text-secondary">
              <i className="bi bi-lock-fill text-success me-1"></i>
              Stored in local SQLite/IndexedDB partition
            </span>
            <button
              type="submit"
              className="btn btn-primary px-4 fw-semibold"
              disabled={!postText.trim() || feedLoading}
            >
              Post
            </button>
          </div>
        </form>
      </div>

      {/* Feed List */}
      <div>
        <h6 className="text-white fw-bold mb-3 d-flex justify-content-between align-items-center">
          <span>Feed Activity</span>
          <span className="badge bg-secondary">{posts.length} posts loaded</span>
        </h6>

        {posts.length === 0 ? (
          <div className="text-center py-4 text-secondary border border-secondary rounded-3">
            <i className="bi bi-inbox fs-2 mb-2 d-block"></i>
            No posts yet. Publish your first sovereign message above!
          </div>
        ) : (
          <div className="d-flex flex-column gap-3">
            {posts.map((post) => (
              <div
                key={post.id}
                className="card bg-secondary bg-opacity-10 border border-secondary p-3 rounded-3"
              >
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <span className="fw-semibold text-primary">{post.author || 'User'}</span>
                  <small className="text-secondary font-monospace">
                    {new Date(post.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </small>
                </div>
                <p className="text-white mb-2">{post.content}</p>
                <div className="d-flex align-items-center gap-3 text-secondary small">
                  <span>
                    <i className="bi bi-heart me-1"></i>
                    {post.likeCount || 0}
                  </span>
                  <span>
                    <i className="bi bi-chat me-1"></i>
                    {post.commentCount || 0}
                  </span>
                  <span className="ms-auto font-monospace x-small text-muted">ID: {post.id}</span>
                </div>
              </div>
            ))}

            {hasMore && (
              <button
                className="btn btn-outline-secondary w-100 py-2 mt-2"
                onClick={() => loadMore()}
                disabled={feedLoading}
              >
                {feedLoading ? 'Loading more...' : 'Load More Posts (Keyset Cursor)'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
