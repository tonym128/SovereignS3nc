
import { ProfileModule, Profile } from '../src/modules/Profile';
import { SovereignS3nc } from '../src/SovereignS3nc';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import { IDBFactory } from 'fake-indexeddb';
import crypto from 'crypto';

// --- Polyfills ---
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;

class MockRemote implements IRemoteAdapter {
    files: Map<string, {data: Uint8Array, hash: string, etag: string}> = new Map();
    async uploadFile(path: string, data: Uint8Array): Promise<string | null> {
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(path, { data, hash: '', etag });
        return etag;
    }
    async downloadFile(path: string, ifNoneMatch?: string): Promise<any | null> {
        const entry = this.files.get(path);
        if (!entry) return null;
        if (ifNoneMatch === entry.etag) return { data: null, etag: entry.etag, notModified: true };
        return { data: entry.data, etag: entry.etag };
    }
    async getFileHash(path: string): Promise<string | null> { return null; }
    async getFileEtag(path: string): Promise<string | null> { return this.files.get(path)?.etag || null; }
    async canWrite(path: string): Promise<boolean> { return true; }
    async listFiles(prefix: string): Promise<string[]> {
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }
    async deleteFile(path: string): Promise<void> { this.files.delete(path); }
}

describe('ProfileModule Unit Tests', () => {
    let sov: SovereignS3nc;
    let profileModule: ProfileModule;
    let mockRemote: MockRemote;

    beforeEach(async () => {
        (global as any).indexedDB = new IDBFactory();
        mockRemote = new MockRemote();
        sov = new SovereignS3nc({
            paths: { appId: 'test-app', userId: 'alice', storeId: 'main' },
            password: 'password123'
        }, mockRemote);
        await sov.init();
        profileModule = new ProfileModule(sov);
    });

    test('updateProfile should save profile and emit event', async () => {
        const emitSpy = jest.spyOn(sov, 'emit');
        await profileModule.updateProfile('Alice Doe', 'Web3 Enthusiast');

        const profileData = await sov.getStorage().getPublicUserFile();
        expect(profileData).toBeDefined();
        const profile: Profile = JSON.parse(new TextDecoder().decode(profileData!));
        expect(profile.name).toBe('Alice Doe');
        expect(profile.bio).toBe('Web3 Enthusiast');
        expect(profile.userId).toBe('alice');

        expect(emitSpy).toHaveBeenCalledWith('profile:update', expect.objectContaining({ path: 'public/user.json' }));
    });

    test('getProfile should return my own profile', async () => {
        await profileModule.updateProfile('Alice', 'Bio');
        const profile = await profileModule.getProfile();
        expect(profile?.name).toBe('Alice');
    });

    test('getProfile should return null if no profile exists', async () => {
        const profile = await profileModule.getProfile();
        expect(profile).toBeNull();
    });

    test('follow/unfollow should delegate to core', async () => {
        const followSpy = jest.spyOn(sov, 'follow').mockResolvedValue(undefined);
        const unfollowSpy = jest.spyOn(sov, 'unfollow').mockResolvedValue(undefined);
        
        // Mock syncOtherProfiles so it doesn't try to download things during test
        jest.spyOn(profileModule, 'syncOtherProfiles').mockResolvedValue(undefined);

        await profileModule.follow('bob');
        expect(followSpy).toHaveBeenCalledWith('bob');

        await profileModule.unfollow('bob');
        expect(unfollowSpy).toHaveBeenCalledWith('bob');
    });

    test('syncOtherProfiles should download and save followed profiles', async () => {
        // Mock following bob
        jest.spyOn(sov, 'getFollowing').mockResolvedValue([{ userId: 'bob', lastSync: '', publicKey: 'pubkey' }]);
        
        // Mock Bob's profile on his remote
        const bobProfile: Profile = { userId: 'bob', name: 'Bob Smith', bio: 'Builder', updatedAt: Date.now() };
        const bobData = new TextEncoder().encode(JSON.stringify(bobProfile));
        
        const bobRemote = new MockRemote();
        await bobRemote.uploadFile('public/user.json', bobData);
        
        // Mock createRemote to return bobRemote for bob
        jest.spyOn(sov as any, 'createRemote').mockImplementation((userId: string) => {
            if (userId === 'bob') return bobRemote;
            return new MockRemote();
        });

        await profileModule.syncOtherProfiles();

        const path = sov.getModulePath('profile', 'bob/profile', 'followed');
        const savedData = await sov.getStorage().getFile(path);
        expect(savedData).toBeDefined();
        const savedProfile: Profile = JSON.parse(new TextDecoder().decode(savedData!));
        expect(savedProfile.name).toBe('Bob Smith');
    });

    test('syncOtherProfiles should handle decryption if profile is encrypted', async () => {
        jest.spyOn(sov, 'getFollowing').mockResolvedValue([{ userId: 'bob', lastSync: '', publicKey: 'pubkey' }]);
        
        const bobProfile: Profile = { userId: 'bob', name: 'Secret Bob', bio: 'Hidden', updatedAt: Date.now() };
        const bobData = new TextEncoder().encode(JSON.stringify(bobProfile));
        
        const encryptedData = new Uint8Array([1, 2, 3]); // Mock encrypted data
        const bobRemote = new MockRemote();
        await bobRemote.uploadFile('public/user.json', encryptedData);
        
        jest.spyOn(sov as any, 'createRemote').mockImplementation(() => bobRemote);
        const decryptSpy = jest.spyOn(sov, 'decrypt').mockResolvedValue(bobData);

        await profileModule.syncOtherProfiles();

        expect(decryptSpy).toHaveBeenCalled();
        const path = sov.getModulePath('profile', 'bob/profile', 'followed');
        const savedData = await sov.getStorage().getFile(path);
        expect(JSON.parse(new TextDecoder().decode(savedData!)).name).toBe('Secret Bob');
    });
});
