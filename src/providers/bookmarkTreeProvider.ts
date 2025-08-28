import * as vscode from 'vscode';
import { Bookmark, BookmarkItem, CategoryItem } from '../models/bookmark';
import { BookmarkStorageService } from '../services/bookmarkStorage';

export class BookmarkTreeProvider implements 
    vscode.TreeDataProvider<BookmarkItem | CategoryItem>, 
    vscode.TreeDragAndDropController<BookmarkItem | CategoryItem> {
    
    private _onDidChangeTreeData: vscode.EventEmitter<BookmarkItem | CategoryItem | undefined | null | void> = new vscode.EventEmitter<BookmarkItem | CategoryItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<BookmarkItem | CategoryItem | undefined | null | void> = this._onDidChangeTreeData.event;
    
    // Drag and drop MIME types
    readonly dropMimeTypes = ['application/vnd.code.tree.bookmarkExplorer'];
    readonly dragMimeTypes = ['application/vnd.code.tree.bookmarkExplorer'];
    
    constructor(private storageService: BookmarkStorageService) {}
    
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
    
    getTreeItem(element: BookmarkItem | CategoryItem): vscode.TreeItem {
        return element;
    }
    
    async getChildren(element?: BookmarkItem | CategoryItem): Promise<(BookmarkItem | CategoryItem)[]> {
        if (!element) {
            // Root level - return category folders
            const categorizedBookmarks = await this.storageService.getBookmarksByCategory();
            const categories: CategoryItem[] = [];
            
            for (const [categoryName, bookmarks] of categorizedBookmarks) {
                categories.push(new CategoryItem(categoryName, bookmarks.length));
            }
            
            return categories.sort((a, b) => {
                // Put 'General' category first
                if (a.categoryName === 'General') {
                    return -1;
                }
                if (b.categoryName === 'General') {
                    return 1;
                }
                return a.categoryName.localeCompare(b.categoryName);
            });
        }
        
        if (element instanceof CategoryItem) {
            // Return bookmarks in this category
            const categorizedBookmarks = await this.storageService.getBookmarksByCategory();
            const categoryBookmarks = categorizedBookmarks.get(element.categoryName) || [];
            return categoryBookmarks.map(bookmark => new BookmarkItem(bookmark));
        }
        
        return [];
    }
    
    private getFileName(filePath: string): string {
        return filePath.split('/').pop() || filePath;
    }
    
    async addCurrentFileBookmark(label?: string, lineNumber?: number, category?: string): Promise<void> {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showErrorMessage('No active file to bookmark');
            return;
        }
        
        const filePath = activeEditor.document.fileName;
        const currentLine = lineNumber || (activeEditor.selection.active.line + 1);
        
        // Generate a default label if none provided
        const defaultLabel = label || `${this.getFileName(filePath)}:${currentLine}`;
        
        // If no category provided, ask user
        let selectedCategory = category || 'General';
        if (!category) {
            const categories = await this.storageService.getCategories();
            const categoryOptions = [...categories, '+ Create New Category'];
            
            const selectedOption = await vscode.window.showQuickPick(categoryOptions, {
                placeHolder: 'Select category for bookmark'
            });
            
            if (selectedOption === undefined) {
                return; // User cancelled
            }
            
            if (selectedOption === '+ Create New Category') {
                const newCategory = await vscode.window.showInputBox({
                    prompt: 'Enter new category name',
                    placeHolder: 'My Category'
                });
                
                if (!newCategory) {
                    return; // User cancelled
                }
                selectedCategory = newCategory;
            } else {
                selectedCategory = selectedOption;
            }
        }
        
        const bookmark: Bookmark = {
            id: this.storageService.generateBookmarkId(),
            filePath: filePath,
            label: defaultLabel,
            lineNumber: currentLine,
            workspacePath: vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)?.uri.fsPath,
            category: selectedCategory,
            createdAt: new Date()
        };
        
        await this.storageService.addBookmark(bookmark);
        this.refresh();
        
        vscode.window.showInformationMessage(`Bookmark added to ${selectedCategory}: ${defaultLabel}`);
    }
    
    async addCurrentFileBookmarkWithLabel(): Promise<void> {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showErrorMessage('No active file to bookmark');
            return;
        }
        
        const filePath = activeEditor.document.fileName;
        const currentLine = activeEditor.selection.active.line + 1;
        const defaultLabel = `${this.getFileName(filePath)}:${currentLine}`;
        
        // Step 1: Get label from user first
        const label = await vscode.window.showInputBox({
            prompt: 'Enter bookmark label',
            placeHolder: 'Enter descriptive label for this bookmark',
            value: defaultLabel
        });
        
        if (label === undefined) {
            return; // User cancelled
        }
        
        // Step 2: Get category selection
        const categories = await this.storageService.getCategories();
        const categoryOptions = [...categories, '+ Create New Category'];
        
        const selectedOption = await vscode.window.showQuickPick(categoryOptions, {
            placeHolder: 'Select category for bookmark'
        });
        
        if (selectedOption === undefined) {
            return; // User cancelled
        }
        
        let selectedCategory = selectedOption;
        if (selectedOption === '+ Create New Category') {
            const newCategory = await vscode.window.showInputBox({
                prompt: 'Enter new category name',
                placeHolder: 'My Category'
            });
            
            if (!newCategory) {
                return; // User cancelled
            }
            selectedCategory = newCategory;
        }
        
        const bookmark: Bookmark = {
            id: this.storageService.generateBookmarkId(),
            filePath: filePath,
            label: label,
            lineNumber: currentLine,
            workspacePath: vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)?.uri.fsPath,
            category: selectedCategory,
            createdAt: new Date()
        };
        
        await this.storageService.addBookmark(bookmark);
        this.refresh();
        
        vscode.window.showInformationMessage(`Bookmark added to ${selectedCategory}: ${label}`);
    }
    
    async removeBookmark(bookmarkItem: BookmarkItem): Promise<void> {
        await this.storageService.removeBookmark(bookmarkItem.bookmark.id);
        this.refresh();
        
        vscode.window.showInformationMessage(`Bookmark removed: ${bookmarkItem.bookmark.label || bookmarkItem.bookmark.filePath}`);
    }
    
    async editBookmarkLabel(bookmarkItem: BookmarkItem): Promise<void> {
        const newLabel = await vscode.window.showInputBox({
            prompt: 'Enter new bookmark label',
            value: bookmarkItem.bookmark.label || this.getFileName(bookmarkItem.bookmark.filePath)
        });
        
        if (newLabel !== undefined && newLabel !== bookmarkItem.bookmark.label) {
            await this.storageService.updateBookmark(bookmarkItem.bookmark.id, { label: newLabel });
            this.refresh();
            
            vscode.window.showInformationMessage(`Bookmark label updated to: ${newLabel}`);
        }
    }
    
    async clearAllBookmarks(): Promise<void> {
        const confirmation = await vscode.window.showWarningMessage(
            'Are you sure you want to clear all bookmarks?',
            { modal: true },
            'Yes',
            'No'
        );
        
        if (confirmation === 'Yes') {
            await this.storageService.clearAllBookmarks();
            this.refresh();
            vscode.window.showInformationMessage('All bookmarks cleared');
        }
    }
    
    async openBookmarkFile(bookmark: Bookmark): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(bookmark.filePath);
            const editor = await vscode.window.showTextDocument(document);
            
            if (bookmark.lineNumber) {
                const position = new vscode.Position(bookmark.lineNumber - 1, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position));
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open file: ${bookmark.filePath}`);
        }
    }
    
    
    async renameCategory(categoryItem: CategoryItem): Promise<void> {
        const newName = await vscode.window.showInputBox({
            prompt: 'Enter new category name',
            value: categoryItem.categoryName,
            placeHolder: 'Category name'
        });
        
        if (newName && newName !== categoryItem.categoryName) {
            // Get all bookmarks in the old category and move them to new category
            const categorizedBookmarks = await this.storageService.getBookmarksByCategory();
            const bookmarksInCategory = categorizedBookmarks.get(categoryItem.categoryName) || [];
            
            for (const bookmark of bookmarksInCategory) {
                await this.storageService.moveBookmarkToCategory(bookmark.id, newName);
            }
            
            this.refresh();
            vscode.window.showInformationMessage(`Category renamed to: ${newName}`);
        }
    }
    
    async removeCategory(categoryItem: CategoryItem): Promise<void> {
        const confirmation = await vscode.window.showWarningMessage(
            `Remove category "${categoryItem.categoryName}"? All bookmarks will be moved to "General".`,
            { modal: true },
            'Remove',
            'Cancel'
        );
        
        if (confirmation === 'Remove') {
            await this.storageService.removeCategory(categoryItem.categoryName);
            this.refresh();
            vscode.window.showInformationMessage(`Category "${categoryItem.categoryName}" removed`);
        }
    }
    
    async createNewCategory(): Promise<void> {
        const categoryName = await vscode.window.showInputBox({
            prompt: 'Enter category name',
            placeHolder: 'My Category'
        });
        
        if (categoryName) {
            // Category will be created when first bookmark is added to it
            vscode.window.showInformationMessage(`Category "${categoryName}" will be created when you add a bookmark to it.`);
        }
    }
    
    async searchBookmarks(): Promise<void> {
        const searchTerm = await vscode.window.showInputBox({
            prompt: 'Search bookmarks by name or file path',
            placeHolder: 'Enter search term...'
        });
        
        if (!searchTerm) {
            return;
        }
        
        const bookmarks = await this.storageService.getBookmarks();
        const filteredBookmarks = bookmarks.filter(bookmark => {
            const fileName = this.getFileName(bookmark.filePath).toLowerCase();
            const filePath = bookmark.filePath.toLowerCase();
            const label = (bookmark.label || '').toLowerCase();
            const category = (bookmark.category || '').toLowerCase();
            const term = searchTerm.toLowerCase();
            
            return fileName.includes(term) || 
                   filePath.includes(term) || 
                   label.includes(term) || 
                   category.includes(term);
        });
        
        if (filteredBookmarks.length === 0) {
            vscode.window.showInformationMessage(`No bookmarks found for: ${searchTerm}`);
            return;
        }
        
        // Create quick pick items
        const quickPickItems = filteredBookmarks.map(bookmark => ({
            label: bookmark.label || this.getFileName(bookmark.filePath),
            description: `${bookmark.category || 'General'} • Line ${bookmark.lineNumber || 1}`,
            detail: bookmark.filePath,
            bookmark: bookmark
        }));
        
        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: `Found ${filteredBookmarks.length} bookmarks`,
            matchOnDescription: true,
            matchOnDetail: true
        });
        
        if (selected) {
            await this.openBookmarkFile(selected.bookmark);
        }
    }
    
    // Drag and Drop Implementation
    async handleDrag(source: (BookmarkItem | CategoryItem)[], treeDataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
        // Only allow dragging bookmarks, not categories
        const bookmarkItems = source.filter(item => item instanceof BookmarkItem) as BookmarkItem[];
        if (bookmarkItems.length === 0) {
            return;
        }
        
        // Store the bookmark data for transfer
        const draggedData = bookmarkItems.map(item => ({
            id: item.bookmark.id,
            filePath: item.bookmark.filePath,
            label: item.bookmark.label,
            lineNumber: item.bookmark.lineNumber,
            category: item.bookmark.category
        }));
        
        treeDataTransfer.set('application/vnd.code.tree.bookmarkExplorer', new vscode.DataTransferItem(draggedData));
    }
    
    async handleDrop(target: BookmarkItem | CategoryItem | undefined, dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
        // Get the dragged bookmark data
        const transferItem = dataTransfer.get('application/vnd.code.tree.bookmarkExplorer');
        if (!transferItem) {
            return;
        }
        
        const draggedBookmarks = transferItem.value as Array<{
            id: string;
            filePath: string;
            label?: string;
            lineNumber?: number;
            category?: string;
        }>;
        
        if (!draggedBookmarks || draggedBookmarks.length === 0) {
            return;
        }
        
        // Determine target category
        let targetCategory = 'General';
        
        if (target instanceof CategoryItem) {
            // Dropped on a category folder
            targetCategory = target.categoryName;
        } else if (target instanceof BookmarkItem) {
            // Dropped on another bookmark - use that bookmark's category
            targetCategory = target.bookmark.category || 'General';
        }
        // If target is undefined, dropped on empty space - use General
        
        // Move each dragged bookmark to the target category
        let movedCount = 0;
        for (const draggedBookmark of draggedBookmarks) {
            // Skip if already in target category
            if ((draggedBookmark.category || 'General') === targetCategory) {
                continue;
            }
            
            await this.storageService.moveBookmarkToCategory(draggedBookmark.id, targetCategory);
            movedCount++;
        }
        
        if (movedCount > 0) {
            this.refresh();
            
            const bookmarkText = movedCount === 1 ? 'bookmark' : 'bookmarks';
            vscode.window.showInformationMessage(
                `Moved ${movedCount} ${bookmarkText} to "${targetCategory}" category`
            );
        }
    }
    
}