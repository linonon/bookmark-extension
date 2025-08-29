import * as vscode from 'vscode';
import { Bookmark, BookmarkData, CategoryNode } from '../models/bookmark';
import * as fs from 'fs';

export class BookmarkStorageService {
    private static readonly WORKSPACE_STORAGE_KEY = 'workspace-bookmarks';
    
    constructor(private context: vscode.ExtensionContext) {}
    
    async getBookmarks(): Promise<BookmarkData> {
        // Always use workspace storage now
        return this.getWorkspaceBookmarks();
    }
    
    async addBookmark(bookmark: Bookmark): Promise<void> {
        // Always use workspace storage now
        await this.addWorkspaceBookmark(bookmark);
    }
    
    async removeBookmark(bookmarkId: string): Promise<void> {
        // Always use workspace storage now
        await this.removeWorkspaceBookmark(bookmarkId);
    }
    
    async removeBookmarkByPath(filePath: string, lineNumber?: number): Promise<void> {
        // Always use workspace storage now
        const bookmarks = await this.getWorkspaceBookmarks();
        const filteredBookmarks = bookmarks.filter(b => {
            if (lineNumber !== undefined) {
                return !(b.filePath === filePath && b.lineNumber === lineNumber);
            }
            return b.filePath !== filePath;
        });
        await this.context.workspaceState.update(BookmarkStorageService.WORKSPACE_STORAGE_KEY, filteredBookmarks);
    }
    
    async updateBookmark(bookmarkId: string, updates: Partial<Bookmark>): Promise<void> {
        // Always use workspace storage now
        const bookmarks = await this.getWorkspaceBookmarks();
        const bookmarkIndex = bookmarks.findIndex(b => b.id === bookmarkId);
        
        if (bookmarkIndex >= 0) {
            bookmarks[bookmarkIndex] = { ...bookmarks[bookmarkIndex], ...updates };
            await this.context.workspaceState.update(BookmarkStorageService.WORKSPACE_STORAGE_KEY, bookmarks);
        }
    }
    
    async clearAllBookmarks(): Promise<void> {
        // Always use workspace storage now
        await this.clearWorkspaceBookmarks();
    }
    
    async replaceAllBookmarks(bookmarks: BookmarkData): Promise<void> {
        // Always use workspace storage now
        await this.context.workspaceState.update(BookmarkStorageService.WORKSPACE_STORAGE_KEY, bookmarks);
    }
    
    private async filterValidBookmarks(bookmarks: BookmarkData): Promise<BookmarkData> {
        const validBookmarks: BookmarkData = [];
        
        for (const bookmark of bookmarks) {
            try {
                // Check if file still exists
                await fs.promises.access(bookmark.filePath);
                validBookmarks.push(bookmark);
            } catch (error) {
                // File no longer exists, skip this bookmark
                console.log(`Bookmark file no longer exists: ${bookmark.filePath}`);
            }
        }
        
        // If we filtered out any bookmarks, update the storage
        if (validBookmarks.length !== bookmarks.length) {
            await this.context.workspaceState.update(BookmarkStorageService.WORKSPACE_STORAGE_KEY, validBookmarks);
        }
        
        return validBookmarks;
    }
    
    async getBookmarksByCategory(): Promise<Map<string, Bookmark[]>> {
        const bookmarks = await this.getBookmarks();
        const categorizedBookmarks = new Map<string, Bookmark[]>();
        
        for (const bookmark of bookmarks) {
            const category = bookmark.category || 'General';
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
            const categoryPath = bookmark.category || 'General';
            this.addBookmarkToTree(root, categoryPath, bookmark);
        }
        
        return root;
    }
    
    private addBookmarkToTree(root: CategoryNode, categoryPath: string, bookmark: Bookmark): void {
        const parts = categoryPath.split('/').filter(part => part.length > 0);
        if (parts.length === 0) {
            parts.push('General');
        }
        
        let currentNode = root;
        let currentPath = '';
        
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
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
            
            currentNode = currentNode.children.get(part)!;
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
            categories.add(bookmark.category || 'General');
        }
        
        return Array.from(categories).sort();
    }
    
    async addBookmarkToCategory(bookmark: Bookmark, category: string): Promise<void> {
        bookmark.category = category;
        await this.addBookmark(bookmark);
    }
    
    async moveBookmarkToCategory(bookmarkId: string, newCategory: string): Promise<void> {
        const bookmarks = await this.getBookmarks();
        const bookmarkIndex = bookmarks.findIndex(b => b.id === bookmarkId);
        
        if (bookmarkIndex >= 0) {
            bookmarks[bookmarkIndex].category = newCategory;
            await this.context.workspaceState.update(BookmarkStorageService.WORKSPACE_STORAGE_KEY, bookmarks);
        }
    }
    
    async removeCategory(categoryName: string): Promise<void> {
        const bookmarks = await this.getBookmarks();
        const updatedBookmarks = bookmarks.map(bookmark => {
            if (bookmark.category === categoryName) {
                return { ...bookmark, category: 'General' };
            }
            return bookmark;
        });
        await this.context.workspaceState.update(BookmarkStorageService.WORKSPACE_STORAGE_KEY, updatedBookmarks);
    }
    
    
    
    
    // Workspace-specific bookmark methods
    async getWorkspaceBookmarks(): Promise<BookmarkData> {
        const bookmarks = this.context.workspaceState.get<BookmarkData>(BookmarkStorageService.WORKSPACE_STORAGE_KEY, []);
        return this.filterValidBookmarks(bookmarks);
    }
    
    
    async addWorkspaceBookmark(bookmark: Bookmark): Promise<void> {
        const bookmarks = await this.getWorkspaceBookmarks();
        
        // Check if bookmark already exists for this file
        const existingIndex = bookmarks.findIndex(b => 
            b.filePath === bookmark.filePath && b.lineNumber === bookmark.lineNumber
        );
        
        if (existingIndex >= 0) {
            bookmarks[existingIndex] = bookmark;
        } else {
            bookmarks.push(bookmark);
        }
        
        await this.context.workspaceState.update(BookmarkStorageService.WORKSPACE_STORAGE_KEY, bookmarks);
    }
    
    async removeWorkspaceBookmark(bookmarkId: string): Promise<void> {
        const bookmarks = await this.getWorkspaceBookmarks();
        const filteredBookmarks = bookmarks.filter(b => b.id !== bookmarkId);
        await this.context.workspaceState.update(BookmarkStorageService.WORKSPACE_STORAGE_KEY, filteredBookmarks);
    }
    
    async clearWorkspaceBookmarks(): Promise<void> {
        await this.context.workspaceState.update(BookmarkStorageService.WORKSPACE_STORAGE_KEY, []);
    }
    
    generateBookmarkId(): string {
        return `bookmark_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }
    
}