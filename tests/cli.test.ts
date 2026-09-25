import { run } from '../src/cli';
import * as fs from 'fs-extra';
import * as path from 'path';
import { SovereignS3nc } from '../src/SovereignS3nc';

// Mock S3/Remote
jest.mock('../src/adapters/S3RemoteAdapter');

const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '.';
const CLI_DATA_DIR = path.join(HOME_DIR, '.sovereigns3nc-cli');

describe('CLI Integration Tests', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(async () => {
        if (await fs.pathExists(CLI_DATA_DIR)) {
            await fs.remove(CLI_DATA_DIR);
        }
        consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
        // Mock sync to avoid network
        jest.spyOn(SovereignS3nc.prototype, 'sync').mockResolvedValue(undefined as any);
    });

    afterEach(() => {
        consoleSpy.mockRestore();
        jest.restoreAllMocks();
    });

    test('help command shows usage', async () => {
        await run(['help']);
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('SovereignS3nc CLI - Usage:'));
    });

    test('account create initializes profile', async () => {
        await run(['account', 'create', 'testuser', 'pass123', 'http://localhost:9000', 'key', 'secret', 'bucket']);
        
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Account created and logged in as testuser'));
        
        const profilesPath = path.join(CLI_DATA_DIR, 'profiles.json');
        const profiles = await fs.readJson(profilesPath);
        expect(profiles.testuser).toBeDefined();
        expect(profiles.testuser.userId).toBe('testuser');
        
        const currentPath = path.join(CLI_DATA_DIR, 'current_user.json');
        const current = await fs.readJson(currentPath);
        expect(current.userId).toBe('testuser');
    });

    test('login and logout', async () => {
        // First create an account
        await run(['account', 'create', 'testuser', 'pass123', 'http://localhost:9000', 'key', 'secret', 'bucket']);
        
        // Logout
        await run(['logout']);
        const currentPath = path.join(CLI_DATA_DIR, 'current_user.json');
        expect(await fs.pathExists(currentPath)).toBe(false);
        expect(consoleSpy).toHaveBeenCalledWith('Logged out.');

        // Login
        await run(['login', 'testuser']);
        const current = await fs.readJson(currentPath);
        expect(current.userId).toBe('testuser');
        expect(consoleSpy).toHaveBeenCalledWith('Logged in as testuser');
    });

    test('profile update and show', async () => {
        await run(['account', 'create', 'testuser', 'pass123', 'http://localhost:9000', 'key', 'secret', 'bucket']);
        
        await run(['profile', 'update', 'Test Name', 'Test Bio']);
        expect(consoleSpy).toHaveBeenCalledWith('Profile updated.');

        await run(['profile', 'show']);
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Name: Test Name'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Bio: Test Bio'));
    });

    test('post create and list', async () => {
        await run(['account', 'create', 'testuser', 'pass123', 'http://localhost:9000', 'key', 'secret', 'bucket']);
        
        await run(['post', 'create', 'Hello World']);
        expect(consoleSpy).toHaveBeenCalledWith('Post created.');

        await run(['post', 'list']);
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Hello World'));
    });

    test('follow and following', async () => {
        await run(['account', 'create', 'testuser', 'pass123', 'http://localhost:9000', 'key', 'secret', 'bucket']);
        
        await run(['follow', 'otheruser']);
        expect(consoleSpy).toHaveBeenCalledWith('Following otheruser');

        await run(['following']);
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('- otheruser'));
    });
});
