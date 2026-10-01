export interface LWWState<T> {
    value: T;
    timestamp: number;
    peerId: string;
}

export class LWWRegister<T> {
    private state: LWWState<T>;

    constructor(initialValue: T, peerId: string, timestamp: number = Date.now()) {
        this.state = {
            value: initialValue,
            timestamp,
            peerId
        };
    }

    public get value(): T {
        return this.state.value;
    }

    public get timestamp(): number {
        return this.state.timestamp;
    }

    public get peerId(): string {
        return this.state.peerId;
    }

    public set(value: T, peerId: string, timestamp: number = Date.now()): boolean {
        const incoming: LWWState<T> = { value, timestamp, peerId };
        return this.applyIncoming(incoming);
    }

    public merge(other: LWWRegister<T> | LWWState<T>): boolean {
        const incoming = other instanceof LWWRegister ? other.state : other;
        return this.applyIncoming(incoming);
    }

    private applyIncoming(incoming: LWWState<T>): boolean {
        if (incoming.timestamp > this.state.timestamp) {
            this.state = { ...incoming };
            return true;
        }
        if (incoming.timestamp === this.state.timestamp) {
            // Deterministic tie-breaking using peerId
            if (incoming.peerId > this.state.peerId) {
                this.state = { ...incoming };
                return true;
            }
        }
        return false;
    }

    public getState(): Readonly<LWWState<T>> {
        return { ...this.state };
    }

    public toJSON(): LWWState<T> {
        return { ...this.state };
    }

    public static fromJSON<T>(json: string | LWWState<T>): LWWRegister<T> {
        const state: LWWState<T> = typeof json === 'string' ? JSON.parse(json) : json;
        const reg = new LWWRegister<T>(state.value, state.peerId, state.timestamp);
        return reg;
    }
}
