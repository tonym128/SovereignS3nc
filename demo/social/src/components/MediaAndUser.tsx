import React, { useState, useEffect } from 'react';
import { ProfileModule } from '../../../../src/modules/Profile';
import { SovereignS3nc } from '../../../../src/SovereignS3nc';
import { MessagingModule, Message } from '../../../../src/modules/Messaging';
import { useSocial } from '../context/SocialContext';

export interface BlobImageProps {
    path: string;
    userId: string;
    message?: Message;
    sov?: SovereignS3nc | null;
    messaging?: MessagingModule | null;
    blobCache?: Record<string, string>;
    setBlobCache?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export const BlobImage: React.FC<BlobImageProps> = ({
    path,
    userId,
    message,
    sov: propSov,
    messaging: propMessaging,
    blobCache: propBlobCache,
    setBlobCache: propSetBlobCache
}) => {
    const social = useSocial();
    const sov = propSov !== undefined ? propSov : social.sov;
    const messaging = propMessaging !== undefined ? propMessaging : social.messaging;
    const blobCache = propBlobCache !== undefined ? propBlobCache : social.blobCache;
    const setBlobCache = propSetBlobCache !== undefined ? propSetBlobCache : social.setBlobCache;

    const [src, setSrc] = useState<string | null>(blobCache[path] || null);

    useEffect(() => {
        if (!src && sov) {
            const imagePromise = message && messaging
                ? messaging.getMessageImage(message)
                : sov.getBlob(path, userId);

            imagePromise.then(data => {
                if (data) {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const base64data = reader.result as string;
                        setSrc(base64data);
                        if (setBlobCache) {
                            setBlobCache(prev => ({ ...prev, [path]: base64data }));
                        }
                    };
                    reader.readAsDataURL(new Blob([data]));
                }
            });
        }
    }, [path, userId, sov, message?.localImage, message?.imageEncryption, messaging]);

    if (!src) return <div className="bg-light p-5 text-center text-muted">Loading image...</div>;
    return <img src={src} alt="Attachment content" className="img-fluid rounded" style={{ maxHeight: '500px' }} />;
};

export interface UserAvatarProps {
    userId: string;
    size?: number;
    profileModule?: ProfileModule | null;
    lastSyncTime?: string | null;
    profileCache?: Record<string, any>;
    setProfileCache?: React.Dispatch<React.SetStateAction<Record<string, any>>>;
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
    userId,
    size = 40,
    profileModule: propProfileModule,
    lastSyncTime: propLastSyncTime,
    profileCache: propProfileCache,
    setProfileCache: propSetProfileCache
}) => {
    const social = useSocial();
    const profileModule = propProfileModule !== undefined ? propProfileModule : social.profileModule;
    const lastSyncTime = propLastSyncTime !== undefined ? propLastSyncTime : social.lastSyncTime;
    const profileCache = propProfileCache !== undefined ? propProfileCache : social.profileCache;
    const setProfileCache = propSetProfileCache !== undefined ? propSetProfileCache : social.setProfileCache;

    const [userData, setUserData] = useState<any>(profileCache[userId]);

    useEffect(() => {
        if (profileModule) {
            profileModule.getProfile(userId).then(p => {
                if (p && (!userData || p.updatedAt > (userData.updatedAt || 0) || p.name !== userData.name || p.avatar !== userData.avatar)) {
                    setUserData(p);
                    if (setProfileCache) {
                        setProfileCache(prev => ({ ...prev, [userId]: p }));
                    }
                }
            });
        }
    }, [userId, profileModule, lastSyncTime]);

    const p = userData || { name: userId };
    return (
        <div className="d-flex align-items-center">
            {p.avatar ? (
                <img src={p.avatar} alt={`${p.name || userId} avatar`} style={{ width: size + 'px', height: size + 'px', borderRadius: '50%', objectFit: 'cover' }} className="me-2" />
            ) : (
                <div className="bg-secondary text-white rounded-circle d-flex align-items-center justify-content-center me-2" style={{ width: size + 'px', height: size + 'px' }}>
                    {userId[0]?.toUpperCase() || '?'}
                </div>
            )}
            {size > 30 && (
                <div className="d-flex flex-column">
                    <span className="fw-bold">{p.name || userId}</span>
                    {p.name && p.name !== userId && <small className="text-muted" style={{ fontSize: '0.75rem' }}>@{userId}</small>}
                </div>
            )}
        </div>
    );
};

export interface UserNameProps {
    userId: string;
    className?: string;
    profileModule?: ProfileModule | null;
    lastSyncTime?: string | null;
    profileCache?: Record<string, any>;
    setProfileCache?: React.Dispatch<React.SetStateAction<Record<string, any>>>;
}

export const UserName: React.FC<UserNameProps> = ({
    userId,
    className,
    profileModule: propProfileModule,
    lastSyncTime: propLastSyncTime,
    profileCache: propProfileCache,
    setProfileCache: propSetProfileCache
}) => {
    const social = useSocial();
    const profileModule = propProfileModule !== undefined ? propProfileModule : social.profileModule;
    const lastSyncTime = propLastSyncTime !== undefined ? propLastSyncTime : social.lastSyncTime;
    const profileCache = propProfileCache !== undefined ? propProfileCache : social.profileCache;
    const setProfileCache = propSetProfileCache !== undefined ? propSetProfileCache : social.setProfileCache;

    const [userData, setUserData] = useState<any>(profileCache[userId]);

    useEffect(() => {
        if (profileModule) {
            profileModule.getProfile(userId).then(p => {
                if (p && (!userData || p.updatedAt > (userData.updatedAt || 0) || p.name !== userData.name)) {
                    setUserData(p);
                    if (setProfileCache) {
                        setProfileCache(prev => ({ ...prev, [userId]: p }));
                    }
                }
            });
        }
    }, [userId, profileModule, lastSyncTime]);

    return <span className={className || 'fw-bold'}>{userData?.name || userId}</span>;
};
