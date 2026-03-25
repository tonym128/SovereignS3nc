
import { run } from '../src/admin';
import { ModerationModule } from '../src/modules/Moderation';
import { SovereignS3nc } from '../src/SovereignS3nc';
import * as fs from 'fs-extra';
import * as path from 'path';

jest.mock('../src/SovereignS3nc');
jest.mock('../src/modules/Moderation');
jest.mock('fs-extra');

describe('Admin CLI Unit Tests', () => {
    let mockSov: any;
    let mockModeration: any;
    const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '.';
    const CLI_DATA_DIR = path.join(HOME_DIR, '.sovereigns3nc-cli');

    beforeEach(() => {
        jest.clearAllMocks();
        mockSov = new SovereignS3nc({} as any);
        mockModeration = new ModerationModule(mockSov);
        
        (SovereignS3nc as unknown as jest.Mock).mockImplementation(() => mockSov);
        (ModerationModule as unknown as jest.Mock).mockImplementation(() => mockModeration);

        // Mock fs-extra
        (fs.pathExists as unknown as jest.Mock).mockResolvedValue(true);
        (fs.readJson as unknown as jest.Mock).mockImplementation((p) => {
            if (p.endsWith('current_user.json')) return Promise.resolve({ userId: 'admin' });
            if (p.endsWith('profiles.json')) return Promise.resolve({ 
                admin: { userId: 'admin', password: 'password', s3Config: {} } 
            });
            return Promise.reject(new Error('File not found'));
        });
        (fs.writeFile as unknown as jest.Mock).mockResolvedValue(undefined);
        (fs.readFile as unknown as jest.Mock).mockResolvedValue('{}');
    });

    test('list-users calls listUsers and logs them', async () => {
        mockModeration.listUsers.mockResolvedValue(['user1', 'user2']);
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        
        await run(['list-users']);
        
        expect(mockModeration.listUsers).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('user1'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('user2'));
        consoleSpy.mockRestore();
    });

    test('list-files calls listFiles with prefix and logs them', async () => {
        mockModeration.listFiles.mockResolvedValue(['file1.db', 'file2.db']);
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        
        await run(['list-files', 'some-prefix']);
        
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
        await run(['list-reports']);
        
        expect(mockModeration.getReports).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Pending Reports (1)'));
        consoleSpy.mockRestore();
    });

    test('ban-user calls banUser', async () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        await run(['ban-user', 'user123']);
        
        expect(mockModeration.banUser).toHaveBeenCalledWith('user123');
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('User user123 has been banned'));
        consoleSpy.mockRestore();
    });

    test('backup calls exportAllData and writes to file', async () => {
        mockModeration.exportAllData.mockResolvedValue('{"foo":"bar"}');
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        
        await run(['backup', 'my-backup.json']);
        
        expect(mockModeration.exportAllData).toHaveBeenCalled();
        expect(fs.writeFile as unknown as jest.Mock).toHaveBeenCalledWith('my-backup.json', '{"foo":"bar"}');
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('exported to my-backup.json'));
        consoleSpy.mockRestore();
    });

    test('restore calls importAllData', async () => {
        (fs.readFile as unknown as jest.Mock).mockResolvedValue('{"data":"dump"}');
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        
        await run(['restore', 'my-restore.json']);
        
        expect(fs.readFile as unknown as jest.Mock).toHaveBeenCalledWith('my-restore.json', 'utf8');
        expect(mockModeration.importAllData).toHaveBeenCalledWith('{"data":"dump"}');
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('imported successfully'));
        consoleSpy.mockRestore();
    });

    test('reset calls burnItToTheGround', async () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        
        await run(['reset']);
        
        expect(mockModeration.burnItToTheGround).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Operation complete'));
        consoleSpy.mockRestore();
    });

    test('burn-it-to-the-ground calls burnItToTheGround', async () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        
        await run(['burn-it-to-the-ground']);
        
        expect(mockModeration.burnItToTheGround).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Operation complete'));
        consoleSpy.mockRestore();
    });
});
