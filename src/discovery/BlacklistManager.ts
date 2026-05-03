import { SovereignConfig } from '../types';
import { IRemoteAdapter } from '../interfaces/IRemoteAdapter';
import { Logger } from '../utils/Logger';
import { PATHS } from '../utils/Constants';
import { NetworkError } from '../utils/Errors';

export interface BlacklistManagerContext {
    config: SovereignConfig;
    getGlobalRemote: () => IRemoteAdapter | undefined;
}

export class BlacklistManager {
    constructor(private ctx: BlacklistManagerContext) {}

    /**
     * Downloads the global blacklist and updates local config.
     */
    public async syncBlacklist() {
        const globalRemote = this.ctx.getGlobalRemote();
        if (!globalRemote) return;
        const path = PATHS.BLACKLIST;
        try {
            const result = await globalRemote.downloadFile(path);
            if (result && result.data) {
                const list = JSON.parse(new TextDecoder().decode(result.data));
                this.ctx.config.blacklist = list;
                Logger.info('Discovery', `Updated blacklist: ${list.length} users.`);
            }
        } catch (e: any) {
            // No blacklist found, which is fine, but log if it's a network error
            if (e.message.includes('Network Error')) {
                Logger.warn('Discovery', `Could not reach blacklist (offline?): ${e.message}`);
            }
        }
    }
}
