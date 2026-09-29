import React, { createContext, useContext } from 'react';
import { SovereignS3nc } from '../../../src/SovereignS3nc';
import { FeedModule } from '../../../src/modules/Feed';
import { MessagingModule } from '../../../src/modules/Messaging';
import { ProfileModule } from '../../../src/modules/Profile';
import { ModerationModule } from '../../../src/modules/Moderation';

export interface SocialContextType {
    sov: SovereignS3nc | null;
    feed: FeedModule | null;
    messaging: MessagingModule | null;
    profileModule: ProfileModule | null;
    moderation: ModerationModule | null;
    profileCache: Record<string, any>;
    setProfileCache: React.Dispatch<React.SetStateAction<Record<string, any>>>;
    blobCache: Record<string, string>;
    setBlobCache: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    lastSyncTime: string | null;
    config: any;
}

export const SocialContext = createContext<SocialContextType>({
    sov: null,
    feed: null,
    messaging: null,
    profileModule: null,
    moderation: null,
    profileCache: {},
    setProfileCache: () => {},
    blobCache: {},
    setBlobCache: () => {},
    lastSyncTime: null,
    config: {}
});

export const useSocial = () => useContext(SocialContext);
