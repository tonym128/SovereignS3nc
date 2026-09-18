import { useState, useEffect, useCallback, useRef } from 'react';
import { useSovereign } from './useSovereign';
import { SyncStatus } from './types';

/**
 * Hook providing reactive sync status, stage, numeric percentage progress, and a trigger function.
 */
export function useSyncStatus(): SyncStatus {
    const sov = useSovereign();
    const [isSyncing, setIsSyncing] = useState<boolean>(() => {
        try {
            return sov.isSyncing();
        } catch {
            return false;
        }
    });
    const [progress, setProgress] = useState<number>(0);
    const [stage, setStage] = useState<string>('idle');
    const [error, setError] = useState<Error | null>(null);

    const isMountedRef = useRef<boolean>(true);

    useEffect(() => {
        isMountedRef.current = true;

        const onProgress = (data: { stage: string; done?: number; total?: number }) => {
            if (!isMountedRef.current) return;

            const { stage: currentStage, done, total } = data;
            setStage(currentStage);

            if (currentStage === 'complete') {
                setIsSyncing(false);
                setProgress(100);
            } else if (currentStage === 'start') {
                setIsSyncing(true);
                setProgress(0);
                setError(null);
            } else {
                setIsSyncing(true);
                if (typeof done === 'number' && typeof total === 'number' && total > 0) {
                    const pct = Math.min(100, Math.max(0, Math.round((done / total) * 100)));
                    setProgress(pct);
                }
            }
        };

        sov.on('sync:progress', onProgress);

        return () => {
            isMountedRef.current = false;
            sov.off('sync:progress', onProgress);
        };
    }, [sov]);

    const sync = useCallback(async (force: boolean = false) => {
        setError(null);
        setIsSyncing(true);
        setStage('start');
        setProgress(0);
        try {
            await sov.sync(force);
            if (isMountedRef.current) {
                setIsSyncing(false);
                setStage('complete');
                setProgress(100);
            }
        } catch (err: any) {
            if (isMountedRef.current) {
                const caught = err instanceof Error ? err : new Error(String(err));
                setError(caught);
                setIsSyncing(false);
                setStage('error');
            }
            throw err;
        }
    }, [sov]);

    return {
        isSyncing,
        progress,
        stage,
        error,
        sync
    };
}
