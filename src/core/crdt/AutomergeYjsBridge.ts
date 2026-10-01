/**
 * Adapter contract and bridge helpers for third-party CRDT libraries (Automerge, Yjs)
 * running on top of SovereignS3nc storage partitions and P2P transports.
 */

export interface ICRDTDocumentAdapter<TDoc = any> {
    readonly docId: string;
    getDoc(): TDoc;
    save(): Uint8Array;
    load(binary: Uint8Array): void;
    applyUpdate(update: Uint8Array): void;
    getMissingUpdates?(stateVector?: Uint8Array): Uint8Array;
}

/**
 * Encapsulates an Automerge or Yjs binary update payload along with metadata
 * suitable for persisting in SovereignS3nc daily partitions or WebRTC real-time sync.
 */
export interface CRDTBinaryPayload {
    docId: string;
    engine: 'automerge' | 'yjs' | 'lww' | 'custom';
    updateBase64: string;
    timestamp: number;
    peerId: string;
}

export class CRDTBinaryBridge {
    /**
     * Serializes a Uint8Array update from Automerge or Yjs to a JSON-compatible payload.
     */
    public static createPayload(
        docId: string,
        engine: 'automerge' | 'yjs' | 'lww' | 'custom',
        update: Uint8Array,
        peerId: string,
        timestamp: number = Date.now()
    ): CRDTBinaryPayload {
        const base64 = typeof Buffer !== 'undefined'
            ? Buffer.from(update).toString('base64')
            : btoa(String.fromCharCode(...update));
        return {
            docId,
            engine,
            updateBase64: base64,
            timestamp,
            peerId
        };
    }

    /**
     * Deserializes a payload back into a Uint8Array update for applying to an Automerge or Yjs doc.
     */
    public static extractUpdate(payload: CRDTBinaryPayload | string): Uint8Array {
        const data: CRDTBinaryPayload = typeof payload === 'string' ? JSON.parse(payload) : payload;
        if (typeof Buffer !== 'undefined') {
            return new Uint8Array(Buffer.from(data.updateBase64, 'base64'));
        }
        const binaryString = atob(data.updateBase64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }
}
