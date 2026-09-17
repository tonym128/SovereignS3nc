import { SovereignConfig } from '../types';
import { IStorage } from '../interfaces/IStorage';
import { IRemoteAdapter } from '../interfaces/IRemoteAdapter';
import { Logger } from '../utils/Logger';
import { SovereignS3nc } from '../SovereignS3nc';
import { PATHS, DEFAULTS } from '../utils/Constants';
import { NetworkError } from '../utils/Errors';

export interface GlobalRegistryContext {
    config: SovereignConfig;
    storage: IStorage;
    getGlobalRemote: () => IRemoteAdapter | undefined;
    /** Sign arbitrary data with the user's Ed25519 signing key. */
    sign?: (data: Uint8Array) => Uint8Array;
    /** Verify a signature against a hex-encoded public key. */
    verify?: (data: Uint8Array, signature: Uint8Array, publicKey: string) => boolean;
}

/** A single signed registry entry stored as `users/{userId}.json` on the global remote. */
export interface SignedRegistryEntry {
    userId: string;
    publicKey: string;
    /** Hex-encoded Ed25519 public key for signature verification. */
    signingPublicKey: string;
    /** Hex-encoded Ed25519 signature over the canonical payload (see signPayload). */
    signature: string;
    /** Unix timestamp (ms) — prevents replay of stale entries. */
    timestamp: number;
}

/** The canonical path prefix where individual user entries are stored. */
const REGISTRY_ENTRIES_PREFIX = 'users/';
/** Legacy path for backwards compat reads. */
const LEGACY_REGISTRY_PATH = PATHS.USERS_REGISTRY;

export class GlobalRegistry {
    /** Cooldown in ms between registry re-uploads (prevents flooding on rapid sync() calls). */
    private static readonly REGISTRATION_COOLDOWN_MS = 5 * 60_000; // 5 minutes
    /** Maximum acceptable age of a received registry entry — prevents replay of stale entries. */
    private static readonly ENTRY_MAX_AGE_MS = 7 * 24 * 60 * 60_000; // 7 days

    private lastRegistrationAt = 0;

    constructor(private ctx: GlobalRegistryContext) {}

    // ─── Internal helpers ───────────────────────────────────────────────────────

    private entryPath(userId: string): string {
        return `${REGISTRY_ENTRIES_PREFIX}${userId}.json`;
    }

    /**
     * Returns the canonical byte sequence to sign/verify for an entry.
     * Deliberately excludes `signature` itself.
     */
    private signPayload(entry: Omit<SignedRegistryEntry, 'signature'>): Uint8Array {
        // Sort keys to ensure deterministic JSON
        const payload = JSON.stringify({
            userId: entry.userId,
            publicKey: entry.publicKey,
            signingPublicKey: entry.signingPublicKey,
            timestamp: entry.timestamp,
        });
        return new TextEncoder().encode(payload);
    }

    private verifyEntry(entry: SignedRegistryEntry): boolean {
        // Age check: reject entries with timestamps too far in the past or future
        const now = Date.now();
        if (entry.timestamp) {
            const age = now - entry.timestamp;
            if (age > GlobalRegistry.ENTRY_MAX_AGE_MS) {
                Logger.warn('Registry', `Entry for ${entry.userId} is too old (${Math.round(age / 86400000)}d). Rejecting.`);
                return false;
            }
            if (age < -300_000) { // 5 min future drift tolerance
                Logger.warn('Registry', `Entry for ${entry.userId} has a future timestamp. Possible replay attack. Rejecting.`);
                return false;
            }
        }

        if (!this.ctx.verify) return true; // Verification not configured — accept all
        if (!entry.signature || !entry.signingPublicKey) {
            Logger.warn('Registry', `Entry for ${entry.userId} is unsigned — rejecting.`);
            return false;
        }
        try {
            const payload = this.signPayload(entry);
            const sig = Buffer.from(entry.signature, 'hex');
            return this.ctx.verify(payload, sig, entry.signingPublicKey);
        } catch (e: any) {
            Logger.warn('Registry', `Signature verification failed for ${entry.userId}: ${e.message}`);
            return false;
        }
    }

    // ─── Public API ─────────────────────────────────────────────────────────────

    /**
     * Uploads the current user's signed registry entry to `users/{userId}.json`.
     * Only touches the current user's own file — does NOT overwrite other users.
     * Rate-limited: re-uploads are suppressed within REGISTRATION_COOLDOWN_MS of the last upload.
     */
    public async ensureGlobalRegistration() {
        const globalRemote = this.ctx.getGlobalRemote();
        if (!globalRemote) return;

        const myUserId = this.ctx.config.paths.userId;
        const myPublicKey = this.ctx.config.publicEncryptionKey!;
        const signingPublicKey = (this.ctx.config as any).signingPublicKey as string | undefined;

        if (!myPublicKey) {
            Logger.warn('Registry', 'No public key available — skipping registration.');
            return;
        }

        // Rate limiting: skip re-upload if we uploaded recently (within cooldown window)
        const now = Date.now();
        if (this.lastRegistrationAt > 0 && now - this.lastRegistrationAt < GlobalRegistry.REGISTRATION_COOLDOWN_MS) {
            Logger.debug('Discovery', `Registry registration rate-limited — last upload ${Math.round((now - this.lastRegistrationAt) / 1000)}s ago, cooldown is ${GlobalRegistry.REGISTRATION_COOLDOWN_MS / 1000}s.`);
            return;
        }

        const remotePath = this.entryPath(myUserId);
        Logger.info('Discovery', `Checking individual registry entry at ${remotePath}`);

        // Check if our current entry is already up to date on remote
        try {
            const result = await globalRemote.downloadFile(remotePath, undefined, DEFAULTS.NETWORK_TIMEOUT);
            if (result?.data) {
                const existing: SignedRegistryEntry = JSON.parse(new TextDecoder().decode(result.data));
                if (existing.userId === myUserId && existing.publicKey === myPublicKey) {
                    Logger.debug('Discovery', `Registry entry for ${myUserId} is already current.`);
                    this.lastRegistrationAt = now; // Count as a registration for rate-limit purposes
                    return;
                }
            }
        } catch (e: any) {
            // Entry doesn't exist yet — will create below
            Logger.debug('Discovery', `No existing registry entry for ${myUserId}. Creating.`);
        }

        const timestamp = now;
        const entryWithoutSig: Omit<SignedRegistryEntry, 'signature'> = {
            userId: myUserId,
            publicKey: myPublicKey,
            signingPublicKey: signingPublicKey || '',
            timestamp,
        };

        let signature = '';
        if (this.ctx.sign && signingPublicKey) {
            const payload = this.signPayload(entryWithoutSig);
            signature = Buffer.from(this.ctx.sign(payload)).toString('hex');
        } else {
            Logger.warn('Registry', 'Signing key not available — publishing unsigned entry.');
        }

        const entry: SignedRegistryEntry = { ...entryWithoutSig, signature };
        const data = new TextEncoder().encode(JSON.stringify(entry));

        try {
            await globalRemote.uploadFile(remotePath, data);
            this.lastRegistrationAt = now;
            Logger.info('Discovery', `Registered/Updated entry for ${myUserId}.`);
        } catch (e: any) {
            Logger.warn('Discovery', `Failed to upload registry entry: ${e.message}`);
        }
    }

    /**
     * Fetches and verifies the complete registry by reading all `users/*.json` entries.
     * Also reads the legacy `users.json` and merges entries (V2 takes priority for duplicates).
     */
    public async getPublicRegistry(): Promise<{ userId: string, publicKey: string }[]> {
        const globalRemote = this.ctx.getGlobalRemote();
        if (!globalRemote) return [];

        Logger.info('Discovery', 'Fetching public registry (per-user signed entries)...');

        const verifiedMap = new Map<string, { userId: string, publicKey: string }>();

        // 1. Load V2 per-user signed entries
        if (globalRemote.listFiles) {
            try {
                const entryPaths = await globalRemote.listFiles(REGISTRY_ENTRIES_PREFIX);
                const downloads = entryPaths.map(async (p) => {
                    try {
                        const result = await globalRemote.downloadFile(p, undefined, DEFAULTS.NETWORK_TIMEOUT);
                        if (!result?.data) return;
                        const entry: SignedRegistryEntry = JSON.parse(new TextDecoder().decode(result.data));
                        if (this.verifyEntry(entry)) {
                            verifiedMap.set(entry.userId, { userId: entry.userId, publicKey: entry.publicKey });
                        } else {
                            Logger.warn('Registry', `Dropping unverified entry for ${entry.userId}.`);
                        }
                    } catch (e) {
                        // Individual entry corrupt — skip it
                    }
                });
                await Promise.all(downloads);
            } catch (e: any) {
                Logger.warn('Discovery', `Could not list registry entries: ${e.message}`);
            }
        }

        // 2. Also load legacy users.json and merge (V2 entry takes priority for same userId)
        try {
            const result = await globalRemote.downloadFile(LEGACY_REGISTRY_PATH, undefined, DEFAULTS.NETWORK_TIMEOUT);
            if (result?.data) {
                const legacyList: { userId: string, publicKey: string }[] = JSON.parse(new TextDecoder().decode(result.data));
                for (const entry of legacyList) {
                    // Only add if not already present in V2 (V2 takes precedence)
                    if (!verifiedMap.has(entry.userId)) {
                        verifiedMap.set(entry.userId, { userId: entry.userId, publicKey: entry.publicKey });
                    }
                }
                Logger.debug('Discovery', `Merged ${legacyList.length} legacy users into registry.`);
            }
        } catch (e) {
            // Legacy registry absent — that's fine
        }

        return Array.from(verifiedMap.values());
    }

    public async updateFollowingPublicKeys() {
        try {
            const registry = await this.getPublicRegistry();
            const following = await this.ctx.storage.getFollowing();
            
            for (const user of registry) {
                const existing = following.find(f => f.userId === user.userId);
                if (existing && existing.publicKey !== user.publicKey) {
                    Logger.info('Discovery', `Updating public key for followed user ${user.userId}`);
                    await this.ctx.storage.followUser(user.userId, existing.lastSync, user.publicKey);
                }
            }
        } catch (e: any) {
            Logger.warn('Discovery', `Failed to update following public keys: ${e.message}`);
        }
    }

    public async discoverUsers(): Promise<{ userId: string, publicKey: string }[] | null> {
        const globalRemote = this.ctx.getGlobalRemote();
        if (!globalRemote) return null;

        try {
            const users = await this.getPublicRegistry();
            const blacklist = this.ctx.config.blacklist || [];
            return users.filter(u => !blacklist.includes(u.userId));
        } catch (e: any) {
            Logger.warn('Discovery', 'Failed to discover users', e.message);
            return null;
        }
    }

    public async autoFollowUsers(userList: { userId: string, publicKey: string }[]) {
        try {
            const following = await this.ctx.storage.getFollowing();
            const followingIds = following.map(u => u.userId);

            for (const user of userList) {
                if (user.userId !== this.ctx.config.paths.userId && !followingIds.includes(user.userId)) {
                    const startDate = new Date();
                    startDate.setUTCDate(startDate.getUTCDate() - 7);
                    const lastSyncStr = SovereignS3nc.getDateStr(startDate);
                    
                    Logger.info('Discovery', `Discovered new user ${user.userId}, starting from ${lastSyncStr}`);
                    await this.ctx.storage.followUser(user.userId, lastSyncStr, user.publicKey);
                }
            }
        } catch (e) {
            Logger.warn('Discovery', 'autoFollowUsers failed', e);
        }
    }
}
