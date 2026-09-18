import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import 'fake-indexeddb/auto';
import initSqlJs from 'sql.js';
import { SovereignS3nc } from '../src/SovereignS3nc';
import {
    SovereignProvider,
    useSovereign,
    useSovereignContext,
    useSyncStatus,
    useDirectMessages,
    useFeed,
    useRepository
} from '../packages/react/src';
import { SovereignConfig } from '../src/types';

class MockNode {
    nodeType: number;
    nodeName: string;
    tagName: string;
    childNodes: any[] = [];
    parentNode: any = null;
    style: Record<string, any> = {};
    nodeValue: string | null = null;

    constructor(nodeType = 1, nodeName = 'DIV') {
        this.nodeType = nodeType;
        this.nodeName = nodeName;
        this.tagName = nodeName;
    }

    appendChild(child: any) {
        this.childNodes.push(child);
        child.parentNode = this;
        return child;
    }

    removeChild(child: any) {
        const idx = this.childNodes.indexOf(child);
        if (idx !== -1) this.childNodes.splice(idx, 1);
        child.parentNode = null;
        return child;
    }

    insertBefore(newChild: any, refChild: any) {
        const idx = this.childNodes.indexOf(refChild);
        if (idx !== -1) this.childNodes.splice(idx, 0, newChild);
        else this.childNodes.push(newChild);
        newChild.parentNode = this;
        return newChild;
    }

    addEventListener() {}
    removeEventListener() {}
    setAttribute() {}
    removeAttribute() {}
    getAttribute() { return null; }
}

class MockDocument extends MockNode {
    documentElement: MockNode;
    body: MockNode;
    defaultView: any;

    constructor() {
        super(9, '#document');
        this.documentElement = new MockNode(1, 'HTML');
        this.body = new MockNode(1, 'BODY');
        this.documentElement.appendChild(this.body);
        this.appendChild(this.documentElement);
    }

    createElement(tag: string) {
        const el = new MockNode(1, tag.toUpperCase());
        (el as any).ownerDocument = this;
        return el;
    }

    createElementNS(_ns: string, tag: string) {
        return this.createElement(tag);
    }

    createTextNode(text: string) {
        const t = new MockNode(3, '#text');
        t.nodeValue = text;
        (t as any).ownerDocument = this;
        return t;
    }

    createComment(text: string) {
        const c = new MockNode(8, '#comment');
        c.nodeValue = text;
        (c as any).ownerDocument = this;
        return c;
    }
}

const doc = new MockDocument();
const win = {
    document: doc,
    addEventListener() {},
    removeEventListener() {},
    HTMLIFrameElement: class HTMLIFrameElement {},
    HTMLElement: class HTMLElement {},
    initSqlJs
};
doc.defaultView = win;
(global as any).window = win;
(global as any).document = doc;
(global as any).navigator = { userAgent: 'node' };
(global as any).IS_REACT_ACT_ENVIRONMENT = true;
(global as any).initSqlJs = initSqlJs;
(globalThis as any).initSqlJs = initSqlJs;

async function waitFor(callback: () => void | Promise<void>, timeoutMs = 4000): Promise<void> {
    const startTime = Date.now();
    while (true) {
        try {
            await callback();
            return;
        } catch (err) {
            if (Date.now() - startTime > timeoutMs) throw err;
            await act(async () => {
                await new Promise(r => setTimeout(r, 25));
            });
        }
    }
}

interface RenderHookResult<T> {
    result: { current: T };
    rerender: () => Promise<void>;
    unmount: () => Promise<void>;
}

async function renderHook<T>(
    hookFn: () => T,
    wrapper?: React.FC<{ children: React.ReactNode }>
): Promise<RenderHookResult<T>> {
    const result = { current: undefined as unknown as T };
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root | null = createRoot(container);

    const HookComponent: React.FC = () => {
        result.current = hookFn();
        return null;
    };

    const renderElement = () => {
        if (wrapper) {
            return React.createElement(wrapper, null, React.createElement(HookComponent));
        }
        return React.createElement(HookComponent);
    };

    await act(async () => {
        root!.render(renderElement());
    });

    return {
        result,
        rerender: async () => {
            await act(async () => {
                root!.render(renderElement());
            });
        },
        unmount: async () => {
            await act(async () => {
                if (root) {
                    root.unmount();
                    root = null;
                }
                if (container.parentNode) {
                    container.parentNode.removeChild(container);
                }
            });
        }
    };
}

const createTestConfig = (userId: string): SovereignConfig => ({
    offline: true,
    paths: {
        appId: 'test-app',
        userId,
        storeId: 'main'
    },
    password: 'password123',
    autoFollowDiscoveredUsers: false
});

describe('@sovereigns3nc/react Reactive Hooks Package', () => {
    let sov: SovereignS3nc;
    let peerSov: SovereignS3nc;

    beforeEach(async () => {
        const id = 'user-' + Math.random().toString(36).substring(7);
        sov = new SovereignS3nc(createTestConfig(id));
        await sov.init();

        const peerId = 'peer-' + Math.random().toString(36).substring(7);
        peerSov = new SovereignS3nc(createTestConfig(peerId));
        await peerSov.init();
    });

    afterEach(async () => {
        // cleanup if needed
    });

    describe('SovereignProvider & useSovereign', () => {
        it('throws descriptive error when useSovereign is called outside Provider', async () => {
            let thrownError: Error | null = null;
            try {
                await renderHook(() => useSovereign());
            } catch (err: any) {
                thrownError = err;
            }
            expect(thrownError).toBeDefined();
            expect(thrownError?.message).toContain('must be used within a <SovereignProvider>');
        });

        it('provides active SovereignS3nc instance to children', async () => {
            const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
                React.createElement(SovereignProvider, { instance: sov }, children);

            const { result, unmount } = await renderHook(() => useSovereign(), wrapper);
            expect(result.current).toBe(sov);
            expect(result.current.getConfig().paths.userId).toBe(sov.getConfig().paths.userId);
            await unmount();
        });

        it('supports initialization via config prop and updates isInitialized state', async () => {
            const config = createTestConfig('cfg-user-' + Math.random().toString(36).substring(7));
            const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
                React.createElement(SovereignProvider, { config, autoInit: true }, children);

            const { result, unmount } = await renderHook(() => useSovereignContext(), wrapper);
            expect(result.current.sov).toBeDefined();
            await waitFor(() => {
                expect(result.current.isInitialized).toBe(true);
            });
            expect(result.current.initError).toBeNull();
            await unmount();
        });
    });

    describe('useSyncStatus', () => {
        it('tracks sync progress, stages, and completion', async () => {
            const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
                React.createElement(SovereignProvider, { instance: sov }, children);

            const { result, unmount } = await renderHook(() => useSyncStatus(), wrapper);

            expect(result.current.isSyncing).toBe(false);
            expect(result.current.progress).toBe(0);
            expect(result.current.stage).toBe('idle');

            // Emit start
            await act(async () => {
                sov.emit('sync:progress', { stage: 'start' });
            });
            expect(result.current.isSyncing).toBe(true);
            expect(result.current.stage).toBe('start');
            expect(result.current.progress).toBe(0);

            // Emit intermediate progress: 5/10 (50%)
            await act(async () => {
                sov.emit('sync:progress', { stage: 'syncing_own_data', done: 5, total: 10 });
            });
            expect(result.current.isSyncing).toBe(true);
            expect(result.current.stage).toBe('syncing_own_data');
            expect(result.current.progress).toBe(50);

            // Emit complete
            await act(async () => {
                sov.emit('sync:progress', { stage: 'complete' });
            });
            expect(result.current.isSyncing).toBe(false);
            expect(result.current.stage).toBe('complete');
            expect(result.current.progress).toBe(100);

            await unmount();
        });
    });

    describe('useFeed', () => {
        it('loads posts, allows creating posts, and auto-refreshes on updates', async () => {
            const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
                React.createElement(SovereignProvider, { instance: sov }, children);

            const { result, unmount } = await renderHook(() => useFeed(), wrapper);

            // Initially loads and settles
            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });
            expect(result.current.posts).toEqual([]);

            // Create post
            await act(async () => {
                await result.current.createPost('Hello Sovereign World!');
            });

            expect(result.current.posts.length).toBe(1);
            expect(result.current.posts[0].content).toBe('Hello Sovereign World!');
            expect(result.current.posts[0].userId).toBe(sov.getConfig().paths.userId);

            // Like post
            const postId = result.current.posts[0].id;
            await act(async () => {
                await result.current.likePost(postId);
            });

            expect(result.current.posts.length).toBe(1);
            expect(result.current.posts[0].likesCount).toBe(1);
            expect(result.current.posts[0].likedByMe).toBe(true);

            // Delete post
            const dateStr = new Date().toISOString().split('T')[0];
            await act(async () => {
                await result.current.deletePost(postId, dateStr);
            });

            expect(result.current.posts.length).toBe(1);
            expect(result.current.posts[0].isDeleted).toBe(true);

            await unmount();
        });
    });

    describe('useDirectMessages', () => {
        it('manages encrypted direct messaging and updates state upon sendDM', async () => {
            // Register both users so public keys are known
            const peerId = peerSov.getConfig().paths.userId;
            const peerPk = peerSov.getConfig().publicEncryptionKey;
            if (peerPk) {
                await sov.follow(peerId, peerPk);
            }

            const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
                React.createElement(SovereignProvider, { instance: sov }, children);

            const { result, unmount } = await renderHook(() => useDirectMessages(peerId), wrapper);

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });
            expect(result.current.messages).toEqual([]);

            // Send DM to peer
            await act(async () => {
                await result.current.sendDM('Hi peer! This is encrypted.');
            });

            expect(result.current.messages.length).toBe(1);
            expect(result.current.messages[0].content).toBe('Hi peer! This is encrypted.');
            expect(result.current.messages[0].recipientId).toBe(peerId);
            expect(result.current.messages[0].senderId).toBe(sov.getConfig().paths.userId);

            await unmount();
        });
    });

    describe('useRepository', () => {
        interface Task {
            id: string;
            title: string;
            completed: number;
        }

        it('provides full reactive CRUD operations over typed repositories', async () => {
            const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
                React.createElement(SovereignProvider, { instance: sov }, children);

            // Setup custom module schema for task table
            sov.registerModule({
                name: 'tasks',
                tables: [
                    {
                        name: 'items',
                        schema: 'id TEXT PRIMARY KEY, title TEXT, completed INTEGER DEFAULT 0'
                    }
                ]
            });

            const { result, unmount } = await renderHook(
                () => useRepository<Task>('tasks', 'items'),
                wrapper
            );

            expect(result.current.repository).toBeDefined();
            expect(result.current.data).toEqual([]);

            // Insert
            await act(async () => {
                await result.current.insert({ id: 't1', title: 'Task One', completed: 0 });
            });
            expect(result.current.data.length).toBe(1);
            expect(result.current.data[0].title).toBe('Task One');

            // Update
            await act(async () => {
                await result.current.update('t1', { completed: 1 });
            });
            expect(result.current.data.length).toBe(1);
            expect(result.current.data[0].completed).toBe(1);

            // Upsert
            await act(async () => {
                await result.current.upsert({ id: 't2', title: 'Task Two', completed: 0 });
            });
            expect(result.current.data.length).toBe(2);

            // Remove
            await act(async () => {
                await result.current.remove('t1');
            });
            expect(result.current.data.length).toBe(1);
            expect(result.current.data[0].id).toBe('t2');

            await unmount();
        });
    });
});
