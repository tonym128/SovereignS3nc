/**
 * Simple LRU (Least Recently Used) Cache implementation.
 */
export class LRUCache<K, V> {
    private cache: Map<K, V>;
    private maxSize: number;

    constructor(maxSize: number = 100) {
        this.cache = new Map<K, V>();
        this.maxSize = maxSize;
    }

    public get(key: K): V | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            // Delete and re-insert to move to the end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }

    public set(key: K, value: V): void {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // Remove the first item (least recently used)
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }
        this.cache.set(key, value);
    }

    public delete(key: K): boolean {
        return this.cache.delete(key);
    }

    public clear(): void {
        this.cache.clear();
    }

    public get size(): number {
        return this.cache.size;
    }

    public has(key: K): boolean {
        return this.cache.has(key);
    }
}
