export interface VectorClockState {
    [peerId: string]: number;
}

export class VectorClock {
    private clock: VectorClockState;

    constructor(initialState: VectorClockState = {}) {
        this.clock = { ...initialState };
    }

    public increment(peerId: string): number {
        const next = (this.clock[peerId] || 0) + 1;
        this.clock[peerId] = next;
        return next;
    }

    public get(peerId: string): number {
        return this.clock[peerId] || 0;
    }

    public getState(): Readonly<VectorClockState> {
        return { ...this.clock };
    }

    public merge(other: VectorClock | VectorClockState): void {
        const otherState = other instanceof VectorClock ? other.clock : other;
        for (const [peer, counter] of Object.entries(otherState)) {
            const current = this.clock[peer] || 0;
            if (counter > current) {
                this.clock[peer] = counter;
            }
        }
    }

    public compare(other: VectorClock | VectorClockState): 'before' | 'after' | 'concurrent' | 'equal' {
        const otherState = other instanceof VectorClock ? other.clock : other;
        const allPeers = new Set([...Object.keys(this.clock), ...Object.keys(otherState)]);
        
        let hasGreater = false;
        let hasLesser = false;

        for (const peer of allPeers) {
            const v1 = this.clock[peer] || 0;
            const v2 = otherState[peer] || 0;
            if (v1 > v2) hasGreater = true;
            if (v1 < v2) hasLesser = true;
        }

        if (hasGreater && hasLesser) return 'concurrent';
        if (hasGreater && !hasLesser) return 'after';
        if (!hasGreater && hasLesser) return 'before';
        return 'equal';
    }

    public toJSON(): VectorClockState {
        return { ...this.clock };
    }

    public static fromJSON(json: string | VectorClockState): VectorClock {
        if (typeof json === 'string') {
            return new VectorClock(JSON.parse(json));
        }
        return new VectorClock(json);
    }
}
