import { useState, useEffect, useCallback, useRef } from 'react';
import { useSovereign } from './useSovereign';
import { SyncStatus } from './types';
import { SyncDiagnostic, SyncProgressEvent, SyncRunResult } from 'sovereigns3nc';

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
    const [lastResult, setLastResult] = useState<SyncRunResult | null>(null);
    const [diagnostics, setDiagnostics] = useState<SyncDiagnostic[]>([]);

    const isMountedRef = useRef<boolean>(true);

    useEffect(() => {
        isMountedRef.current = true;

        const onProgress = (data: SyncProgressEvent) => {
            if (!isMountedRef.current) return;

            const { stage: currentStage, done, total } = data;
            setStage(currentStage);

            if (currentStage === 'complete') {
                setIsSyncing(false);
                setProgress(100);
                if (data.state === 'failed') setError(new Error('Sync completed with one or more failed phases.'));
            } else if (currentStage === 'start') {
                setIsSyncing(true);
                setProgress(0);
                setError(null);
                setDiagnostics([]);
            } else {
                setIsSyncing(true);
                if (typeof done === 'number' && typeof total === 'number' && total > 0) {
                    const pct = Math.min(100, Math.max(0, Math.round((done / total) * 100)));
                    setProgress(pct);
                }
            }
        };

        const onDiagnostic = (diagnostic: SyncDiagnostic) => {
            if (!isMountedRef.current) return;
            setDiagnostics(prev => [...prev, diagnostic].slice(-50));
        };

        const onResult = (result: SyncRunResult) => {
            if (!isMountedRef.current) return;
            setLastResult(result);
            if (result.status === 'partial' || result.status === 'failed') {
                setError(new Error(`Sync ${result.status}: ${result.diagnostics.length} diagnostic(s).`));
                setIsSyncing(false);
            } else if (result.status === 'succeeded') {
                setError(null);
            }
        };

        sov.on('sync:progress', onProgress);
        sov.on('sync:diagnostic', onDiagnostic);
        sov.on('sync:result', onResult);

        return () => {
            isMountedRef.current = false;
            sov.off('sync:progress', onProgress);
            sov.off('sync:diagnostic', onDiagnostic);
            sov.off('sync:result', onResult);
        };
    }, [sov]);

    const sync = useCallback(async (force: boolean = false) => {
        setError(null);
        setIsSyncing(true);
        setStage('start');
        setProgress(0);
        setDiagnostics([]);
        try {
            const result = await sov.sync(force);
            if (isMountedRef.current) {
                setLastResult(result);
                if (result.status === 'partial' || result.status === 'failed') {
                    setError(new Error(`Sync ${result.status}: ${result.diagnostics.length} diagnostic(s).`));
                }
                setIsSyncing(false);
                setStage(result.status === 'failed' ? 'error' : 'complete');
                setProgress(100);
            }
            return result;
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
        lastResult,
        diagnostics,
        sync
    };
}
