// Storage and persistence constants
export const STORAGE_KEYS = {
    WORKSPACE_BOOKMARKS: 'workspace-bookmarks'
} as const;

// Category and organization constants
export const CATEGORIES = {
    DEFAULT: 'Uncategorized',
    PLACEHOLDER_PREFIX: '__placeholder__',
    EMPTY_MESSAGE: '[Empty Category - Add bookmarks here]'
} as const;

// Drag and drop constants
export const DRAG_DROP = {
    MIME_TYPE: 'application/vnd.code.tree.bookmarkExplorer',
    URI_LIST_MIME_TYPE: 'text/uri-list'
} as const;


// Input validation constants
export const VALIDATION = {
    MAX_LABEL_LENGTH: 200,
    MAX_CATEGORY_LENGTH: 100,
    MIN_CATEGORY_LENGTH: 1,
    INVALID_CATEGORY_CHARS: /[<>:"|?*]/,
    CATEGORY_PATH_SEPARATOR: '/'
} as const;

// Performance and caching constants
export const PERFORMANCE = {
    DEBOUNCE_DELAY_MS: 300,
    CACHE_TTL_MS: 5 * 60 * 1000, // 5 minutes
    MAX_CONCURRENT_OPERATIONS: 10,
    LARGE_BOOKMARK_COUNT_THRESHOLD: 100
} as const;

