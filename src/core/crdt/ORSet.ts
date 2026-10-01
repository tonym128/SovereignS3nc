export interface ORSetItem<T> {
    element: T;
    tag: string;
    timestamp: number;
}

export interface ORSetState<T> {
    adds: ORSetItem<T>[];
    removes: string[]; // list of tags removed
}

export class ORSet<T> {
    private adds: Map<string, ORSetItem<T>> = new Map();
    private removes: Set<string> = new Set();
    private peerId: string;

    constructor(peerId: string = 'peer') {
        this.peerId = peerId;
    }

    public add(element: T, tag?: string, timestamp: number = Date.now()): string {
        const itemTag = tag || `${this.peerId}:${timestamp}:${Math.random().toString(36).substring(2, 9)}`;
        this.adds.set(itemTag, { element, tag: itemTag, timestamp });
        return itemTag;
    }

    public remove(element: T): boolean {
        let found = false;
        for (const [tag, item] of this.adds.entries()) {
            if (this.isEqual(item.element, element) && !this.removes.has(tag)) {
                this.removes.add(tag);
                found = true;
            }
        }
        return found;
    }

    public removeByTag(tag: string): boolean {
        if (this.adds.has(tag) && !this.removes.has(tag)) {
            this.removes.add(tag);
            return true;
        }
        return false;
    }

    public has(element: T): boolean {
        for (const [tag, item] of this.adds.entries()) {
            if (this.isEqual(item.element, element) && !this.removes.has(tag)) {
                return true;
            }
        }
        return false;
    }

    public values(): T[] {
        const result: T[] = [];
        for (const [tag, item] of this.adds.entries()) {
            if (!this.removes.has(tag)) {
                // Ensure no duplicate identical values returned if added multiple times
                if (!result.some(existing => this.isEqual(existing, item.element))) {
                    result.push(item.element);
                }
            }
        }
        return result;
    }

    public merge(other: ORSet<T> | ORSetState<T>): void {
        const otherState = other instanceof ORSet ? other.getState() : other;
        for (const item of otherState.adds) {
            if (!this.adds.has(item.tag)) {
                this.adds.set(item.tag, item);
            }
        }
        for (const tag of otherState.removes) {
            this.removes.add(tag);
        }
    }

    public getState(): ORSetState<T> {
        return {
            adds: Array.from(this.adds.values()),
            removes: Array.from(this.removes)
        };
    }

    public toJSON(): ORSetState<T> {
        return this.getState();
    }

    public static fromJSON<T>(json: string | ORSetState<T>, peerId: string = 'peer'): ORSet<T> {
        const state: ORSetState<T> = typeof json === 'string' ? JSON.parse(json) : json;
        const set = new ORSet<T>(peerId);
        set.merge(state);
        return set;
    }

    private isEqual(a: T, b: T): boolean {
        if (a === b) return true;
        if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
            return JSON.stringify(a) === JSON.stringify(b);
        }
        return false;
    }
}
