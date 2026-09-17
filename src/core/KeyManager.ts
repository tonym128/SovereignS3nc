import * as nacl from 'tweetnacl';
import * as crypto from 'crypto';
import { SovereignConfig, GroupMember } from '../types';
import { IStorage } from '../interfaces/IStorage';
import { IRemoteAdapter } from '../interfaces/IRemoteAdapter';
import { Logger } from '../utils/Logger';
import { S3RemoteAdapter } from '../adapters/S3RemoteAdapter';
import { PATHS, DEFAULTS } from '../utils/Constants';
import { AuthError } from '../utils/Errors';

export interface KeyManagerContext {
    config: SovereignConfig;
    storage: IStorage;
    getRemote: () => IRemoteAdapter | undefined;
    setRemote: (remote: IRemoteAdapter) => void;
    getPublicRemote: () => IRemoteAdapter | undefined;
    getAdminRemote: () => IRemoteAdapter | undefined;
    remoteFactory?: (userId: string) => IRemoteAdapter;
    createRemote: (userId: string, isPrivate?: boolean) => IRemoteAdapter;
}

export class KeyManager {
    constructor(private ctx: KeyManagerContext) {}

    private async pbkdf2(password: string, salt: Buffer | string, iterations: number): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const saltBuffer = typeof salt === 'string' ? Buffer.from(salt) : salt;
            crypto.pbkdf2(password, saltBuffer, iterations, 32, 'sha256', (err, derivedKey) => {
                if (err) reject(err);
                else resolve(derivedKey);
            });
        });
    }

    public calculateHashedContent(data: Uint8Array, key?: string): string {
        const hasher = crypto.createHash('sha256').update(data);
        if (key) hasher.update(key); // Salt hash with key
        return hasher.digest('hex');
    }

    public async encrypt(data: Uint8Array, key: string): Promise<Uint8Array> {
        const iv = crypto.randomBytes(12);
        const keyBuffer = Buffer.from(key, 'hex').slice(0, 32);
        const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
        const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([iv, tag, encrypted]);
    }

    public async decrypt(data: Uint8Array, key: string): Promise<Uint8Array> {
        try {
            const iv = data.slice(0, 12);
            const tag = data.slice(12, 28);
            const encrypted = data.slice(28);
            const keyBuffer = Buffer.from(key, 'hex').slice(0, 32);
            const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
            decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(encrypted), decipher.final()]);
        } catch (e: any) {
            throw new AuthError(`Decryption failed (key: ${key.substring(0, 6)}...): ${e.message}`);
        }
    }

    /**
     * Derives a shared secret from the local private key and a remote public key using X25519,
     * then applies HKDF-SHA256 for proper domain separation before returning the hex-encoded AES key.
     *
     * @param otherPublicKey - Hex-encoded X25519 public key of the remote party.
     * @param context - HKDF info label for domain separation. Defaults to 'SovereignS3nc-DM-v2'.
     *                  Pass 'SovereignS3nc-DM-v1-raw' to obtain the legacy (raw) derived secret
     *                  for decrypting data encrypted before HKDF was introduced.
     */
    public deriveSharedSecret(otherPublicKey: string, context: string = 'SovereignS3nc-DM-v2'): string {
        if (!this.ctx.config.encryptionKey) throw new AuthError('Identity key not initialized');
        
        const mySecretKey = Buffer.from(this.ctx.config.encryptionKey, 'hex');
        const theirPublicKey = Buffer.from(otherPublicKey, 'hex');
        
        if (theirPublicKey.length !== 32) {
            throw new AuthError(`Invalid public key size: expected 32 bytes, got ${theirPublicKey.length}. Key: ${otherPublicKey.substring(0, 10)}...`);
        }

        const rawShared = nacl.box.before(theirPublicKey, mySecretKey);

        // Legacy path: return raw shared secret for backward-compat decryption of old data.
        if (context === 'SovereignS3nc-DM-v1-raw') {
            return Buffer.from(rawShared).toString('hex');
        }

        // V2: Apply HKDF-SHA256 for proper domain separation.
        // Salt is omitted (zero-length) as per RFC 5869 §2.2 — the X25519 output already has
        // high entropy. The info label provides domain separation across use cases.
        const derived = crypto.hkdfSync(
            'sha256',
            rawShared,
            Buffer.alloc(0),  // zero-length salt
            Buffer.from(context, 'utf8'), // info / domain label
            32  // 32 bytes = 256-bit AES key
        );
        return Buffer.from(derived).toString('hex');
    }

    /**
     * Derives a forward-secret shared key for sending a message using an ephemeral X25519 keypair.
     * The ephemeral private key is used with the recipient's public key to derive an AES key via HKDF,
     * and the ephemeral private key is immediately wiped from memory.
     *
     * @param recipientPublicKey - Hex-encoded X25519 public key of the recipient.
     * @param context - HKDF info label. Defaults to 'SovereignS3nc-DM-v3-ephemeral'.
     * @returns Object containing the hex-encoded ephemeral public key (to be sent alongside ciphertext)
     *          and the derived AES-256 key hex.
     */
    public deriveEphemeralSharedSecret(recipientPublicKey: string, context: string = 'SovereignS3nc-DM-v3-ephemeral'): { ephemeralPublicKey: string; sharedSecret: string } {
        const theirPublicKey = Buffer.from(recipientPublicKey, 'hex');
        if (theirPublicKey.length !== 32) {
            throw new AuthError(`Invalid public key size: expected 32 bytes, got ${theirPublicKey.length}. Key: ${recipientPublicKey.substring(0, 10)}...`);
        }

        const eph = nacl.box.keyPair();
        try {
            const rawShared = nacl.box.before(theirPublicKey, eph.secretKey);
            const derived = crypto.hkdfSync(
                'sha256',
                rawShared,
                Buffer.alloc(0),
                Buffer.from(context, 'utf8'),
                32
            );
            return {
                ephemeralPublicKey: Buffer.from(eph.publicKey).toString('hex'),
                sharedSecret: Buffer.from(derived).toString('hex')
            };
        } finally {
            // Zero out ephemeral secret key in memory to guarantee forward secrecy
            eph.secretKey.fill(0);
        }
    }

    /**
     * Derives the forward-secret shared key on the recipient side using the received ephemeral public key
     * and the recipient's private identity key.
     *
     * @param ephemeralPublicKey - Hex-encoded X25519 ephemeral public key from the sender.
     * @param context - HKDF info label. Defaults to 'SovereignS3nc-DM-v3-ephemeral'.
     * @returns Hex-encoded derived AES-256 key.
     */
    public deriveRecipientSharedSecret(ephemeralPublicKey: string, context: string = 'SovereignS3nc-DM-v3-ephemeral'): string {
        if (!this.ctx.config.encryptionKey) throw new AuthError('Identity key not initialized');

        const mySecretKey = Buffer.from(this.ctx.config.encryptionKey, 'hex');
        const ephPublicKey = Buffer.from(ephemeralPublicKey, 'hex');

        if (ephPublicKey.length !== 32) {
            throw new AuthError(`Invalid ephemeral public key size: expected 32 bytes, got ${ephPublicKey.length}. Key: ${ephemeralPublicKey.substring(0, 10)}...`);
        }

        const rawShared = nacl.box.before(ephPublicKey, mySecretKey);
        const derived = crypto.hkdfSync(
            'sha256',
            rawShared,
            Buffer.alloc(0),
            Buffer.from(context, 'utf8'),
            32
        );
        return Buffer.from(derived).toString('hex');
    }

    public getHashedUserId(userId: string, isPrivate: boolean): string {
        if (!isPrivate || userId === 'global' || userId === 'admin' || userId === '' || userId === 'root') {
            return userId; 
        }
        
        const appId = this.ctx.config.paths.appId;
        const secret = this.ctx.config.auth?.serverSecret || this.ctx.config.password || '';
        
        if (!secret) {
            return userId; 
        }

        const hasher = crypto.createHash('sha256');
        hasher.update(userId);
        hasher.update(appId);
        hasher.update(secret);
        
        return hasher.digest('hex');
    }

    public async initKeys() {
        const password = this.ctx.config.password!;
        const publicUserId = this.ctx.config.paths.userId;
        const appId = this.ctx.config.paths.appId;
        
        Logger.info('Keys', 'Step 1: Initializing keys...');
        
        // --- V2 Derivation (Secure) ---
        const v2PrivateId = (await this.pbkdf2(password, publicUserId + '-private-id', DEFAULTS.PBKDF2_ITERATIONS)).toString('hex');
        
        // Attempt to find existing sentinel to determine version
        const sentinelPath = `${PATHS.PRIVATE_PREFIX}${PATHS.SENTINEL}`;
        let sentinelData = await this.ctx.storage.getFile(sentinelPath);
        
        // Try Private Remote with V2 ID
        if (!this.ctx.getRemote() && (this.ctx.config.s3 || this.ctx.remoteFactory)) {
            try {
                if (!this.ctx.remoteFactory && this.ctx.config.s3) {
                    this.ctx.setRemote(new S3RemoteAdapter(this.ctx.config.s3, {
                        appId: appId,
                        userId: v2PrivateId,
                        storeId: this.ctx.config.paths.storeId
                    }));
                } else if (this.ctx.remoteFactory) {
                    this.ctx.setRemote(this.ctx.remoteFactory(v2PrivateId));
                }
            } catch (e) {}
        }

        let remote = this.ctx.getRemote();
        if (!sentinelData && remote) {
            try {
                const result = await remote.downloadFile(PATHS.SENTINEL);
                if (result && result.data) sentinelData = result.data;
            } catch (e) {}
        }

        let masterKey: Buffer | null = null;
        let privateId = v2PrivateId;
        let isLegacy = false;

        if (sentinelData) {
            // Check if it's V2 (has salt prefix)
            if (sentinelData.length > DEFAULTS.SALT_SIZE) {
                const salt = Buffer.from(sentinelData.slice(0, DEFAULTS.SALT_SIZE));
                const encrypted = sentinelData.slice(DEFAULTS.SALT_SIZE);
                const derived = await this.pbkdf2(password, salt, DEFAULTS.PBKDF2_ITERATIONS);
                
                try {
                    const decrypted = await this.decrypt(encrypted, derived.toString('hex'));
                    if (new TextDecoder().decode(decrypted) === 'SovereignSentinel') {
                        masterKey = derived;
                        Logger.info('Keys', 'Verified V2 keys.');
                    }
                } catch (e) {}
            }

            // Fallback to Legacy if V2 failed
            if (!masterKey) {
                const legacyMasterKey = crypto.pbkdf2Sync(password, publicUserId + '-master', 1000, 32, 'sha256');
                const legacyPrivateId = crypto.pbkdf2Sync(password, publicUserId + '-private-id', 1000, 32, 'sha256').toString('hex');
                
                try {
                    const decrypted = await this.decrypt(sentinelData, legacyMasterKey.toString('hex'));
                    if (new TextDecoder().decode(decrypted) === 'SovereignSentinel') {
                        masterKey = legacyMasterKey;
                        privateId = legacyPrivateId;
                        isLegacy = true;
                        Logger.warn('Keys', 'Detected Legacy (1000 iterations) keys. Migration is recommended.');
                        
                        // If we are legacy, we need to point the remote to the legacy ID
                        if (remote && privateId !== v2PrivateId) {
                            if (!this.ctx.remoteFactory && this.ctx.config.s3) {
                                this.ctx.setRemote(new S3RemoteAdapter(this.ctx.config.s3, {
                                    appId: appId,
                                    userId: privateId,
                                    storeId: this.ctx.config.paths.storeId
                                }));
                            } else if (this.ctx.remoteFactory) {
                                this.ctx.setRemote(this.ctx.remoteFactory(privateId));
                            }
                            remote = this.ctx.getRemote();
                        }
                    }
                } catch (e) {}
            }
        }

        if (sentinelData && !masterKey) {
            throw new AuthError('Incorrect password. Access denied.');
        }

        // New account or migration
        if (!masterKey) {
            Logger.info('Keys', 'Creating new V2 secure keys...');
            const salt = crypto.randomBytes(DEFAULTS.SALT_SIZE);
            masterKey = await this.pbkdf2(password, salt, DEFAULTS.PBKDF2_ITERATIONS);
            
            const sentinelContent = new TextEncoder().encode('SovereignSentinel');
            const encryptedSentinel = await this.encrypt(sentinelContent, masterKey.toString('hex'));
            sentinelData = Buffer.concat([salt, encryptedSentinel]);
            await this.ctx.storage.saveFile(sentinelPath, sentinelData);
            
            if (remote) {
                try {
                    await remote.uploadFile(PATHS.SENTINEL, sentinelData);
                } catch (e: any) {
                    Logger.warn('Keys', `Failed to upload new sentinel to remote: ${e.message}. Continuing in offline mode.`);
                }
            }
        }

        // --- Load Identity Keys ---
        let keyInfo: { privateKey: string, publicKey: string, signingPrivateKey?: string, signingPublicKey?: string } | null = null;
        let localKeyData: Uint8Array | null = null;
        try {
            localKeyData = await this.ctx.storage.getDailyDb('_keys', 'private'); 
        } catch (e) {}
        
        if (localKeyData) {
            try {
                // Check if local keys are V2
                if (localKeyData.length > DEFAULTS.SALT_SIZE) {
                    const salt = Buffer.from(localKeyData.slice(0, DEFAULTS.SALT_SIZE));
                    const encrypted = localKeyData.slice(DEFAULTS.SALT_SIZE);
                    const derived = await this.pbkdf2(password, salt, DEFAULTS.PBKDF2_ITERATIONS);
                    const decrypted = await this.decrypt(encrypted, derived.toString('hex'));
                    keyInfo = JSON.parse(decrypted.toString());
                } else {
                    // Legacy local keys
                    const decrypted = await this.decrypt(localKeyData, masterKey.toString('hex'));
                    keyInfo = JSON.parse(decrypted.toString());
                }
            } catch (e) {
                Logger.warn('Keys', 'Failed to decrypt local keys.');
            }
        }

        if (!keyInfo && remote) {
            try {
                const result = await remote.downloadFile(PATHS.KEYS);
                if (result && result.data) {
                    if (result.data.length > DEFAULTS.SALT_SIZE) {
                        const salt = Buffer.from(result.data.slice(0, DEFAULTS.SALT_SIZE));
                        const encrypted = result.data.slice(DEFAULTS.SALT_SIZE);
                        const derived = await this.pbkdf2(password, salt, DEFAULTS.PBKDF2_ITERATIONS);
                        const decrypted = await this.decrypt(encrypted, derived.toString('hex'));
                        keyInfo = JSON.parse(decrypted.toString());
                    } else {
                        const decrypted = await this.decrypt(result.data, masterKey.toString('hex'));
                        keyInfo = JSON.parse(decrypted.toString());
                    }
                }
            } catch (e) {}
        }

        if (!keyInfo) {
            const pair = nacl.box.keyPair();
            const signPair = nacl.sign.keyPair();
            keyInfo = { 
                privateKey: Buffer.from(pair.secretKey).toString('hex'), 
                publicKey: Buffer.from(pair.publicKey).toString('hex'),
                signingPrivateKey: Buffer.from(signPair.secretKey).toString('hex'),
                signingPublicKey: Buffer.from(signPair.publicKey).toString('hex')
            };
        }

        // Migration: ensure signing keys exist for existing accounts
        if (!keyInfo.signingPrivateKey) {
            // Deterministically derive signing key from encryption key to avoid losing access to old data
            // but for P2P it doesn't matter much as long as it is consistent.
            // Better: use encryption private key as seed if possible.
            const seed = Buffer.from(keyInfo.privateKey, 'hex');
            const signPair = nacl.sign.keyPair.fromSeed(seed);
            keyInfo.signingPrivateKey = Buffer.from(signPair.secretKey).toString('hex');
            keyInfo.signingPublicKey = Buffer.from(signPair.publicKey).toString('hex');
        }

        // Ensure keys are stored in V2 format locally
        const salt = crypto.randomBytes(DEFAULTS.SALT_SIZE);
        const derived = await this.pbkdf2(password, salt, DEFAULTS.PBKDF2_ITERATIONS);
        const encryptedKeys = await this.encrypt(Buffer.from(JSON.stringify(keyInfo)), derived.toString('hex'));
        const v2KeyData = Buffer.concat([salt, encryptedKeys]);
        await this.ctx.storage.saveDailyDb('_keys', 'private', v2KeyData);
        
        if (remote) {
            try {
                await remote.uploadFile(PATHS.KEYS, v2KeyData);
            } catch (e) {}
        }

        this.ctx.config.encryptionKey = keyInfo.privateKey;
        this.ctx.config.publicEncryptionKey = keyInfo.publicKey;
        (this.ctx.config as any).signingPrivateKey = keyInfo.signingPrivateKey;
        (this.ctx.config as any).signingPublicKey = keyInfo.signingPublicKey;
        
        Logger.info('Keys', `Identity initialized (${isLegacy ? 'Legacy' : 'V2'}).`);
    }

    public sign(data: Uint8Array): Uint8Array {
        const signingPrivateKey = (this.ctx.config as any).signingPrivateKey;
        if (!signingPrivateKey) throw new AuthError('Signing key not initialized');
        return nacl.sign.detached(data, Buffer.from(signingPrivateKey, 'hex'));
    }

    public verify(data: Uint8Array, signature: Uint8Array, publicKey: string): boolean {
        try {
            return nacl.sign.detached.verify(data, signature, Buffer.from(publicKey, 'hex'));
        } catch (e) {
            return false;
        }
    }

    public async ensureKeysAreRemote() {
        const password = this.ctx.config.password!;
        const remote = this.ctx.getRemote();
        if (!remote || !password || !this.ctx.config.encryptionKey) return;

        try {
            const check = await remote.downloadFile(PATHS.KEYS);
            if (!check || !check.data) {
                const keyInfo = { 
                    privateKey: this.ctx.config.encryptionKey, 
                    publicKey: this.ctx.config.publicEncryptionKey 
                };
                const salt = crypto.randomBytes(DEFAULTS.SALT_SIZE);
                const derived = await this.pbkdf2(password, salt, DEFAULTS.PBKDF2_ITERATIONS);
                const encrypted = await this.encrypt(Buffer.from(JSON.stringify(keyInfo)), derived.toString('hex'));
                await remote.uploadFile(PATHS.KEYS, Buffer.concat([salt, encrypted]));
            }
        } catch (e) {}
    }

    public async changePassword(oldPassword: string, newPassword: string): Promise<void> {
        if (!this.ctx.config.password || this.ctx.config.password !== oldPassword) {
            throw new AuthError('Incorrect old password.');
        }

        const publicUserId = this.ctx.config.paths.userId;
        
        // 1. Derive new V2 Private ID
        const newPrivateId = (await this.pbkdf2(newPassword, publicUserId + '-private-id', DEFAULTS.PBKDF2_ITERATIONS)).toString('hex');

        // 2. Create new V2 Sentinel
        const newMasterKeySalt = crypto.randomBytes(DEFAULTS.SALT_SIZE);
        const newMasterKey = await this.pbkdf2(newPassword, newMasterKeySalt, DEFAULTS.PBKDF2_ITERATIONS);
        
        const sentinelPath = `${PATHS.PRIVATE_PREFIX}${PATHS.SENTINEL}`;
        const sentinelContent = new TextEncoder().encode('SovereignSentinel');
        const encryptedSentinel = await this.encrypt(sentinelContent, newMasterKey.toString('hex'));
        const v2Sentinel = Buffer.concat([newMasterKeySalt, encryptedSentinel]);
        await this.ctx.storage.saveFile(sentinelPath, v2Sentinel);

        // 3. Re-encrypt Identity Keys for new password (V2 format)
        if (!this.ctx.config.encryptionKey || !this.ctx.config.publicEncryptionKey) {
            throw new AuthError('Identity keys are not loaded in memory.');
        }
        const keyInfo = { 
            privateKey: this.ctx.config.encryptionKey, 
            publicKey: this.ctx.config.publicEncryptionKey 
        };
        
        const keysSalt = crypto.randomBytes(DEFAULTS.SALT_SIZE);
        const keysDerivedKey = await this.pbkdf2(newPassword, keysSalt, DEFAULTS.PBKDF2_ITERATIONS);
        const encryptedKeys = await this.encrypt(Buffer.from(JSON.stringify(keyInfo)), keysDerivedKey.toString('hex'));
        const v2Keys = Buffer.concat([keysSalt, encryptedKeys]);
        await this.ctx.storage.saveDailyDb('_keys', 'private', v2Keys);

        // 4. Migrate Remote Data
        const remote = this.ctx.getRemote();
        if (remote) {
            let newRemote: IRemoteAdapter | undefined;
            try {
                newRemote = this.ctx.createRemote(newPrivateId, true);
            } catch (e: any) {
                Logger.error('Keys', `Failed to create new remote adapter for migration: ${e.message}`);
                throw new AuthError('Failed to create new remote adapter for migration.');
            }

            if (newRemote) {
                await newRemote.uploadFile(PATHS.KEYS, v2Keys);
                await newRemote.uploadFile(PATHS.SENTINEL, v2Sentinel);

                if (remote.listFiles) {
                    const files = await remote.listFiles('');
                    for (const file of files) {
                        if (file === PATHS.KEYS || file === PATHS.SENTINEL) continue;
                        const result = await remote.downloadFile(file);
                        if (result && result.data) {
                            await newRemote.uploadFile(file, result.data);
                        }
                    }
                    
                    if (remote.purge) {
                        await remote.purge();
                    } else if ((remote as any).deleteFile) {
                        for (const file of files) {
                            await (remote as any).deleteFile(file);
                        }
                    }
                }
                
                this.ctx.setRemote(newRemote);
            }
        }

        this.ctx.config.password = newPassword;
    }

    public async syncAdminKey() {
        const adminRemote = this.ctx.getAdminRemote();
        if (!adminRemote) return;
        try {
            const result = await adminRemote.downloadFile(PATHS.ADMIN_PUBLIC_KEY);
            if (result && result.data) {
                const data = JSON.parse(new TextDecoder().decode(result.data));
                this.ctx.config.adminPublicKey = data.publicKey;
                Logger.info('Sync', 'Discovered Admin Public Key.');
            }
        } catch (e) {
            // No admin key found, which is fine
        }
    }

    /**
     * Rotates persistent identity keys independently of password.
     * Encrypts the new keypair with the master key and updates local/remote storage.
     */
    public async rotateIdentityKeys(newKeyPair?: { privateKey: string, publicKey: string }): Promise<{ privateKey: string, publicKey: string }> {
        if (!this.ctx.config.password) {
            throw new AuthError('Password is required to rotate identity keys.');
        }

        let privateKey: string;
        let publicKey: string;
        if (newKeyPair) {
            privateKey = newKeyPair.privateKey;
            publicKey = newKeyPair.publicKey;
        } else {
            const kp = nacl.box.keyPair();
            privateKey = Buffer.from(kp.secretKey).toString('hex');
            publicKey = Buffer.from(kp.publicKey).toString('hex');
        }

        const keyInfo = { privateKey, publicKey };

        const keysSalt = crypto.randomBytes(DEFAULTS.SALT_SIZE);
        const keysDerivedKey = await this.pbkdf2(this.ctx.config.password, keysSalt, DEFAULTS.PBKDF2_ITERATIONS);
        const encryptedKeys = await this.encrypt(Buffer.from(JSON.stringify(keyInfo)), keysDerivedKey.toString('hex'));
        const v2Keys = Buffer.concat([keysSalt, encryptedKeys]);

        await this.ctx.storage.saveDailyDb('_keys', 'private', v2Keys);

        this.ctx.config.encryptionKey = privateKey;
        this.ctx.config.publicEncryptionKey = publicKey;

        const remote = this.ctx.getRemote();
        if (remote) {
            await remote.uploadFile(PATHS.KEYS, v2Keys);
        }

        Logger.info('Keys', `Successfully rotated identity keys for ${this.ctx.config.paths.userId}`);
        return { privateKey, publicKey };
    }
}
