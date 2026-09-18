import { useState, useEffect, useCallback, useRef } from 'react';
import { useSovereign } from './useSovereign';
import { FeedModule, Post } from 'sovereigns3nc';
import { UseFeedOptions, UseFeedResult } from './types';

/**
 * Reactive hook for social feed posts, auto-updating on local writes and remote sync events.
 */
export function useFeed(options: UseFeedOptions = {}): UseFeedResult {
    const { days = 7, includeFollowed = true, autoRefreshOnUpdate = true } = options;
    const sov = useSovereign();

    const [posts, setPosts] = useState<Post[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<Error | null>(null);

    const isMountedRef = useRef<boolean>(true);

    const getFeedModule = useCallback((): FeedModule => {
        let instance = sov.getModuleInstance<FeedModule>('feed');
        if (!instance) {
            instance = new FeedModule(sov);
        }
        return instance;
    }, [sov]);

    const loadPosts = useCallback(async () => {
        try {
            const feed = getFeedModule();
            const feedPosts = await feed.getFeedPosts(days, includeFollowed);

            if (isMountedRef.current) {
                setPosts(feedPosts);
                setError(null);
            }
        } catch (err: any) {
            if (isMountedRef.current) {
                setError(err instanceof Error ? err : new Error(String(err)));
            }
        } finally {
            if (isMountedRef.current) {
                setIsLoading(false);
            }
        }
    }, [getFeedModule, days, includeFollowed]);

    useEffect(() => {
        isMountedRef.current = true;
        setIsLoading(true);
        loadPosts();

        if (!autoRefreshOnUpdate) {
            return () => {
                isMountedRef.current = false;
            };
        }

        const handleUpdate = () => {
            loadPosts();
        };

        const handleSyncProgress = (data: { stage: string }) => {
            if (data.stage === 'complete') {
                loadPosts();
            }
        };

        sov.on('feed:update', handleUpdate);
        sov.on('sync:progress', handleSyncProgress);

        return () => {
            isMountedRef.current = false;
            sov.off('feed:update', handleUpdate);
            sov.off('sync:progress', handleSyncProgress);
        };
    }, [sov, loadPosts, autoRefreshOnUpdate]);

    const createPost = useCallback(async (
        content: string,
        mediaAttachment?: Uint8Array,
        isPublic: boolean = true,
        parentId?: string,
        expiresAt?: number
    ) => {
        const feed = getFeedModule();
        await feed.post(content, isPublic, mediaAttachment, parentId, undefined, expiresAt);
        await loadPosts();
    }, [getFeedModule, loadPosts]);

    const likePost = useCallback(async (postId: string, isPublic: boolean = true) => {
        const feed = getFeedModule();
        await feed.like(postId, isPublic);
        await loadPosts();
    }, [getFeedModule, loadPosts]);

    const deletePost = useCallback(async (postId: string, date: string, isPublic: boolean = true) => {
        const feed = getFeedModule();
        await feed.deletePost(postId, date, isPublic);
        await loadPosts();
    }, [getFeedModule, loadPosts]);

    return {
        posts,
        isLoading,
        error,
        createPost,
        likePost,
        deletePost,
        refresh: loadPosts
    };
}
