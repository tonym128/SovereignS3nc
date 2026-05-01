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
const admin_1 = require("../src/admin");
const Moderation_1 = require("../src/modules/Moderation");
const SovereignS3nc_1 = require("../src/SovereignS3nc");
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
jest.mock('../src/SovereignS3nc');
jest.mock('../src/modules/Moderation');
jest.mock('fs-extra');
describe('Admin CLI Unit Tests', () => {
    let mockSov;
    let mockModeration;
    const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '.';
    const CLI_DATA_DIR = path.join(HOME_DIR, '.sovereigns3nc-cli');
    beforeEach(() => {
        jest.clearAllMocks();
        mockSov = new SovereignS3nc_1.SovereignS3nc({});
        mockModeration = new Moderation_1.ModerationModule(mockSov);
        SovereignS3nc_1.SovereignS3nc.mockImplementation(() => mockSov);
        Moderation_1.ModerationModule.mockImplementation(() => mockModeration);
        // Mock fs-extra
        fs.pathExists.mockResolvedValue(true);
        fs.readJson.mockImplementation((p) => {
            if (p.endsWith('current_user.json'))
                return Promise.resolve({ userId: 'admin' });
            if (p.endsWith('profiles.json'))
                return Promise.resolve({
                    admin: { userId: 'admin', password: 'password', s3Config: {} }
                });
            return Promise.reject(new Error('File not found'));
        });
        fs.writeFile.mockResolvedValue(undefined);
        fs.readFile.mockResolvedValue('{}');
    });
    test('list-users calls listUsers and logs them', async () => {
        mockModeration.listUsers.mockResolvedValue(['user1', 'user2']);
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        await (0, admin_1.run)(['list-users']);
        expect(mockModeration.listUsers).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('user1'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('user2'));
        consoleSpy.mockRestore();
    });
    test('list-files calls listFiles with prefix and logs them', async () => {
        mockModeration.listFiles.mockResolvedValue(['file1.db', 'file2.db']);
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        await (0, admin_1.run)(['list-files', 'some-prefix']);
        expect(mockModeration.listFiles).toHaveBeenCalledWith('some-prefix');
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('file1.db'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('file2.db'));
        consoleSpy.mockRestore();
    });
    test('list-reports calls getReports and logs them', async () => {
        const mockReports = [
            { id: '1', reporterId: 'u1', targetUserId: 'u2', contentType: 'post', reason: 'spam' }
        ];
        mockModeration.getReports.mockResolvedValue(mockReports);
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        await (0, admin_1.run)(['list-reports']);
        expect(mockModeration.getReports).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Pending Reports (1)'));
        consoleSpy.mockRestore();
    });
    test('ban-user calls banUser', async () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        await (0, admin_1.run)(['ban-user', 'user123']);
        expect(mockModeration.banUser).toHaveBeenCalledWith('user123');
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('User user123 has been banned'));
        consoleSpy.mockRestore();
    });
    test('backup calls exportAllData and writes to file', async () => {
        mockModeration.exportAllData.mockResolvedValue('{"foo":"bar"}');
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        await (0, admin_1.run)(['backup', 'my-backup.json']);
        expect(mockModeration.exportAllData).toHaveBeenCalled();
        expect(fs.writeFile).toHaveBeenCalledWith('my-backup.json', '{"foo":"bar"}');
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('exported to my-backup.json'));
        consoleSpy.mockRestore();
    });
    test('restore calls importAllData', async () => {
        fs.readFile.mockResolvedValue('{"data":"dump"}');
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        await (0, admin_1.run)(['restore', 'my-restore.json']);
        expect(fs.readFile).toHaveBeenCalledWith('my-restore.json', 'utf8');
        expect(mockModeration.importAllData).toHaveBeenCalledWith('{"data":"dump"}');
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('imported successfully'));
        consoleSpy.mockRestore();
    });
    test('reset calls burnItToTheGround', async () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        await (0, admin_1.run)(['reset']);
        expect(mockModeration.burnItToTheGround).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Operation complete'));
        consoleSpy.mockRestore();
    });
    test('burn-it-to-the-ground calls burnItToTheGround', async () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        await (0, admin_1.run)(['burn-it-to-the-ground']);
        expect(mockModeration.burnItToTheGround).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Operation complete'));
        consoleSpy.mockRestore();
    });
});
//# sourceMappingURL=admin_cli.unit.test.js.map