import { useContext } from 'react';
import { SovereignS3nc } from 'sovereigns3nc';
import { SovereignContext } from './SovereignContext';
import { SovereignContextValue } from './types';

/**
 * Hook to access the SovereignContextValue including initialization state and errors.
 */
export function useSovereignContext(): SovereignContextValue {
    const context = useContext(SovereignContext);
    if (!context) {
        throw new Error('useSovereignContext must be used within a <SovereignProvider>');
    }
    return context;
}

/**
 * Hook returning the active SovereignS3nc client instance.
 * Throws an error if called outside a <SovereignProvider>.
 */
export function useSovereign(): SovereignS3nc {
    const context = useContext(SovereignContext);
    if (!context || !context.sov) {
        throw new Error('useSovereign must be used within a <SovereignProvider>');
    }
    return context.sov;
}
