import { LWWRegister, LWWState } from './LWWRegister';

export type CRDTFieldStates<T> = {
    [K in keyof T]?: LWWState<T[K]>;
};

export type CRDTRowSerialized<T> = T & {
    _crdt: CRDTFieldStates<T>;
    data?: Partial<T>;
};

export class CRDTRow<T extends Record<string, any>> {
    private fields: Map<keyof T, LWWRegister<any>> = new Map();
    private peerId: string;

    constructor(initialData: Partial<T> = {}, peerId: string, timestamp: number = Date.now()) {
        this.peerId = peerId;
        for (const [key, val] of Object.entries(initialData)) {
            if (val !== undefined && key !== '_crdt' && key !== 'data') {
                this.fields.set(key as keyof T, new LWWRegister(val, peerId, timestamp));
            }
        }
    }

    public getPeerId(): string {
        return this.peerId;
    }

    public setPeerId(peerId: string): void {
        this.peerId = peerId;
    }

    public get<K extends keyof T>(field: K): T[K] | undefined {
        return this.fields.get(field)?.value;
    }

    public getFieldState<K extends keyof T>(field: K): Readonly<LWWState<T[K]>> | undefined {
        return this.fields.get(field)?.getState();
    }

    public set<K extends keyof T>(field: K, value: T[K], timestamp: number = Date.now(), peerId?: string): boolean {
        const writer = peerId || this.peerId;
        const existing = this.fields.get(field);
        if (existing) {
            return existing.set(value, writer, timestamp);
        } else {
            this.fields.set(field, new LWWRegister(value, writer, timestamp));
            return true;
        }
    }

    public setMany(partial: Partial<T>, timestamp: number = Date.now(), peerId?: string): boolean {
        let changed = false;
        for (const [key, value] of Object.entries(partial)) {
            if (value !== undefined && key !== '_crdt' && key !== 'data') {
                const res = this.set(key as keyof T, value as T[keyof T], timestamp, peerId);
                if (res) changed = true;
            }
        }
        return changed;
    }

    public toObject(): T {
        const obj: any = {};
        for (const [key, reg] of this.fields.entries()) {
            obj[key] = reg.value;
        }
        return obj as T;
    }

    public merge(other: CRDTRow<T> | CRDTRowSerialized<T> | string): boolean {
        let changed = false;
        let incomingFields: CRDTFieldStates<T>;

        if (typeof other === 'string') {
            const parsed = JSON.parse(other);
            incomingFields = parsed._crdt || this.inferFieldsFromPlainObject(parsed.data || parsed);
        } else if (other instanceof CRDTRow) {
            incomingFields = other.getFieldStates();
        } else if (other._crdt) {
            incomingFields = other._crdt;
        } else if ((other as any).data) {
            incomingFields = this.inferFieldsFromPlainObject((other as any).data);
        } else {
            incomingFields = this.inferFieldsFromPlainObject(other as any);
        }

        for (const [keyStr, state] of Object.entries(incomingFields)) {
            const key = keyStr as keyof T;
            if (!state) continue;
            const existing = this.fields.get(key);
            if (existing) {
                const res = existing.merge(state as LWWState<any>);
                if (res) changed = true;
            } else {
                this.fields.set(key, new LWWRegister(state.value, state.peerId, state.timestamp));
                changed = true;
            }
        }

        return changed;
    }

    private inferFieldsFromPlainObject(obj: any): CRDTFieldStates<T> {
        const result: CRDTFieldStates<T> = {};
        const now = Date.now();
        for (const [k, v] of Object.entries(obj)) {
            if (k === '_crdt' || k === 'data') continue;
            result[k as keyof T] = {
                value: v as any,
                timestamp: now,
                peerId: 'unknown'
            };
        }
        return result;
    }

    public getFieldStates(): CRDTFieldStates<T> {
        const states: CRDTFieldStates<T> = {};
        for (const [key, reg] of this.fields.entries()) {
            states[key] = reg.getState();
        }
        return states;
    }

    public toJSON(): CRDTRowSerialized<T> {
        const obj = this.toObject();
        return {
            ...obj,
            data: obj,
            _crdt: this.getFieldStates()
        };
    }

    public toJSONString(): string {
        return JSON.stringify(this.toJSON());
    }

    public static fromJSON<T extends Record<string, any>>(
        payload: string | CRDTRowSerialized<T> | Partial<T>,
        defaultPeerId: string = 'peer'
    ): CRDTRow<T> {
        if (typeof payload === 'string') {
            try {
                const parsed = JSON.parse(payload);
                return CRDTRow.fromJSON<T>(parsed, defaultPeerId);
            } catch {
                return new CRDTRow<T>({}, defaultPeerId);
            }
        }

        const row = new CRDTRow<T>({}, defaultPeerId);
        if ((payload as any)._crdt) {
            const serialized = payload as CRDTRowSerialized<T>;
            for (const [keyStr, state] of Object.entries(serialized._crdt)) {
                if (state) {
                    row.fields.set(keyStr as keyof T, new LWWRegister(state.value, state.peerId, state.timestamp));
                }
            }
        } else {
            // Plain object
            row.setMany(payload as Partial<T>, Date.now(), defaultPeerId);
        }
        return row;
    }
}

