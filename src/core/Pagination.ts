/**
 * Cursor-based keyset pagination utilities and types for SovereignS3nc.
 * Provides opaque Base64 URL-safe cursor encoding/decoding and keyset pagination
 * over compound keys (timestamp, id).
 */

export interface PaginationOptions {
    /**
     * Maximum number of items to return in a single page.
     * Default: 50. Minimum: 1.
     */
    limit?: number;

    /**
     * Opaque Base64URL-encoded cursor referencing a specific position in the dataset.
     */
    cursor?: string;

    /**
     * Pagination traversal direction:
     * - 'before': Fetches records older than the cursor (default for reverse-chronological feeds and messages).
     * - 'after': Fetches records newer than the cursor.
     */
    direction?: 'before' | 'after';
}

export interface PaginatedResult<T> {
    /** The slice of items returned for this page. */
    items: T[];

    /**
     * Opaque cursor to pass into the next query to continue paginating in the current direction.
     * `null` if there are no more items available.
     */
    nextCursor: string | null;

    /**
     * Opaque cursor representing the first item on the current page.
     * Useful for bi-directional pagination or reverse polling.
     * `null` if the page is empty.
     */
    prevCursor?: string | null;

    /** Whether there are more items to fetch beyond this page. */
    hasMore: boolean;

    /** Total count of items matching the query before pagination slice, if available. */
    total?: number;
}

export interface DecodedCursor {
    /** Unix timestamp in milliseconds. */
    timestamp: number;
    /** Unique record identifier (UUID or random string ID). */
    id: string;
    /** Additional optional cursor payload fields. */
    [key: string]: any;
}

/**
 * Utility for encoding and decoding opaque URL-safe Base64 cursors.
 */
export class PaginationCursor {
    /**
     * Encodes a compound key (timestamp, id) and optional extra metadata into a URL-safe Base64 cursor.
     */
    static encode(timestamp: number, id: string, extra?: Record<string, any>): string {
        const payload: Record<string, any> = { t: timestamp, i: id, ...(extra || {}) };
        const json = JSON.stringify(payload);

        let base64: string;
        if (typeof Buffer !== 'undefined') {
            base64 = Buffer.from(json, 'utf8').toString('base64');
        } else if (typeof btoa !== 'undefined') {
            base64 = btoa(unescape(encodeURIComponent(json)));
        } else {
            base64 = encodeURIComponent(json);
        }

        // Convert to URL-safe Base64 (replace + with -, / with _, remove padding =)
        return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    /**
     * Decodes an opaque URL-safe Base64 cursor into its constituent timestamp and id.
     * Returns `null` if the cursor is invalid, corrupted, or does not contain required fields.
     */
    static decode(cursor?: string | null): DecodedCursor | null {
        if (!cursor || typeof cursor !== 'string' || cursor.trim().length === 0) {
            return null;
        }

        try {
            // Restore standard Base64 from URL-safe format
            let base64 = cursor.trim().replace(/-/g, '+').replace(/_/g, '/');
            while (base64.length % 4 !== 0) {
                base64 += '=';
            }

            let json: string;
            if (typeof Buffer !== 'undefined') {
                json = Buffer.from(base64, 'base64').toString('utf8');
            } else if (typeof atob !== 'undefined') {
                const raw = atob(base64);
                try {
                    json = decodeURIComponent(escape(raw));
                } catch {
                    json = raw;
                }
            } else {
                json = decodeURIComponent(cursor);
            }

            const parsed = JSON.parse(json);
            if (typeof parsed !== 'object' || parsed === null) {
                return null;
            }

            if (typeof parsed.t !== 'number' || typeof parsed.i !== 'string' || isNaN(parsed.t)) {
                return null;
            }

            return {
                timestamp: parsed.t,
                id: parsed.i,
                ...parsed
            };
        } catch {
            return null;
        }
    }
}

/**
 * Applies keyset pagination to an in-memory array of items.
 *
 * @param items - The input items to paginate.
 * @param options - Pagination options (limit, cursor, direction).
 * @param keyExtractor - Callback returning { timestamp, id } for an item.
 */
export function paginateItems<T>(
    items: T[],
    options?: PaginationOptions,
    keyExtractor: (item: T) => { timestamp: number; id: string } = (item: any) => ({
        timestamp: item.timestamp,
        id: item.id
    })
): PaginatedResult<T> {
    const limit = Math.max(1, options?.limit ?? 50);
    const direction = options?.direction ?? 'before';
    const decodedCursor = PaginationCursor.decode(options?.cursor);

    let candidates = [...items];

    // Filter using keyset condition if cursor is provided
    if (decodedCursor) {
        candidates = candidates.filter(item => {
            const key = keyExtractor(item);
            if (direction === 'before') {
                // Older than cursor
                return (
                    key.timestamp < decodedCursor.timestamp ||
                    (key.timestamp === decodedCursor.timestamp && key.id < decodedCursor.id)
                );
            } else {
                // Newer than cursor
                return (
                    key.timestamp > decodedCursor.timestamp ||
                    (key.timestamp === decodedCursor.timestamp && key.id > decodedCursor.id)
                );
            }
        });
    }

    // Sort appropriately
    if (direction === 'before') {
        candidates.sort((a, b) => {
            const ka = keyExtractor(a);
            const kb = keyExtractor(b);
            if (kb.timestamp !== ka.timestamp) return kb.timestamp - ka.timestamp;
            return kb.id.localeCompare(ka.id);
        });
    } else {
        candidates.sort((a, b) => {
            const ka = keyExtractor(a);
            const kb = keyExtractor(b);
            if (ka.timestamp !== kb.timestamp) return ka.timestamp - kb.timestamp;
            return ka.id.localeCompare(kb.id);
        });
    }

    const hasMore = candidates.length > limit;
    const pageItems = candidates.slice(0, limit);

    const nextCursor = (hasMore && pageItems.length > 0)
        ? (() => {
            const last = keyExtractor(pageItems[pageItems.length - 1]);
            return PaginationCursor.encode(last.timestamp, last.id);
        })()
        : null;

    const prevCursor = pageItems.length > 0
        ? (() => {
            const first = keyExtractor(pageItems[0]);
            return PaginationCursor.encode(first.timestamp, first.id);
        })()
        : null;

    return {
        items: pageItems,
        nextCursor,
        prevCursor,
        hasMore,
        total: items.length
    };
}
