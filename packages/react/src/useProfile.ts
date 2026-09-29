import { useState, useEffect, useCallback, useRef } from 'react';
import { useSovereign } from './useSovereign';
import { ProfileModule, Profile } from 'sovereigns3nc';
import { UseProfileOptions, UseProfileResult } from './types';

/**
 * Reactive hook for accessing and updating user profiles (own profile or followed users).
 * Auto-refreshes on profile update events and remote sync completion.
 */
export function useProfile(options: UseProfileOptions = {}): UseProfileResult {
    const { userId, autoRefreshOnUpdate = true } = options;
    const sov = useSovereign();

    const [profile, setProfile] = useState<Profile | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<Error | null>(null);

    const isMountedRef = useRef<boolean>(true);

    const getProfileModule = useCallback((): ProfileModule => {
        let instance = sov.getModuleInstance<ProfileModule>('profile');
        if (!instance) {
            instance = new ProfileModule(sov);
        }
        return instance;
    }, [sov]);

    const loadProfile = useCallback(async () => {
        try {
            const profileModule = getProfileModule();
            const data = await profileModule.getProfile(userId);
            if (isMountedRef.current) {
                setProfile(data);
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
    }, [getProfileModule, userId]);

    useEffect(() => {
        isMountedRef.current = true;
        setIsLoading(true);
        loadProfile();

        if (!autoRefreshOnUpdate) {
            return () => {
                isMountedRef.current = false;
            };
        }

        const handleUpdate = (data?: any) => {
            if (!userId || data?.userId === userId || !data?.userId) {
                loadProfile();
            }
        };

        const handleSync = (data: { stage: string }) => {
            if (data.stage === 'complete') {
                loadProfile();
            }
        };

        sov.on('profile:update', handleUpdate);
        sov.on('sync:progress', handleSync);

        return () => {
            isMountedRef.current = false;
            sov.off('profile:update', handleUpdate);
            sov.off('sync:progress', handleSync);
        };
    }, [sov, loadProfile, autoRefreshOnUpdate, userId]);

    const updateProfile = useCallback(async (name: string, bio: string, avatar?: string) => {
        const profileModule = getProfileModule();
        await profileModule.updateProfile(name, bio, avatar);
        await loadProfile();
    }, [getProfileModule, loadProfile]);

    return {
        profile,
        isLoading,
        error,
        updateProfile,
        refresh: loadProfile
    };
}
