"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const cli_1 = require("../src/cli");
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const SovereignS3nc_1 = require("../src/SovereignS3nc");
// Mock S3/Remote
jest.mock('../src/adapters/S3RemoteAdapter');
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '.';
const CLI_DATA_DIR = path.join(HOME_DIR, '.sovereigns3nc-cli');
describe('CLI Integration Tests', () => {
    let consoleSpy;
    beforeEach(async () => {
        if (await fs.pathExists(CLI_DATA_DIR)) {
            await fs.remove(CLI_DATA_DIR);
        }
        consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
        // Mock sync to avoid network
        jest.spyOn(SovereignS3nc_1.SovereignS3nc.prototype, 'sync').mockResolvedValue(undefined);
    });
    afterEach(() => {
        consoleSpy.mockRestore();
        jest.restoreAllMocks();
    });
    test('help command shows usage', async () => {
        await (0, cli_1.run)(['help']);
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('SovereignS3nc CLI - Usage:'));
    });
    test('account create initializes profile', async () => {
        await (0, cli_1.run)(['account', 'create', 'testuser', 'pass123', 'http://localhost:9000', 'key', 'secret', 'bucket']);
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
        await (0, cli_1.run)(['account', 'create', 'testuser', 'pass123', 'http://localhost:9000', 'key', 'secret', 'bucket']);
        // Logout
        await (0, cli_1.run)(['logout']);
        const currentPath = path.join(CLI_DATA_DIR, 'current_user.json');
        expect(await fs.pathExists(currentPath)).toBe(false);
        expect(consoleSpy).toHaveBeenCalledWith('Logged out.');
        // Login
        await (0, cli_1.run)(['login', 'testuser']);
        const current = await fs.readJson(currentPath);
        expect(current.userId).toBe('testuser');
        expect(consoleSpy).toHaveBeenCalledWith('Logged in as testuser');
    });
    test('profile update and show', async () => {
        await (0, cli_1.run)(['account', 'create', 'testuser', 'pass123', 'http://localhost:9000', 'key', 'secret', 'bucket']);
        await (0, cli_1.run)(['profile', 'update', 'Test Name', 'Test Bio']);
        expect(consoleSpy).toHaveBeenCalledWith('Profile updated.');
        await (0, cli_1.run)(['profile', 'show']);
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Name: Test Name'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Bio: Test Bio'));
    });
    test('post create and list', async () => {
        await (0, cli_1.run)(['account', 'create', 'testuser', 'pass123', 'http://localhost:9000', 'key', 'secret', 'bucket']);
        await (0, cli_1.run)(['post', 'create', 'Hello World']);
        expect(consoleSpy).toHaveBeenCalledWith('Post created.');
        await (0, cli_1.run)(['post', 'list']);
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Hello World'));
    });
    test('follow and following', async () => {
        await (0, cli_1.run)(['account', 'create', 'testuser', 'pass123', 'http://localhost:9000', 'key', 'secret', 'bucket']);
        await (0, cli_1.run)(['follow', 'otheruser']);
        expect(consoleSpy).toHaveBeenCalledWith('Following otheruser');
        await (0, cli_1.run)(['following']);
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('- otheruser'));
    });
});
//# sourceMappingURL=cli.test.js.map