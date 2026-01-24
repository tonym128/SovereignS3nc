
import { SovereignS3nc } from '../src/SovereignS3nc';
import { InMemoryStorage } from '../src/adapters/InMemoryStorage';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';

describe('SovereignS3nc Spinner Hang', () => {
  let db: SovereignS3nc;
  let mockRemote: IRemoteAdapter;

  beforeEach(async () => {
    const storage = new InMemoryStorage('test-user');
    await storage.init();
    
    mockRemote = {
      put: jest.fn(),
      get: jest.fn(),
      listChanges: jest.fn().mockRejectedValue(new Error('Simulated Network Error')),
      delete: jest.fn()
    };

    const config = {
      paths: { appId: 'app', userId: 'user', storeId: 'store' }
    };

    db = new SovereignS3nc(config, storage);
    db.remote = mockRemote; // Inject mock
  });

  test('should emit syncComplete even if sync fails', async () => {
    const onSyncStart = jest.fn();
    const onSyncComplete = jest.fn();
    const onError = jest.fn();

    db.on('syncStart', onSyncStart);
    db.on('syncComplete', onSyncComplete);
    db.on('error', onError);

    await db.sync();

    expect(onSyncStart).toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
    // This expectation is expected to FAIL currently
    expect(onSyncComplete).toHaveBeenCalled();
  });
});
