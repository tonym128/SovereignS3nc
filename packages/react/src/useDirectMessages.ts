import { useState, useEffect, useCallback, useRef } from 'react';
import { useSovereign } from './useSovereign';
import { MessagingModule, Message } from 'sovereigns3nc';
import { UseDirectMessagesOptions, UseDirectMessagesResult } from './types';

/**
 * Reactive hook for direct end-to-end encrypted messaging with a specific recipient.
 * Automatically synchronizes with local outbox/inbox and module update events.
 */
export function useDirectMessages(
    recipientId: string,
    options: UseDirectMessagesOptions = {}
): UseDirectMessagesResult {
    const { days = 7, autoRefreshOnUpdate = true } = options;
    const sov = useSovereign();

    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<Error | null>(null);

    const isMountedRef = useRef<boolean>(true);

    // Get or initialize MessagingModule
    const getMessagingModule = useCallback((): MessagingModule => {
        let instance = sov.getModuleInstance<MessagingModule>('messaging');
        if (!instance) {
            instance = new MessagingModule(sov);
        }
        return instance;
    }, [sov]);

    const loadMessages = useCallback(async () => {
        if (!recipientId) {
            setMessages([]);
            setIsLoading(false);
            return;
        }

        try {
            const messaging = getMessagingModule();
            const myId = sov.getConfig().paths.userId;
            const allInbox = await messaging.getInboxMessages(days);

            // Filter for conversation between local user and recipient
            const convoMessages = allInbox.filter(m =>
                (m.senderId === recipientId && m.recipientId === myId) ||
                (m.senderId === myId && m.recipientId === recipientId)
            );

            // Sort chronologically ascending
            convoMessages.sort((a, b) => a.timestamp - b.timestamp);

            if (isMountedRef.current) {
                setMessages(convoMessages);
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
    }, [getMessagingModule, recipientId, days, sov]);

    useEffect(() => {
        isMountedRef.current = true;
        setIsLoading(true);
        loadMessages();

        if (!autoRefreshOnUpdate) {
            return () => {
                isMountedRef.current = false;
            };
        }

        const handleUpdate = () => {
            loadMessages();
        };

        const handleSyncProgress = (data: { stage: string }) => {
            if (data.stage === 'complete') {
                loadMessages();
            }
        };

        sov.on('messaging:update', handleUpdate);
        sov.on('sync:progress', handleSyncProgress);

        return () => {
            isMountedRef.current = false;
            sov.off('messaging:update', handleUpdate);
            sov.off('sync:progress', handleSyncProgress);
        };
    }, [sov, loadMessages, autoRefreshOnUpdate]);

    const sendDM = useCallback(async (content: string, mediaAttachment?: Uint8Array, expiresAt?: number) => {
        if (!recipientId) throw new Error('Cannot send DM without a recipientId');
        const messaging = getMessagingModule();
        await messaging.sendDirectMessage(recipientId, content, mediaAttachment, expiresAt);
        await loadMessages();
    }, [getMessagingModule, recipientId, loadMessages]);

    return {
        messages,
        isLoading,
        error,
        sendDM,
        refresh: loadMessages
    };
}
