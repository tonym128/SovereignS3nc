/**
 * Centralized path constants for SovereignS3nc.
 */
export const PATHS = {
    // Internal files
    KEYS: '_keys.json',
    SENTINEL: 'sentinel.enc',
    USER_PROFILE: 'public/user.json',
    MANIFEST: 'manifest.json',
    USERS_REGISTRY: 'users.json',
    BLACKLIST: 'blacklist.json',
    ADMIN_PUBLIC_KEY: 'public_key.json',
    MANIFEST_CACHE: '.manifest_cache.json',

    // Directory prefixes
    PUBLIC_PREFIX: 'public/',
    PRIVATE_PREFIX: 'private/',
    FOLLOWED_PREFIX: 'followed/',
    MODULES_DIR: 'modules/',
    GROUPS_DIR: 'groups/',
    BLOBS_DIR: 'blobs/',
    OUTBOX_DIR: 'private/outbox/',
    DMS_DIR: 'public/dms/',
    MODERATION_DIR: 'public/moderation/',
    MODERATION_REQUESTS: 'public/moderation/requests/',

    // File extensions
    DB_EXT: '.db',
    JSON_EXT: '.json',
    ENC_EXT: '.enc',
} as const;

/**
 * Common configuration defaults.
 */
export const DEFAULTS = {
    SYNC_BATCH_SIZE: 10,
    RTC_MAX_PEERS: 5,
    RTC_TTL: 5,
    RTC_MAX_SEEN_MESSAGES: 1000,
    RTC_MAX_CACHE_SIZE: 100,
    NETWORK_TIMEOUT: 5000,
    // Security
    PBKDF2_ITERATIONS: 600000,
    SALT_SIZE: 16,
    // Module Limits
    MAX_POST_LENGTH: 10000,
    MAX_MESSAGE_LENGTH: 5000,
    MAX_BIO_LENGTH: 1000,
    MAX_NAME_LENGTH: 100,
} as const;
