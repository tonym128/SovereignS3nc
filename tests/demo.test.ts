import { SovereignS3nc } from '../src/index';

// We need to mock the DOM before importing the app
const mockElements = new Map<string, any>();
const mockDocument = {
  getElementById: jest.fn((id: string) => {
    if (!mockElements.has(id)) {
      mockElements.set(id, {
        id,
        value: '',
        style: { display: '' },
        classList: {
          add: jest.fn(),
          remove: jest.fn(),
          contains: jest.fn()
        },
        remove: jest.fn(),
        addEventListener: jest.fn(),
        appendChild: jest.fn(),
        querySelector: jest.fn(),
        click: jest.fn(),
        files: [],
        innerHTML: ''
      });
    }
    return mockElements.get(id);
  }),
  createElement: jest.fn((tag) => ({
    tagName: tag.toUpperCase(),
    className: '',
    innerHTML: '',
    querySelector: jest.fn().mockReturnValue({}),
    appendChild: jest.fn(),
    remove: jest.fn(),
    style: {}
  })),
  querySelectorAll: jest.fn((selector) => {
    return [
      { value: 'oci', addEventListener: jest.fn() },
      { value: 's3', addEventListener: jest.fn() }
    ];
  }),
  querySelector: jest.fn((selector) => {
    return { value: 'oci' };
  })
};

global.document = mockDocument as any;
global.window = {} as any;
global.alert = jest.fn();
global.Blob = jest.fn();
global.URL = { createObjectURL: jest.fn() } as any;
global.HTMLElement = class {} as any;
global.HTMLInputElement = class {} as any;
global.HTMLImageElement = class {} as any;
global.HTMLButtonElement = class {} as any;

// Mock the library
jest.mock('../src/index', () => {
  return {
    SovereignS3nc: jest.fn(),
    IndexedDBStorage: jest.fn().mockImplementation(() => ({
      init: jest.fn(),
      put: jest.fn(),
      get: jest.fn()
    }))
  };
});

describe('Demo App Integration', () => {
  let mockDb: any;
  let listeners: Map<string, Function>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockElements.clear();
    listeners = new Map();

    // Setup Mock DB instance
    mockDb = {
      init: jest.fn().mockResolvedValue(undefined),
      connect: jest.fn().mockResolvedValue(undefined),
      sync: jest.fn().mockResolvedValue({ pulled: 0, pushed: 0, errors: 0 }),
      share: jest.fn().mockResolvedValue('share-id'),
      unshare: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      getAddress: jest.fn().mockReturnValue({ bucket: 'b', appId: 'a', userId: 'u' }),
      config: { paths: { userId: 'mock-private-id' } },
      publicId: 'mock-public-id',
      profile: {
        get: jest.fn().mockResolvedValue({ displayName: 'Test User' }),
        update: jest.fn().mockResolvedValue(undefined)
      },
      social: {
        getFeed: jest.fn().mockResolvedValue([]),
        getComments: jest.fn().mockResolvedValue([]),
        getAllComments: jest.fn().mockResolvedValue([]),
        getFollowing: jest.fn().mockResolvedValue([]),
        getGlobalDirectory: jest.fn().mockResolvedValue([]),
        joinGlobalDirectory: jest.fn().mockResolvedValue(undefined),
        follow: jest.fn(),
        unfollow: jest.fn()
      },
      collection: jest.fn().mockReturnValue({
        getAll: jest.fn().mockResolvedValue([]),
        save: jest.fn().mockResolvedValue('new-id'),
        get: jest.fn().mockResolvedValue({})
      }),
      storage: {
        upload: jest.fn().mockResolvedValue({ _id: 'blob-id' }),
        download: jest.fn().mockResolvedValue(new Uint8Array([]))
      }
    };

    (SovereignS3nc as unknown as jest.Mock).mockImplementation(() => mockDb);

    // Mock window.addEventListener
    global.window.addEventListener = jest.fn((event, handler) => {
        listeners.set(`window:${event}`, handler as Function);
    });

    // Capture event listeners when they are added
    mockDocument.getElementById.mockImplementation((id: string) => {
        if (!mockElements.has(id)) {
            const el = {
                id,
                value: '',
                style: { display: '' },
                classList: {
                    add: jest.fn(),
                    remove: jest.fn(),
                    contains: jest.fn()
                },
                addEventListener: jest.fn((event, handler) => {
                   listeners.set(`${id}:${event}`, handler);
                }),
                onclick: null, // For direct assignment
                appendChild: jest.fn(),
                querySelector: jest.fn().mockReturnValue({}),
                files: [],
                innerHTML: ''
            };
            mockElements.set(id, el);
        }
        return mockElements.get(id);
    });
  });

  const loadApp = () => {
      jest.isolateModules(() => {
          require('../demo/social/src/app.ts');
      });
      
      // Capture onclick handlers that were assigned directly
      mockElements.forEach((el, id) => {
          if (el.onclick) {
              listeners.set(`${id}:click`, el.onclick);
          }
      });
  };

  test('should initialize and bind events', () => {
      loadApp();
      expect(mockDocument.getElementById).toHaveBeenCalledWith('view-auth');
      expect(mockDocument.getElementById).toHaveBeenCalledWith('btn-connect');
  });

  test('should connect and load profile on connection', async () => {
      loadApp();

      // Simulate input using mockDocument to ensure creation
      const urlInput = mockDocument.getElementById('oci-url');
      const appIdInput = mockDocument.getElementById('app-id');
      const userIdInput = mockDocument.getElementById('user-id');
      
      urlInput.value = 'https://oci.example.com';
      appIdInput.value = 'my-app';
      userIdInput.value = 'my-user';
      
      mockDocument.getElementById('private-passphrase').value = 'secret';
      mockDocument.getElementById('public-passphrase').value = 'public';

      // Trigger click
      const handler = listeners.get('btn-connect:click');
      expect(handler).toBeDefined();
      
      await handler!();

      expect(SovereignS3nc).toHaveBeenCalledWith(expect.objectContaining({
          ociParUrl: 'https://oci.example.com',
          paths: { appId: 'my-app', userId: 'my-user', storeId: 'social' }
      }), expect.anything());
      expect(mockDb.init).toHaveBeenCalled();
      expect(mockDb.profile.get).toHaveBeenCalled();
      expect(mockDb.social.getFeed).toHaveBeenCalled();
      
      // Check view transition
      const authView = mockDocument.getElementById('view-auth');
      const appArea = mockDocument.getElementById('app-area');
      expect(authView.classList.add).toHaveBeenCalledWith('hidden');
      expect(appArea.classList.remove).toHaveBeenCalledWith('hidden');
  });

  test('should post content', async () => {
      loadApp();
      
      // We need to "connect" first to set the db instance
      const connectHandler = listeners.get('btn-connect:click');
      mockDocument.getElementById('oci-url').value = 'url';
      mockDocument.getElementById('app-id').value = 'my-app';
      mockDocument.getElementById('user-id').value = 'user';
      mockDocument.getElementById('private-passphrase').value = 'secret';
      mockDocument.getElementById('public-passphrase').value = 'public';
      await connectHandler!();

      // Setup post input
      const textInput = mockDocument.getElementById('post-text');
      textInput.value = 'Hello World';
      
      const btnPost = mockDocument.getElementById('btn-post'); // Used for disabling
      
      const postHandler = listeners.get('btn-post:click');
      await postHandler!();

      expect(mockDb.collection).toHaveBeenCalledWith('posts');
      // Verify save called with correct data
      const collectionMock = mockDb.collection.mock.results[0].value; 
      expect(collectionMock.save).toHaveBeenCalledWith(expect.objectContaining({
          text: 'Hello World',
          authorId: 'me'
      }));
  });

  test('should update profile', async () => {
      loadApp();
      
      // Connect
      const connectHandler = listeners.get('btn-connect:click');
      mockDocument.getElementById('oci-url').value = 'url';
      mockDocument.getElementById('app-id').value = 'my-app';
      mockDocument.getElementById('user-id').value = 'user';
      mockDocument.getElementById('private-passphrase').value = 'secret';
      mockDocument.getElementById('public-passphrase').value = 'public';
      await connectHandler!();

      // Input profile data
      mockDocument.getElementById('profile-name').value = 'New Name';
      mockDocument.getElementById('profile-bio').value = 'New Bio';
      
      const saveHandler = listeners.get('btn-save-profile:click');
      await saveHandler!();

      expect(mockDb.profile.update).toHaveBeenCalledWith(expect.objectContaining({
          displayName: 'New Name',
          bio: 'New Bio'
      }));
  });

  test('should switch tabs', async () => {
      loadApp();
      
      // Trigger window load to bind nav links
      // We might have multiple load listeners (config + nav)
      // Iterate listeners map
      for (const [key, handler] of listeners.entries()) {
          if (key === 'window:load') {
              await handler();
          }
      }
      
      const feedLink = mockDocument.getElementById('nav-feed');
      const profileLink = mockDocument.getElementById('nav-profile');
      
      // Direct access to onclick handler
      const profileEl = mockDocument.getElementById('nav-profile');
      const profileClickHandler = profileEl.onclick;
      expect(profileClickHandler).toBeDefined();
      
      profileClickHandler();
      
      const feedView = mockDocument.getElementById('view-feed');
      const profileView = mockDocument.getElementById('view-profile');
      
      expect(feedView.classList.add).toHaveBeenCalledWith('hidden');
      expect(profileView.classList.remove).toHaveBeenCalledWith('hidden');
      expect(profileLink.classList.add).toHaveBeenCalledWith('active');
  });
});