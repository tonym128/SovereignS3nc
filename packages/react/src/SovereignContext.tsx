import React, { createContext, useState, useEffect, useMemo, useRef } from 'react';
import { SovereignS3nc } from 'sovereigns3nc';
import { SovereignContextValue, SovereignProviderProps } from './types';

export const SovereignContext = createContext<SovereignContextValue | null>(null);

export const SovereignProvider: React.FC<SovereignProviderProps> = ({
    instance,
    config,
    autoInit = true,
    children
}) => {
    const [sovInstance, setSovInstance] = useState<SovereignS3nc | null>(() => instance || (config ? new SovereignS3nc(config) : null));
    const [isInitialized, setIsInitialized] = useState<boolean>(() => {
        if (instance) {
            try {
                return !!instance.getStorage();
            } catch {
                return false;
            }
        }
        return false;
    });
    const [initError, setInitError] = useState<Error | null>(null);
    const hasInitializedRef = useRef<boolean>(false);

    useEffect(() => {
        if (instance) {
            setSovInstance(instance);
            try {
                if (instance.getStorage()) {
                    setIsInitialized(true);
                }
            } catch {
                setIsInitialized(false);
            }
        }
    }, [instance]);

    useEffect(() => {
        let active = true;

        if (!sovInstance && config) {
            const created = new SovereignS3nc(config);
            setSovInstance(created);
        }

        if (sovInstance && autoInit && !hasInitializedRef.current) {
            let alreadyReady = false;
            try {
                if (sovInstance.getStorage()) {
                    alreadyReady = true;
                    setIsInitialized(true);
                }
            } catch {}

            if (!alreadyReady) {
                hasInitializedRef.current = true;
                sovInstance.init()
                    .then(() => {
                        if (active) {
                            setIsInitialized(true);
                            setInitError(null);
                        }
                    })
                    .catch((err) => {
                        if (active) {
                            setInitError(err instanceof Error ? err : new Error(String(err)));
                            setIsInitialized(false);
                        }
                    });
            }
        }

        return () => {
            active = false;
        };
    }, [sovInstance, autoInit, config]);

    const contextValue = useMemo<SovereignContextValue | null>(() => {
        if (!sovInstance) return null;
        return {
            sov: sovInstance,
            isInitialized,
            initError
        };
    }, [sovInstance, isInitialized, initError]);

    if (!contextValue) {
        return null;
    }

    return (
        <SovereignContext.Provider value={contextValue}>
            {children}
        </SovereignContext.Provider>
    );
};
