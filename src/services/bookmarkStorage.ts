import * as vscode from 'vscode';
import { Bookmark, BookmarkData, CategoryNode } from '../models/bookmark';
import * as fs from 'fs';
import { errorHandler } from '../utils/errorHandler';
import { STORAGE_KEYS, CATEGORIES } from '../constants';
import { fileExistenceCache, categoryTreeCache } from '../utils/cache';
import { InputValidator } from '../utils/validation';

export class BookmarkStorageService {
    private static readonly WORKSPACE_STORAGE_KEY = STORAGE_KEYS.WORKSPACE_BOOKMARKS;
    
    constructor(private context: vscode.ExtensionContext) {}
    
    async getBookmarks(): Promise<BookmarkData> {
        return await errorHandler.handleAsync(
            async () => {
                const bookmarks = this.context.workspaceState.get<BookmarkData>(
                    BookmarkStorageService.WORKSPACE_STORAGE_KEY, 
                    []
                );
                return this.filterValidBookmarks(bookmarks);
            },
            {
                operation: 'getBookmarks',
                showToUser: false // Internal operation, don't show errors to user
            }
        ) ?? [];
    }
    
    async addBookmark(bookmark: Bookmark): Promise<void> {
        await errorHandler.handleAsync(
            async () => {
                const bookmarks = await this.getBookmarks();
                
                // Check if bookmark already exists for this file
                const existingIndex = bookmarks.findIndex(b => 
                    b.filePath === bookmark.filePath && b.lineNumber === bookmark.lineNumber
                );
                
                if (existingIndex >= 0) {
                    bookmarks[existingIndex] = bookmark;
                    errorHandler.debug('Bookmark updated', {
                        operation: 'addBookmark',
                        details: { filePath: bookmark.filePath, lineNumber: bookmark.lineNumber }
                    });
                } else {
                    bookmarks.push(bookmark);
                    errorHandler.debug('Bookmark added', {
                        operation: 'addBookmark',
                        details: { filePath: bookmark.filePath, lineNumber: bookmark.lineNumber }
                    });
                }
                
                await this.context.workspaceState.update(BookmarkStorageService.WORKSPACE_STORAGE_KEY, bookmarks);
                this.clearCaches();
            },
            {
                operation: 'addBookmark',
                details: { bookmarkId: bookmark.id, filePath: bookmark.filePath },
                showToUser: true,
                userMessage: 'Failed to add bookmark. Please try again.'
            }
        );
    }

    private clearCaches(): void {
        // Clear caches when bookmark data changes
        categoryTreeCache.clear();
        fileExistenceCache.clear();
    }
    
    async removeBookmark(bookmarkId: string): Promise<void> {
        const bookmarks = await this.getBookmarks();
        const filteredBookmarks = bookmarks.filter(b => b.id !== bookmarkId);
        await this.context.workspaceState.update(BookmarkStorageService.WORKSPACE_STORAGE_KEY, filteredBookmarks);
    }
    
    async removeBookmarkByPath(filePath: string, lineNumber?: number): Promise<void> {
        const bookmarks = await this.getBookmarks();
        const filteredBookmarks = bookmarks.filter(b => {
            if (lineNumber !== undefined) {
                return !(b.filePath === filePath && b.lineNumber === lineNumber);
            }
            return b.filePath !== filePath;
        });
        await this.context.workspaceState.update(BookmarkStorageService.WORKSPACE_STORAGE_KEY, filteredBookmarks);
    }
    
    async updateBookmark(bookmarkId: string, updates: Partial<Bookmark>): Promise<void> {
        const bookmarks = await this.getBookmarks();
        const bookmarkIndex = bookmarks.findIndex(b => b.id === bookmarkId);
        
        if (bookmarkIndex >= 0) {
            const existingBookmark = bookmarks[bookmarkIndex];
            if (existingBookmark) {
                // Only update properties that are provided in updates
                const updatedBookmark: Bookmark = {
                    ...existingBookmark,
                    ...updates,
                    // Ensure core required fields are preserved
                    id: updates.id ?? existingBookmark.id,
                    filePath: updates.filePath ?? existingBookmark.filePath,
                    createdAt: updates.createdAt ?? existingBookmark.createdAt
                };
                bookmarks[bookmarkIndex] = updatedBookmark;
                await this.context.workspaceState.update(BookmarkStorageService.WORKSPACE_STORAGE_KEY, bookmarks);
            }
        }
    }
    
    async batchUpdateBookmarks(updates: Array<{ id: string; updates: Partial<Bookmark> }>): Promise<void> {
        await errorHandler.handleAsync(
            async () => {
                const bookmarks = await this.getBookmarks();
                let hasChanges = false;
                
                for (const { id, updates: bookmarkUpdates } of updates) {
                    const bookmarkIndex = bookmarks.findIndex(b => b.id === id);
                    
                    if (bookmarkIndex >= 0) {
                        const existingBookmark = bookmarks[bookmarkIndex];
                        if (existingBookmark) {
                            const updatedBookmark: Bookmark = {
                                ...existingBookmark,
                                ...bookmarkUpdates,
                                // Ensure core required fields are preserved
                                id: bookmarkUpdates.id ?? existingBookmark.id,
                                filePath: bookmarkUpdates.filePath ?? existingBookmark.filePath,
                                createdAt: bookmarkUpdates.createdAt ?? existingBookmark.createdAt
                            };
                            bookmarks[bookmarkIndex] = updatedBookmark;
                            hasChanges = true;
                        }
                    }
                }
                
                if (hasChanges) {
                    await this.context.workspaceState.update(BookmarkStorageService.WORKSPACE_STORAGE_KEY, bookmarks);
                    this.clearCaches();
                }
            },
            {
                operation: 'batchUpdateBookmarks',
                details: { updateCount: updates.length },
                showToUser: false
            }
        );
    }
    
    async clearAllBookmarks(): Promise<void> {
        await this.context.workspaceState.update(BookmarkStorageService.WORKSPACE_STORAGE_KEY, []);
    }
    
    async replaceAllBookmarks(bookmarks: BookmarkData): Promise<void> {
        await this.context.workspaceState.update(BookmarkStorageService.WORKSPACE_STORAGE_KEY, bookmarks);
    }
    
    private async filterValidBookmarks(bookmarks: BookmarkData): Promise<BookmarkData> {
        const validBookmarks: BookmarkData = [];
        let removedCount = 0;
        
        for (const bookmark of bookmarks) {
            // Skip file existence check for placeholder bookmarks
            if (bookmark.filePath.startsWith(CATEGORIES.PLACEHOLDER_PREFIX)) {
                validBookmarks.push(bookmark);
                continue;
            }
            
            // Check cache first for file existence
            const cacheKey = `file-exists:${bookmark.filePath}`;
            let fileExists = fileExistenceCache.get(cacheKey);
            
            if (fileExists === undefined) {
                // Not in cache, check file system
                try {
                    await fs.promises.access(bookmark.filePath);
                    fileExists = true;
                    fileExistenceCache.set(cacheKey, true, 30000); // Cache for 30 seconds
                } catch (error) {
                    fileExists = false;
                    fileExistenceCache.set(cacheKey, false, 5000); // Cache negative results for 5 seconds
                }
            }
            
            if (fileExists) {
                validBookmarks.push(bookmark);
            } else {
                // File no longer exists, skip this bookmark
                removedCount++;
                errorHandler.debug('Bookmark removed - file no longer exists', {
                    operation: 'filterValidBookmarks',
                    details: { 
                        bookmarkId: bookmark.id, 
                        filePath: bookmark.filePath,
                        label: bookmark.label 
                    }
                });
            }
        }
        
        // If we filtered out any bookmarks, update the storage
        if (validBookmarks.length !== bookmarks.length) {
            await this.context.workspaceState.update(BookmarkStorageService.WORKSPACE_STORAGE_KEY, validBookmarks);
            
            if (removedCount > 0) {
                errorHandler.info(`Cleaned up ${removedCount} bookmarks for deleted files`, {
                    operation: 'filterValidBookmarks',
                    details: { removedCount, totalBookmarks: bookmarks.length },
                    showToUser: removedCount >= 5, // Only notify users if many bookmarks were removed
                    userMessage: `Removed ${removedCount} bookmarks for files that no longer exist.`
                });
            }
        }
        
        return validBookmarks;
    }
    
    async getBookmarksByCategory(): Promise<Map<string | null, Bookmark[]>> {
        const bookmarks = await this.getBookmarks();
        const categorizedBookmarks = new Map<string | null, Bookmark[]>();
        
        for (const bookmark of bookmarks) {
            const category = InputValidator.getCategoryForComparison(bookmark.category);
            if (!categorizedBookmarks.has(category)) {
                categorizedBookmarks.set(category, []);
            }
            categorizedBookmarks.get(category)!.push(bookmark);
        }
        
        return categorizedBookmarks;
    }
    
    buildCategoryTree(): CategoryNode {
        const root: CategoryNode = {
            name: 'root',
            fullPath: '',
            children: new Map(),
            bookmarks: [],
            isExpanded: true
        };
        
        return root;
    }
    
    async getCategoryTree(): Promise<CategoryNode> {
        const bookmarks = await this.getBookmarks();
        const root = this.buildCategoryTree();
        
        for (const bookmark of bookmarks) {
            if (bookmark.category === null || bookmark.category === undefined) {
                // Add uncategorized bookmarks directly to root
                root.bookmarks.push(bookmark);
            } else {
                this.addBookmarkToTree(root, bookmark.category, bookmark);
            }
        }
        
        return root;
    }
    
    private addBookmarkToTree(root: CategoryNode, categoryPath: string, bookmark: Bookmark): void {
        const parts = categoryPath.split('/').filter(part => part.length > 0);
        if (parts.length === 0) {
            // If categoryPath is empty, add directly to root
            root.bookmarks.push(bookmark);
            return;
        }
        
        let currentNode = root;
        let currentPath = '';
        
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (!part) {
                continue; // Skip undefined or empty parts
            }
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            
            if (!currentNode.children.has(part)) {
                currentNode.children.set(part, {
                    name: part,
                    fullPath: currentPath,
                    children: new Map(),
                    bookmarks: [],
                    isExpanded: true
                });
            }
            
            const childNode = currentNode.children.get(part);
            if (childNode) {
                currentNode = childNode;
            }
        }
        
        // Add bookmark to the leaf node
        currentNode.bookmarks.push(bookmark);
    }
    
    getAvailableCategories(node?: CategoryNode): string[] {
        const root = node || this.buildCategoryTree();
        const categories: string[] = [];
        
        const collectCategories = (currentNode: CategoryNode, pathPrefix: string = '') => {
            for (const [name, child] of currentNode.children) {
                const fullPath = pathPrefix ? `${pathPrefix}/${name}` : name;
                categories.push(fullPath);
                collectCategories(child, fullPath);
            }
        };
        
        collectCategories(root);
        return categories.sort();
    }
    
    async getCategories(): Promise<string[]> {
        const bookmarks = await this.getBookmarks();
        const categories = new Set<string>();
        
        for (const bookmark of bookmarks) {
            if (bookmark.category) {
                categories.add(bookmark.category);
            }
        }
        
        return Array.from(categories).sort();
    }
    
    async addBookmarkToCategory(bookmark: Bookmark, category: string): Promise<void> {
        bookmark.category = category;
        await this.addBookmark(bookmark);
    }
    
    async moveBookmarkToCategory(bookmarkId: string, newCategory: string | null): Promise<void> {
        const bookmarks = await this.getBookmarks();
        const bookmarkIndex = bookmarks.findIndex(b => b.id === bookmarkId);
        
        if (bookmarkIndex >= 0) {
            const bookmark = bookmarks[bookmarkIndex];
            if (bookmark) {
                bookmark.category = newCategory;
                await this.context.workspaceState.update(BookmarkStorageService.WORKSPACE_STORAGE_KEY, bookmarks);
                this.clearCaches();
            }
        }
    }
    
    async removeCategory(categoryName: string): Promise<void> {
        const bookmarks = await this.getBookmarks();
        const updatedBookmarks = bookmarks.map(bookmark => {
            if (bookmark.category === categoryName) {
                return { ...bookmark, category: null };
            }
            return bookmark;
        });
        await this.context.workspaceState.update(BookmarkStorageService.WORKSPACE_STORAGE_KEY, updatedBookmarks);
    }
    
    
    generateBookmarkId(): string {
        return `bookmark_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }
    
}