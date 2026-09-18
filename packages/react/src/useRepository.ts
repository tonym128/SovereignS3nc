import { useState, useEffect, useCallback, useRef } from 'react';
import { useSovereign } from './useSovereign';
import { Repository } from 'sovereigns3nc';
import { UseRepositoryOptions, UseRepositoryResult } from './types';

/**
 * Reactive hook wrapping the typed Repository<T> layer.
 * Auto-queries and synchronizes entity state upon module mutations.
 */
export function useRepository<T extends Record<string, any>>(
    moduleName: string,
    tableName: string,
    options: UseRepositoryOptions<T> = {}
): UseRepositoryResult<T> {
    const {
        datePartition,
        type = 'private',
        idColumn = 'id',
        initialQuery = {},
        autoRefreshOnUpdate = true
    } = options;

    const sov = useSovereign();

    const [repository, setRepository] = useState<Repository<T> | null>(null);
    const [data, setData] = useState<T[]>([]);
    const [query, setQuery] = useState<Partial<T>>(initialQuery);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<Error | null>(null);

    const isMountedRef = useRef<boolean>(true);

    useEffect(() => {
        try {
            const repo = sov.getRepository<T>(moduleName, tableName, datePartition, type, idColumn);
            setRepository(repo);
        } catch (err: any) {
            setError(err instanceof Error ? err : new Error(String(err)));
        }
    }, [sov, moduleName, tableName, datePartition, type, idColumn]);

    const loadData = useCallback(async () => {
        if (!repository) return;
        try {
            const results = await repository.find(query);
            if (isMountedRef.current) {
                setData(results);
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
    }, [repository, query]);

    useEffect(() => {
        isMountedRef.current = true;
        setIsLoading(true);
        loadData();

        if (!autoRefreshOnUpdate) {
            return () => {
                isMountedRef.current = false;
            };
        }

        const handleUpdate = () => {
            loadData();
        };

        sov.on(`${moduleName}:update`, handleUpdate);

        return () => {
            isMountedRef.current = false;
            sov.off(`${moduleName}:update`, handleUpdate);
        };
    }, [sov, moduleName, loadData, autoRefreshOnUpdate]);

    const insert = useCallback(async (entity: T) => {
        if (!repository) throw new Error('Repository is not ready');
        await repository.insert(entity);
        await loadData();
    }, [repository, loadData]);

    const update = useCallback(async (id: string, updates: Partial<T>) => {
        if (!repository) throw new Error('Repository is not ready');
        await repository.update(id, updates);
        await loadData();
    }, [repository, loadData]);

    const remove = useCallback(async (id: string) => {
        if (!repository) throw new Error('Repository is not ready');
        await repository.delete(id);
        await loadData();
    }, [repository, loadData]);

    const upsert = useCallback(async (entity: T) => {
        if (!repository) throw new Error('Repository is not ready');
        await repository.upsert(entity);
        await loadData();
    }, [repository, loadData]);

    return {
        repository,
        data,
        isLoading,
        error,
        query,
        setQuery,
        insert,
        update,
        remove,
        upsert,
        refresh: loadData
    };
}
