import React from 'react';
import { SovereignS3nc } from '../../../../src/SovereignS3nc';
import { FeedModule } from '../../../../src/modules/Feed';
import { MessagingModule } from '../../../../src/modules/Messaging';
import { ProfileModule } from '../../../../src/modules/Profile';
import { UserAvatar } from './MediaAndUser';

export interface FriendsTabProps {
    allUsers: any[];
    config: any;
    discoveryMap: Record<string, number>;
    highlights: Record<string, number>;
    following: any[];
    sov: SovereignS3nc | null;
    loadData: (s?: any, f?: any, m?: any, p?: any) => Promise<void>;
    showPrompt: (message: string, onConfirm: (val?: any) => void) => void;
    setDiscoveryMap: React.Dispatch<React.SetStateAction<Record<string, number>>>;
    feed: FeedModule | null;
    messaging: MessagingModule | null;
    profileModule: ProfileModule | null;
}

export const FriendsTab: React.FC<FriendsTabProps> = ({
    allUsers,
    config,
    discoveryMap,
    highlights,
    following,
    sov,
    loadData,
    showPrompt,
    setDiscoveryMap,
    feed,
    messaging,
    profileModule
}) => {
    return (
        <div className="col-md-8 mobile-full-width">
            <div className="card p-3 mb-4 shadow-sm border-0">
                <div className="d-flex justify-content-between align-items-center mb-3">
                    <h5 className="fw-bold mb-0">Discover People</h5>
                    <button className="btn btn-sm btn-outline-primary rounded-pill" onClick={() => {
                        showPrompt('Enter exact User ID to discover:', (uid) => {
                            if (uid) {
                                setDiscoveryMap(prev => {
                                    const next = { ...prev, [uid]: Date.now() };
                                    setTimeout(() => loadData(sov || undefined, feed || undefined, messaging || undefined, profileModule || undefined), 500);
                                    return next;
                                });
                            }
                        });
                    }}>+ Add by ID</button>
                </div>
                <div className="list-group list-group-flush">
                    {allUsers.filter(u => u.userId !== config.userId).map(u => {
                        const isNew = (discoveryMap[u.userId] || 0) > highlights.friends;
                        return (
                            <div key={u.userId} data-testid={`user-item-${u.userId}`} className={`list-group-item d-flex justify-content-between align-items-center border-0 py-3 rounded-3 mb-1 ${isNew ? 'border-start border-primary' : ''}`} style={isNew ? { backgroundColor: '#f0f7ff', borderLeftWidth: '4px' } : {}}>
                                <UserAvatar userId={u.userId} />
                                {following.find(f => f.userId === u.userId) ? (
                                    <button className="btn btn-light btn-sm rounded-pill px-3" onClick={async () => { await sov?.unfollow(u.userId); await loadData(); }}>Following</button>
                                ) : (
                                    <button className="btn btn-primary btn-sm rounded-pill px-3" onClick={async () => { await sov?.follow(u.userId, u.publicKey); await loadData(); }}>Follow</button>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
