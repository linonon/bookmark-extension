import { PERFORMANCE } from '../constants';
import { CategoryNode, Bookmark } from '../models/bookmark';

interface CacheEntry<T> {
    value: T;
    timestamp: number;
    ttl: number;
}

export class Cache<T> {
    private cache = new Map<string, CacheEntry<T>>();
    private readonly defaultTTL: number;

    constructor(defaultTTL: number = PERFORMANCE.CACHE_TTL_MS) {
        this.defaultTTL = defaultTTL;
    }

    set(key: string, value: T, ttl: number = this.defaultTTL): void {
        this.cache.set(key, {
            value,
            timestamp: Date.now(),
            ttl
        });
    }

    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) {
            return undefined;
        }

        if (Date.now() - entry.timestamp > entry.ttl) {
            this.cache.delete(key);
            return undefined;
        }

        return entry.value;
    }

    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) {
            return false;
        }

        if (Date.now() - entry.timestamp > entry.ttl) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
    }

    // Clean up expired entries
    cleanup(): number {
        const now = Date.now();
        let removedCount = 0;

        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > entry.ttl) {
                this.cache.delete(key);
                removedCount++;
            }
        }

        return removedCount;
    }

    size(): number {
        // Clean up before reporting size
        this.cleanup();
        return this.cache.size;
    }

    // Get or set pattern - common caching pattern
    async getOrSet(
        key: string, 
        factory: () => Promise<T>, 
        ttl: number = this.defaultTTL
    ): Promise<T> {
        const cached = this.get(key);
        if (cached !== undefined) {
            return cached;
        }

        const value = await factory();
        this.set(key, value, ttl);
        return value;
    }

    // Invalidate keys matching a pattern
    invalidatePattern(pattern: RegExp): number {
        let removedCount = 0;
        for (const key of this.cache.keys()) {
            if (pattern.test(key)) {
                this.cache.delete(key);
                removedCount++;
            }
        }
        return removedCount;
    }
}

// Debounce utility for expensive operations
export class Debouncer {
    private timeouts = new Map<string, NodeJS.Timeout>();

    debounce<T extends unknown[]>(
        key: string,
        fn: (...args: T) => void,
        delay: number = PERFORMANCE.DEBOUNCE_DELAY_MS
    ): (...args: T) => void {
        return (...args: T) => {
            const existingTimeout = this.timeouts.get(key);
            if (existingTimeout) {
                clearTimeout(existingTimeout);
            }

            const timeout = setTimeout(() => {
                fn(...args);
                this.timeouts.delete(key);
            }, delay);

            this.timeouts.set(key, timeout);
        };
    }

    cancel(key: string): boolean {
        const timeout = this.timeouts.get(key);
        if (timeout) {
            clearTimeout(timeout);
            this.timeouts.delete(key);
            return true;
        }
        return false;
    }

    cancelAll(): void {
        for (const timeout of this.timeouts.values()) {
            clearTimeout(timeout);
        }
        this.timeouts.clear();
    }
}

// Batch operation utility
export class BatchProcessor<T> {
    private batch: T[] = [];
    private processingPromise: Promise<void> | undefined = undefined;
    
    constructor(
        private processor: (items: T[]) => Promise<void>,
        private batchSize: number = 10,
        private maxWaitTime: number = 1000
    ) {}

    async add(item: T): Promise<void> {
        this.batch.push(item);

        if (this.batch.length >= this.batchSize) {
            return this.flush();
        }

        if (!this.processingPromise) {
            this.processingPromise = new Promise((resolve) => {
                setTimeout(async () => {
                    await this.flush();
                    resolve();
                }, this.maxWaitTime);
            });
        }

        return this.processingPromise;
    }

    async flush(): Promise<void> {
        if (this.batch.length === 0) {
            return;
        }

        const currentBatch = [...this.batch];
        this.batch = [];
        this.processingPromise = undefined;

        await this.processor(currentBatch);
    }
}

// Create shared instances
export const fileExistenceCache = new Cache<boolean>();
export const categoryTreeCache = new Cache<CategoryNode>();
export const bookmarkCache = new Cache<Bookmark[]>();
export const debouncer = new Debouncer();