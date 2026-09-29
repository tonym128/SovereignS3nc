import { useState, useEffect, useCallback, useRef } from 'react';
import { useSovereign } from './useSovereign';
import { MessagingModule, Message, PaginatedResult } from 'sovereigns3nc';
import { UseMessagingOptions, UseMessagingResult } from './types';

/**
 * Reactive hook for direct end-to-end encrypted messaging.
 * Supports cursor-based keyset pagination, conversation filtering, and auto-refresh on updates.
 */
export function useMessaging(options: UseMessagingOptions = {}): UseMessagingResult {
    const { days = 7, conversationWith, limit = 50, autoRefreshOnUpdate = true } = options;
    const sov = useSovereign();

    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
    const [error, setError] = useState<Error | null>(null);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState<boolean>(false);

    const isMountedRef = useRef<boolean>(true);

    const getMessagingModule = useCallback((): MessagingModule => {
        let instance = sov.getModuleInstance<MessagingModule>('messaging');
        if (!instance) {
            instance = new MessagingModule(sov);
        }
        return instance;
    }, [sov]);

    const loadInitialMessages = useCallback(async () => {
        try {
            const messaging = getMessagingModule();
            const result: PaginatedResult<Message> = await messaging.getInboxMessagesPaginated({
                days,
                conversationWith,
                limit,
                direction: 'before'
            });

            if (isMountedRef.current) {
                setMessages(result.items);
                setNextCursor(result.nextCursor);
                setHasMore(result.hasMore);
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
    }, [getMessagingModule, days, conversationWith, limit]);

    const loadMore = useCallback(async () => {
        if (!hasMore || !nextCursor || isLoadingMore) return;
        setIsLoadingMore(true);
        try {
            const messaging = getMessagingModule();
            const result: PaginatedResult<Message> = await messaging.getInboxMessagesPaginated({
                days,
                conversationWith,
                limit,
                cursor: nextCursor,
                direction: 'before'
            });

            if (isMountedRef.current) {
                setMessages(prev => [...prev, ...result.items]);
                setNextCursor(result.nextCursor);
                setHasMore(result.hasMore);
            }
        } catch (err: any) {
            if (isMountedRef.current) {
                setError(err instanceof Error ? err : new Error(String(err)));
            }
        } finally {
            if (isMountedRef.current) {
                setIsLoadingMore(false);
            }
        }
    }, [getMessagingModule, days, conversationWith, limit, hasMore, nextCursor, isLoadingMore]);

    useEffect(() => {
        isMountedRef.current = true;
        setIsLoading(true);
        loadInitialMessages();

        if (!autoRefreshOnUpdate) {
            return () => {
                isMountedRef.current = false;
            };
        }

        const handleUpdate = () => {
            loadInitialMessages();
        };

        const handleSync = (data: { stage: string }) => {
            if (data.stage === 'complete') {
                loadInitialMessages();
            }
        };

        sov.on('messaging:update', handleUpdate);
        sov.on('sync:progress', handleSync);

        return () => {
            isMountedRef.current = false;
            sov.off('messaging:update', handleUpdate);
            sov.off('sync:progress', handleSync);
        };
    }, [sov, loadInitialMessages, autoRefreshOnUpdate]);

    const sendDM = useCallback(async (
        targetRecipientId: string,
        content: string,
        mediaAttachment?: Uint8Array,
        expiresAt?: number
    ) => {
        const messaging = getMessagingModule();
        await messaging.sendDirectMessage(targetRecipientId, content, mediaAttachment, expiresAt);
        await loadInitialMessages();
    }, [getMessagingModule, loadInitialMessages]);

    return {
        messages,
        isLoading,
        isLoadingMore,
        error,
        hasMore,
        nextCursor,
        loadMore,
        sendDM,
        refresh: loadInitialMessages
    };
}
