import React from 'react';
import {
    SovereignS3nc,
    SovereignConfig,
    Post,
    Message,
    Profile,
    Repository,
    SyncRunResult,
    SyncDiagnostic
} from 'sovereigns3nc';

export interface SovereignContextValue {
    sov: SovereignS3nc;
    isInitialized: boolean;
    initError: Error | null;
}

export interface SovereignProviderProps {
    instance?: SovereignS3nc;
    config?: SovereignConfig;
    autoInit?: boolean;
    children?: React.ReactNode;
}

export interface SyncStatus {
    isSyncing: boolean;
    progress: number;
    stage: string;
    error: Error | null;
    lastResult: SyncRunResult | null;
    diagnostics: SyncDiagnostic[];
    sync: (force?: boolean) => Promise<SyncRunResult>;
}

export interface UseFeedOptions {
    days?: number;
    includeFollowed?: boolean;
    limit?: number;
    autoRefreshOnUpdate?: boolean;
}

export interface UseFeedResult {
    posts: Post[];
    isLoading: boolean;
    isLoadingMore?: boolean;
    error: Error | null;
    hasMore?: boolean;
    nextCursor?: string | null;
    loadMore?: () => Promise<void>;
    createPost: (content: string, mediaAttachment?: Uint8Array, isPublic?: boolean, parentId?: string, expiresAt?: number) => Promise<void>;
    likePost: (postId: string, isPublic?: boolean) => Promise<void>;
    deletePost: (postId: string, date: string, isPublic?: boolean) => Promise<void>;
    refresh: () => Promise<void>;
}

export interface UseMessagingOptions {
    days?: number;
    conversationWith?: string;
    limit?: number;
    autoRefreshOnUpdate?: boolean;
}

export interface UseMessagingResult {
    messages: Message[];
    isLoading: boolean;
    isLoadingMore?: boolean;
    error: Error | null;
    hasMore?: boolean;
    nextCursor?: string | null;
    loadMore?: () => Promise<void>;
    sendDM: (targetRecipientId: string, content: string, mediaAttachment?: Uint8Array, expiresAt?: number) => Promise<void>;
    refresh: () => Promise<void>;
}

export interface UseDirectMessagesOptions {
    days?: number;
    autoRefreshOnUpdate?: boolean;
}

export interface UseDirectMessagesResult {
    messages: Message[];
    isLoading: boolean;
    error: Error | null;
    sendDM: (content: string, mediaAttachment?: Uint8Array, expiresAt?: number) => Promise<void>;
    refresh: () => Promise<void>;
}

export interface UseProfileOptions {
    userId?: string;
    autoRefreshOnUpdate?: boolean;
}

export interface UseProfileResult {
    profile: Profile | null;
    isLoading: boolean;
    error: Error | null;
    updateProfile: (name: string, bio: string, avatar?: string) => Promise<void>;
    refresh: () => Promise<void>;
}

export interface UseRepositoryOptions<T extends Record<string, any> = Record<string, any>> {
    datePartition?: string;
    type?: 'private' | 'public';
    idColumn?: string;
    initialQuery?: Partial<T>;
    autoRefreshOnUpdate?: boolean;
}

export interface UseRepositoryResult<T extends Record<string, any> = Record<string, any>> {
    repository: Repository<T> | null;
    data: T[];
    isLoading: boolean;
    error: Error | null;
    query: Partial<T>;
    setQuery: (query: Partial<T>) => void;
    insert: (entity: T) => Promise<void>;
    update: (id: string, updates: Partial<T>) => Promise<void>;
    remove: (id: string) => Promise<void>;
    upsert: (entity: T) => Promise<void>;
    refresh: () => Promise<void>;
}
