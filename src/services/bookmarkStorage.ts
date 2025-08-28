import * as vscode from 'vscode';
import { Bookmark, BookmarkData } from '../models/bookmark';
import * as path from 'path';
import * as fs from 'fs';

export class BookmarkStorageService {
    private static readonly STORAGE_KEY = 'bookmarks';
    private static readonly WORKSPACE_STORAGE_KEY = 'workspace-bookmarks';
    
    constructor(private context: vscode.ExtensionContext) {}
    
    async getBookmarks(): Promise<BookmarkData> {
        const bookmarks = this.context.globalState.get<BookmarkData>(BookmarkStorageService.STORAGE_KEY, []);
        // Filter out bookmarks for files that no longer exist
        return this.filterValidBookmarks(bookmarks);
    }
    
    async addBookmark(bookmark: Bookmark): Promise<void> {
        const bookmarks = await this.getBookmarks();
        
        // Check if bookmark already exists for this file
        const existingIndex = bookmarks.findIndex(b => 
            b.filePath === bookmark.filePath && b.lineNumber === bookmark.lineNumber
        );
        
        if (existingIndex >= 0) {
            // Update existing bookmark
            bookmarks[existingIndex] = bookmark;
        } else {
            // Add new bookmark
            bookmarks.push(bookmark);
        }
        
        await this.saveBookmarks(bookmarks);
    }
    
    async removeBookmark(bookmarkId: string): Promise<void> {
        const bookmarks = await this.getBookmarks();
        const filteredBookmarks = bookmarks.filter(b => b.id !== bookmarkId);
        await this.saveBookmarks(filteredBookmarks);
    }
    
    async removeBookmarkByPath(filePath: string, lineNumber?: number): Promise<void> {
        const bookmarks = await this.getBookmarks();
        const filteredBookmarks = bookmarks.filter(b => {
            if (lineNumber !== undefined) {
                return !(b.filePath === filePath && b.lineNumber === lineNumber);
            }
            return b.filePath !== filePath;
        });
        await this.saveBookmarks(filteredBookmarks);
    }
    
    async updateBookmark(bookmarkId: string, updates: Partial<Bookmark>): Promise<void> {
        const bookmarks = await this.getBookmarks();
        const bookmarkIndex = bookmarks.findIndex(b => b.id === bookmarkId);
        
        if (bookmarkIndex >= 0) {
            bookmarks[bookmarkIndex] = { ...bookmarks[bookmarkIndex], ...updates };
            await this.saveBookmarks(bookmarks);
        }
    }
    
    async clearAllBookmarks(): Promise<void> {
        await this.saveBookmarks([]);
    }
    
    private async saveBookmarks(bookmarks: BookmarkData): Promise<void> {
        await this.context.globalState.update(BookmarkStorageService.STORAGE_KEY, bookmarks);
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
            await this.saveBookmarks(validBookmarks);
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
        
        // Sort bookmarks within each category
        for (const [category, bookmarks] of categorizedBookmarks) {
            bookmarks.sort((a, b) => {
                const aFileName = this.getFileName(a.filePath);
                const bFileName = this.getFileName(b.filePath);
                
                if (aFileName !== bFileName) {
                    return aFileName.localeCompare(bFileName);
                }
                
                return (a.lineNumber || 0) - (b.lineNumber || 0);
            });
        }
        
        return categorizedBookmarks;
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
            await this.saveBookmarks(bookmarks);
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
        await this.saveBookmarks(updatedBookmarks);
    }
    
    private getFileName(filePath: string): string {
        return filePath.split('/').pop() || filePath;
    }
    
    async exportBookmarks(): Promise<string> {
        const bookmarks = await this.getBookmarks();
        const exportData = {
            version: "1.0",
            exportedAt: new Date().toISOString(),
            bookmarks: bookmarks
        };
        return JSON.stringify(exportData, null, 2);
    }
    
    async importBookmarks(jsonData: string, mergeMode: boolean = true): Promise<{ success: number; errors: string[] }> {
        const result = { success: 0, errors: [] as string[] };
        
        try {
            const importData = JSON.parse(jsonData);
            
            if (!importData.bookmarks || !Array.isArray(importData.bookmarks)) {
                throw new Error('Invalid bookmark format: missing bookmarks array');
            }
            
            const existingBookmarks = mergeMode ? await this.getBookmarks() : [];
            const importedBookmarks = importData.bookmarks as Bookmark[];
            
            // Validate and process each bookmark
            for (const bookmark of importedBookmarks) {
                try {
                    // Validate required fields
                    if (!bookmark.filePath || !bookmark.id) {
                        result.errors.push(`Invalid bookmark: missing required fields`);
                        continue;
                    }
                    
                    // Generate new ID to avoid conflicts
                    const newBookmark: Bookmark = {
                        ...bookmark,
                        id: this.generateBookmarkId(),
                        createdAt: new Date(bookmark.createdAt || new Date())
                    };
                    
                    // Check if file exists (optional validation)
                    try {
                        await fs.promises.access(newBookmark.filePath);
                    } catch (error) {
                        // File doesn't exist, but we'll still import it
                        result.errors.push(`File not found: ${newBookmark.filePath}`);
                    }
                    
                    existingBookmarks.push(newBookmark);
                    result.success++;
                } catch (error) {
                    result.errors.push(`Error processing bookmark: ${error}`);
                }
            }
            
            await this.saveBookmarks(existingBookmarks);
            
        } catch (error) {
            result.errors.push(`Import failed: ${error}`);
        }
        
        return result;
    }
    
    // Workspace-specific bookmark methods
    async getWorkspaceBookmarks(): Promise<BookmarkData> {
        const bookmarks = this.context.workspaceState.get<BookmarkData>(BookmarkStorageService.WORKSPACE_STORAGE_KEY, []);
        return this.filterValidBookmarks(bookmarks);
    }
    
    async getAllBookmarks(includeWorkspace: boolean = false): Promise<BookmarkData> {
        const globalBookmarks = await this.getBookmarks();
        
        if (!includeWorkspace || !vscode.workspace.workspaceFolders) {
            return globalBookmarks;
        }
        
        const workspaceBookmarks = await this.getWorkspaceBookmarks();
        return [...globalBookmarks, ...workspaceBookmarks];
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