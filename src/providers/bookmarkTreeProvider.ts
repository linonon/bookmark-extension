import * as vscode from 'vscode';
import { Bookmark, BookmarkItem, CategoryItem, CategoryNode } from '../models/bookmark';
import { BookmarkStorageService } from '../services/bookmarkStorage';
import { GutterDecorationService } from '../services/gutterDecorationService';
import { CategoryColorService } from '../services/categoryColorService';
import { ContentAnchorService } from '../services/contentAnchorService';
import { errorHandler } from '../utils/errorHandler';
import { DRAG_DROP, CATEGORIES } from '../constants';
import { InputValidator } from '../utils/validation';
import { debouncer, categoryTreeCache } from '../utils/cache';

export class BookmarkTreeProvider implements 
    vscode.TreeDataProvider<BookmarkItem | CategoryItem>, 
    vscode.TreeDragAndDropController<BookmarkItem | CategoryItem> {
    
    private _onDidChangeTreeData: vscode.EventEmitter<BookmarkItem | CategoryItem | undefined | null | void> = new vscode.EventEmitter<BookmarkItem | CategoryItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<BookmarkItem | CategoryItem | undefined | null | void> = this._onDidChangeTreeData.event;
    
    // Drag and drop MIME types
    readonly dropMimeTypes = [DRAG_DROP.MIME_TYPE];
    readonly dragMimeTypes = [DRAG_DROP.MIME_TYPE, DRAG_DROP.URI_LIST_MIME_TYPE];
    private gutterDecorationService?: GutterDecorationService;
    private categoryColorService?: CategoryColorService;
    private contentAnchorService?: ContentAnchorService;
    
    constructor(private storageService: BookmarkStorageService) {}
    
    setGutterDecorationService(gutterService: GutterDecorationService): void {
        this.gutterDecorationService = gutterService;
    }
    
    setCategoryColorService(colorService: CategoryColorService): void {
        this.categoryColorService = colorService;
    }
    
    setContentAnchorService(anchorService: ContentAnchorService): void {
        this.contentAnchorService = anchorService;
    }
    
    private sortTreeItems(items: (BookmarkItem | CategoryItem)[]): (BookmarkItem | CategoryItem)[] {
        return items.sort((a, b) => {
            // Categories first, then bookmarks
            if (a instanceof CategoryItem && b instanceof BookmarkItem) {
                return -1;
            }
            if (a instanceof BookmarkItem && b instanceof CategoryItem) {
                return 1;
            }
            
            // Sort categories alphabetically
            if (a instanceof CategoryItem && b instanceof CategoryItem) {
                return a.categoryName.localeCompare(b.categoryName);
            }
            
            // Sort bookmarks by label
            if (a instanceof BookmarkItem && b instanceof BookmarkItem) {
                const aLabel = a.bookmark.label || a.bookmark.filePath;
                const bLabel = b.bookmark.label || b.bookmark.filePath;
                return aLabel.localeCompare(bLabel);
            }
            
            return 0;
        });
    }
    
    private _debouncedRefresh = debouncer.debounce('tree-refresh', () => {
        this._onDidChangeTreeData.fire();
        // Invalidate cache when tree structure changes
        categoryTreeCache.clear();
    }, 100); // Debounce for 100ms

    refresh(): void {
        this._debouncedRefresh();
    }

    // Immediate refresh for critical operations
    refreshImmediate(): void {
        this._onDidChangeTreeData.fire();
        categoryTreeCache.clear();
    }
    
    getTreeItem(element: BookmarkItem | CategoryItem): vscode.TreeItem {
        return element;
    }
    
    async getChildren(element?: BookmarkItem | CategoryItem): Promise<(BookmarkItem | CategoryItem)[]> {
        if (!element) {
            // Root level - return both categories and uncategorized bookmarks
            const categoryTree = await this.storageService.getCategoryTree();
            const result: (BookmarkItem | CategoryItem)[] = [];
            
            // Add root-level categories (only if they have content)
            for (const [categoryName, categoryNode] of categoryTree.children) {
                const hasChildren = categoryNode.children.size > 0;
                const bookmarkCount = this.getBookmarkCountInNode(categoryNode);
                
                // Check if category has any content (bookmarks or subcategories)
                const hasRealContent = hasChildren || categoryNode.bookmarks.length > 0;
                
                if (hasRealContent) {
                    result.push(new CategoryItem(
                        categoryName,
                        categoryNode.fullPath,
                        bookmarkCount,
                        hasChildren,
                        0
                    ));
                }
            }
            
            // Add root-level bookmarks (uncategorized bookmarks), excluding placeholder bookmarks
            for (const bookmark of categoryTree.bookmarks) {
                if (!bookmark.filePath.startsWith(CATEGORIES.PLACEHOLDER_PREFIX)) {
                    result.push(new BookmarkItem(bookmark));
                }
            }
            
            return this.sortTreeItems(result);
        }
        
        if (element instanceof CategoryItem) {
            // Find the category node in the tree
            const categoryTree = await this.storageService.getCategoryTree();
            const categoryNode = this.findCategoryNode(categoryTree, element.fullPath);
            
            if (!categoryNode) {
                return [];
            }
            
            const result: (BookmarkItem | CategoryItem)[] = [];
            
            // Add subcategories
            for (const [subCategoryName, subCategoryNode] of categoryNode.children) {
                const hasChildren = subCategoryNode.children.size > 0;
                const bookmarkCount = this.getBookmarkCountInNode(subCategoryNode);
                
                // Check if subcategory has any content (bookmarks or subcategories)
                const hasRealContent = hasChildren || subCategoryNode.bookmarks.length > 0;
                
                if (hasRealContent) {
                    result.push(new CategoryItem(
                        subCategoryName,
                        subCategoryNode.fullPath,
                        bookmarkCount,
                        hasChildren,
                        element.level + 1
                    ));
                }
            }
            
            // Add bookmarks in this category, excluding placeholder bookmarks
            for (const bookmark of categoryNode.bookmarks) {
                if (!bookmark.filePath.startsWith(CATEGORIES.PLACEHOLDER_PREFIX)) {
                    result.push(new BookmarkItem(bookmark));
                }
            }
            
            return this.sortTreeItems(result);
        }
        
        return [];
    }
    
    private getFileName(filePath: string): string {
        return filePath.split('/').pop() || filePath;
    }
    
    private findCategoryNode(root: CategoryNode, fullPath: string): CategoryNode | undefined {
        if (fullPath === '' || fullPath === 'root') {
            return root;
        }
        
        const parts = fullPath.split('/').filter(part => part.length > 0);
        let currentNode = root;
        
        for (const part of parts) {
            const childNode = currentNode.children.get(part);
            if (!childNode) {
                return undefined;
            }
            currentNode = childNode;
        }
        
        return currentNode;
    }
    
    private getBookmarkCountInNode(node: CategoryNode): number {
        // Count only non-placeholder bookmarks
        let count = node.bookmarks.filter(b => !b.filePath.startsWith(CATEGORIES.PLACEHOLDER_PREFIX)).length;
        
        // Recursively count bookmarks in child nodes
        for (const [, childNode] of node.children) {
            count += this.getBookmarkCountInNode(childNode);
        }
        
        return count;
    }
    
    async addCurrentFileBookmark(label?: string, lineNumber?: number, category?: string): Promise<void> {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            errorHandler.warn('No active file to bookmark', {
                operation: 'addCurrentFileBookmark',
                showToUser: true,
                userMessage: 'No active file to bookmark. Please open a file first.'
            });
            return;
        }
        
        const filePath = activeEditor.document.fileName;
        const currentLine = lineNumber || (activeEditor.selection.active.line + 1);

        // Disallow adding bookmarks on blank lines
        try {
            const idx = currentLine - 1;
            if (idx >= 0 && idx < activeEditor.document.lineCount) {
                const text = activeEditor.document.lineAt(idx).text;
                if (text.trim().length === 0) {
                    errorHandler.warn('Cannot add bookmark to blank line', {
                        operation: 'addCurrentFileBookmark',
                        showToUser: true,
                        userMessage: 'Cannot add a bookmark to a blank line. Place the cursor on a non-empty line.'
                    });
                    return;
                }
            }
        } catch {
            // Ignore and proceed; other validations will catch issues
        }
        
        // Generate a default label if none provided
        const defaultLabel = label || `${this.getFileName(filePath)}:${currentLine}`;
        
        // If no category provided, ask user
        let selectedCategory: string | null = category || null;
        if (!category) {
            const categoryTree = await this.storageService.getCategoryTree();
            const categories = this.storageService.getAvailableCategories(categoryTree);
            const categoryOptions = [CATEGORIES.NO_CATEGORY_DISPLAY, ...categories, '+ Create New Category'];
            
            const selectedOption = await vscode.window.showQuickPick(categoryOptions, {
                placeHolder: 'Select category for bookmark (or choose no category)'
            });
            
            if (selectedOption === undefined) {
                return; // User cancelled
            }
            
            if (selectedOption === CATEGORIES.NO_CATEGORY_DISPLAY) {
                selectedCategory = null;
            } else if (selectedOption === '+ Create New Category') {
                const newCategory = await vscode.window.showInputBox({
                    prompt: 'Enter new category name (use / for nested categories, e.g., Frontend/React)',
                    placeHolder: 'My Category or Parent/Child Category'
                });
                
                if (!newCategory) {
                    return; // User cancelled
                }
                selectedCategory = newCategory;
            } else {
                selectedCategory = selectedOption;
            }
        }
        
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
        
        // Generate content anchor for position tracking
        let contentAnchor: string | undefined;
        let lastKnownContent: string | undefined;
        
        try {
            const lineIndex = currentLine - 1;
            if (lineIndex >= 0 && lineIndex < activeEditor.document.lineCount) {
                const lineText = activeEditor.document.lineAt(lineIndex).text;
                if (this.contentAnchorService) {
                    contentAnchor = this.contentAnchorService.generateAnchor(lineText);
                    lastKnownContent = lineText;
                }
            }
        } catch (error) {
            errorHandler.debug('Failed to generate content anchor for new bookmark', {
                operation: 'addCurrentFileBookmark',
                details: { filePath, lineNumber: currentLine }
            });
        }
        
        const bookmark: Bookmark = {
            id: this.storageService.generateBookmarkId(),
            filePath: filePath,
            label: defaultLabel,
            lineNumber: currentLine,
            ...(workspaceFolder?.uri.fsPath && { workspacePath: workspaceFolder.uri.fsPath }),
            category: selectedCategory,
            createdAt: new Date(),
            
            // Position tracking fields - only set if they exist
            ...(contentAnchor && { contentAnchor }),
            ...(lastKnownContent && { lastKnownContent }),
            trackingEnabled: true  // Enable tracking by default for new bookmarks
        };
        
        await this.storageService.addBookmark(bookmark);
        this.refresh();
        
        // Update gutter decorations for the current file
        if (this.gutterDecorationService) {
            await this.gutterDecorationService.updateDecorationsForFile(filePath);
        }
    }
    
    async addCurrentFileBookmarkWithLabel(): Promise<void> {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showErrorMessage('No active file to bookmark');
            return;
        }
        
        const filePath = activeEditor.document.fileName;
        const currentLine = activeEditor.selection.active.line + 1;

        // Disallow adding bookmarks on blank lines
        try {
            const idx = currentLine - 1;
            if (idx >= 0 && idx < activeEditor.document.lineCount) {
                const text = activeEditor.document.lineAt(idx).text;
                if (text.trim().length === 0) {
                    errorHandler.warn('Cannot add bookmark to blank line', {
                        operation: 'addCurrentFileBookmarkWithLabel',
                        showToUser: true,
                        userMessage: 'Cannot add a bookmark to a blank line. Place the cursor on a non-empty line.'
                    });
                    return;
                }
            }
        } catch {
            // Ignore and proceed; other validations will catch issues
        }
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
        const categoryTree = await this.storageService.getCategoryTree();
        const categories = this.storageService.getAvailableCategories(categoryTree);
        const categoryOptions = [CATEGORIES.NO_CATEGORY_DISPLAY, ...categories, '+ Create New Category'];
        
        const selectedOption = await vscode.window.showQuickPick(categoryOptions, {
            placeHolder: 'Select category for bookmark (or choose no category)'
        });
        
        if (selectedOption === undefined) {
            return; // User cancelled
        }
        
        let selectedCategory: string | null = selectedOption;
        if (selectedOption === CATEGORIES.NO_CATEGORY_DISPLAY) {
            selectedCategory = null;
        } else if (selectedOption === '+ Create New Category') {
            const newCategory = await vscode.window.showInputBox({
                prompt: 'Enter new category name (use / for nested categories, e.g., Frontend/React)',
                placeHolder: 'My Category or Parent/Child Category'
            });
            
            if (!newCategory) {
                return; // User cancelled
            }
            selectedCategory = newCategory;
        }
        
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
        
        // Generate content anchor for position tracking
        let contentAnchor: string | undefined;
        let lastKnownContent: string | undefined;
        
        try {
            const lineIndex = currentLine - 1;
            if (lineIndex >= 0 && lineIndex < activeEditor.document.lineCount) {
                const lineText = activeEditor.document.lineAt(lineIndex).text;
                if (this.contentAnchorService) {
                    contentAnchor = this.contentAnchorService.generateAnchor(lineText);
                    lastKnownContent = lineText;
                }
            }
        } catch (error) {
            errorHandler.debug('Failed to generate content anchor for new bookmark', {
                operation: 'addCurrentFileBookmarkWithLabel',
                details: { filePath, lineNumber: currentLine }
            });
        }
        
        const bookmark: Bookmark = {
            id: this.storageService.generateBookmarkId(),
            filePath: filePath,
            label: label,
            lineNumber: currentLine,
            ...(workspaceFolder?.uri.fsPath && { workspacePath: workspaceFolder.uri.fsPath }),
            category: selectedCategory,
            createdAt: new Date(),
            
            // Position tracking fields - only set if they exist
            ...(contentAnchor && { contentAnchor }),
            ...(lastKnownContent && { lastKnownContent }),
            trackingEnabled: true  // Enable tracking by default for new bookmarks
        };
        
        await this.storageService.addBookmark(bookmark);
        this.refresh();
        
        // Update gutter decorations for the current file
        if (this.gutterDecorationService) {
            await this.gutterDecorationService.updateDecorationsForFile(filePath);
        }
    }
    
    async removeBookmark(bookmarkItem: BookmarkItem): Promise<void> {
        const filePath = bookmarkItem.bookmark.filePath;
        await this.storageService.removeBookmark(bookmarkItem.bookmark.id);
        this.refresh();
        
        // Update gutter decorations for the affected file
        if (this.gutterDecorationService) {
            await this.gutterDecorationService.updateDecorationsForFile(filePath);
        }
    }
    
    async removeMultipleBookmarks(bookmarkItems: BookmarkItem[]): Promise<void> {
        if (bookmarkItems.length === 0) {
            return;
        }
        
        if (bookmarkItems.length === 1) {
            const firstItem = bookmarkItems[0];
            if (firstItem) {
                return this.removeBookmark(firstItem);
            }
        }
        
        // Ask for confirmation for multiple bookmarks
        const confirmation = await vscode.window.showWarningMessage(
            `Are you sure you want to delete ${bookmarkItems.length} bookmarks?`,
            { modal: true },
            'Delete',
            'Cancel'
        );
        
        if (confirmation !== 'Delete') {
            return;
        }
        
        // Remove all bookmarks and collect affected files
        const affectedFiles = new Set<string>();
        for (const bookmarkItem of bookmarkItems) {
            affectedFiles.add(bookmarkItem.bookmark.filePath);
            await this.storageService.removeBookmark(bookmarkItem.bookmark.id);
        }
        
        this.refresh();
        
        // Update gutter decorations for all affected files
        if (this.gutterDecorationService) {
            for (const filePath of affectedFiles) {
                await this.gutterDecorationService.updateDecorationsForFile(filePath);
            }
        }
        
        errorHandler.showInfo(`Successfully deleted ${bookmarkItems.length} bookmarks.`);
    }
    
    async editBookmarkLabel(bookmarkItem: BookmarkItem): Promise<void> {
        const newLabel = await vscode.window.showInputBox({
            prompt: 'Enter new bookmark label',
            value: bookmarkItem.bookmark.label || this.getFileName(bookmarkItem.bookmark.filePath),
            validateInput: (value) => {
                if (!value) {
                    return 'Label cannot be empty';
                }
                const validation = InputValidator.validateBookmarkLabel(value);
                return validation.isValid ? null : validation.error;
            }
        });
        
        if (newLabel !== undefined && newLabel !== bookmarkItem.bookmark.label) {
            const validation = InputValidator.validateBookmarkLabel(newLabel);
            if (validation.isValid && validation.sanitized) {
                await this.storageService.updateBookmark(bookmarkItem.bookmark.id, { label: validation.sanitized });
                this.refresh();
                
                // Update gutter decorations for the affected file (label change affects hover message)
                if (this.gutterDecorationService) {
                    await this.gutterDecorationService.updateDecorationsForFile(bookmarkItem.bookmark.filePath);
                }
                
                errorHandler.debug('Bookmark label updated', {
                    operation: 'editBookmarkLabel',
                    details: { 
                        bookmarkId: bookmarkItem.bookmark.id, 
                        oldLabel: bookmarkItem.bookmark.label,
                        newLabel: validation.sanitized 
                    }
                });
            } else {
                errorHandler.warn('Invalid bookmark label provided', {
                    operation: 'editBookmarkLabel',
                    details: { error: validation.error },
                    showToUser: true,
                    userMessage: validation.error || 'Invalid bookmark label'
                });
            }
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
            
            // Clear all gutter decorations
            if (this.gutterDecorationService) {
                this.gutterDecorationService.clearAllDecorations();
            }
        }
    }
    
    async openBookmarkFile(bookmark: Bookmark): Promise<void> {
        await errorHandler.handleAsync(
            async () => {
                const document = await vscode.workspace.openTextDocument(bookmark.filePath);
                const editor = await vscode.window.showTextDocument(document);
                
                if (bookmark.lineNumber) {
                    const position = new vscode.Position(bookmark.lineNumber - 1, 0);
                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(new vscode.Range(position, position));
                    
                    errorHandler.debug('Opened bookmark file at specific line', {
                        operation: 'openBookmarkFile',
                        details: { 
                            filePath: bookmark.filePath, 
                            lineNumber: bookmark.lineNumber,
                            label: bookmark.label 
                        }
                    });
                } else {
                    errorHandler.debug('Opened bookmark file', {
                        operation: 'openBookmarkFile',
                        details: { 
                            filePath: bookmark.filePath,
                            label: bookmark.label 
                        }
                    });
                }
            },
            {
                operation: 'openBookmarkFile',
                details: { 
                    filePath: bookmark.filePath, 
                    lineNumber: bookmark.lineNumber,
                    bookmarkId: bookmark.id,
                    label: bookmark.label
                },
                showToUser: true,
                userMessage: `Failed to open bookmarked file: ${bookmark.label || bookmark.filePath.split('/').pop()}`
            }
        );
    }
    
    
    async renameCategory(categoryItem: CategoryItem): Promise<void> {
        const newName = await vscode.window.showInputBox({
            prompt: 'Enter new category name (use / for nested categories)',
            value: categoryItem.fullPath,
            placeHolder: 'Category name or Parent/Child'
        });
        
        if (newName && newName !== categoryItem.fullPath) {
            // Get all bookmarks in this category and its subcategories
            const allBookmarks = await this.storageService.getBookmarks();
            const bookmarksToUpdate = allBookmarks.filter(bookmark => {
                const category = bookmark.category;
                return category === categoryItem.fullPath || (category && category.startsWith(categoryItem.fullPath + '/'));
            });
            
            for (const bookmark of bookmarksToUpdate) {
                const oldCategory = bookmark.category;
                let newCategory: string;
                
                if (oldCategory === categoryItem.fullPath) {
                    // Direct match - use new name
                    newCategory = newName;
                } else if (oldCategory) {
                    // Subcategory - replace the prefix
                    newCategory = oldCategory.replace(categoryItem.fullPath, newName);
                } else {
                    // This shouldn't happen based on our filter, but handle it safely
                    continue;
                }
                
                await this.storageService.moveBookmarkToCategory(bookmark.id, newCategory);
            }
            
            this.refresh();
        }
    }
    
    async removeCategory(categoryItem: CategoryItem): Promise<void> {
        // Get all bookmarks in this category and its subcategories
        const allBookmarks = await this.storageService.getBookmarks();
        const bookmarksToUpdate = allBookmarks.filter(bookmark => {
            const category = bookmark.category;
            return category === categoryItem.fullPath || (category && category.startsWith(categoryItem.fullPath + '/'));
        });
        
        // Check if category only contains placeholder bookmarks (empty category)
        const realBookmarks = bookmarksToUpdate.filter(bookmark => 
            !bookmark.filePath.startsWith(CATEGORIES.PLACEHOLDER_PREFIX)
        );
        
        let shouldRemove = false;
        
        if (realBookmarks.length === 0) {
            // Category is empty (only placeholders), remove without confirmation
            shouldRemove = true;
        } else {
            // Category has real bookmarks, ask for confirmation
            const confirmation = await vscode.window.showWarningMessage(
                `Remove category "${categoryItem.fullPath}" and all subcategories? ${realBookmarks.length} bookmark(s) will be moved to root level (no category).`,
                { modal: true },
                'Remove',
                'Cancel'
            );
            shouldRemove = confirmation === 'Remove';
        }
        
        if (shouldRemove) {
            // Move all bookmarks to root level (no category) including placeholders
            for (const bookmark of bookmarksToUpdate) {
                await this.storageService.moveBookmarkToCategory(bookmark.id, null);
            }
            
            this.refresh();
        }
    }
    
    async createNewCategory(): Promise<void> {
        const categoryName = await vscode.window.showInputBox({
            prompt: 'Enter category name (use / for nested categories, e.g., Frontend/React)',
            placeHolder: 'My Category or Parent/Child Category',
            validateInput: (value) => {
                if (!value) {
                    return 'Category name cannot be empty';
                }
                const validation = InputValidator.validateCategoryName(value);
                return validation.isValid ? null : validation.error;
            }
        });
        
        if (categoryName) {
            const validation = InputValidator.validateCategoryName(categoryName);
            if (validation.isValid && validation.sanitized) {
                // Create a temporary placeholder bookmark to establish the category structure
                const placeholderBookmark: Bookmark = {
                    id: this.storageService.generateBookmarkId(),
                    filePath: CATEGORIES.PLACEHOLDER_PREFIX + validation.sanitized,
                    label: CATEGORIES.EMPTY_MESSAGE,
                    category: validation.sanitized,
                    createdAt: new Date()
                };
                
                await this.storageService.addBookmark(placeholderBookmark);
                this.refresh();
                
                errorHandler.info(`Category "${validation.sanitized}" created successfully`, {
                    operation: 'createNewCategory',
                    details: { categoryName: validation.sanitized },
                    showToUser: true,
                    userMessage: `Category "${validation.sanitized}" created successfully!`
                });
            } else {
                errorHandler.warn('Invalid category name provided', {
                    operation: 'createNewCategory',
                    details: { error: validation.error },
                    showToUser: true,
                    userMessage: validation.error || 'Invalid category name'
                });
            }
        }
    }
    
    async addSubCategory(parentCategory: CategoryItem): Promise<void> {
        const subCategoryName = await vscode.window.showInputBox({
            prompt: `Enter subcategory name under "${parentCategory.fullPath}"`,
            placeHolder: 'Subcategory Name'
        });
        
        if (subCategoryName) {
            // Create the full path for the subcategory
            const fullSubCategoryPath = `${parentCategory.fullPath}/${subCategoryName}`;
            
            // Create a temporary placeholder bookmark to establish the category structure
            // This bookmark will be removed once a real bookmark is added to this category
            const placeholderBookmark: Bookmark = {
                id: this.storageService.generateBookmarkId(),
                filePath: CATEGORIES.PLACEHOLDER_PREFIX + fullSubCategoryPath,
                label: CATEGORIES.EMPTY_MESSAGE,
                category: fullSubCategoryPath,
                createdAt: new Date()
            };
            
            await this.storageService.addBookmark(placeholderBookmark);
            this.refresh();
        }
    }
    
    async setCategoryColor(categoryItem: CategoryItem): Promise<void> {
        if (!this.categoryColorService) {
            errorHandler.error('Category color service not available', new Error('CategoryColorService not set'), {
                operation: 'setCategoryColor',
                showToUser: true,
                userMessage: 'Color setting service not available'
            });
            return;
        }

        // Check if this category can have its color changed
        if (!this.categoryColorService.canSetColor(categoryItem.fullPath)) {
            errorHandler.warn('Cannot set color for root category', {
                operation: 'setCategoryColor',
                showToUser: true,
                userMessage: 'Cannot change color for root category'
            });
            return;
        }

        // Get available colors
        const availableColors = this.categoryColorService.getAvailableColors();
        const currentColor = this.categoryColorService.getCategoryColor(categoryItem.fullPath);

        // Create quick pick items
        const quickPickItems = availableColors.map(colorInfo => ({
            label: colorInfo.displayName,
            description: currentColor === colorInfo.id ? '(Current)' : '',
            colorInfo: colorInfo
        }));

        // Add reset option
        quickPickItems.push({
            label: '🔄 Reset to Default',
            description: 'Use default color',
            colorInfo: null as any
        });

        const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: `Choose color for category "${categoryItem.fullPath}"`,
            title: 'Select Category Color'
        });

        if (selectedItem) {
            try {
                if (selectedItem.colorInfo) {
                    // Set the selected color
                    await this.categoryColorService.setCategoryColor(categoryItem.fullPath, selectedItem.colorInfo.id);
                } else {
                    // Reset to default
                    await this.categoryColorService.resetCategoryColor(categoryItem.fullPath);
                }

                // Refresh gutter decorations to show color change
                if (this.gutterDecorationService) {
                    await this.gutterDecorationService.refreshCategoryColors();
                }

                // Refresh tree to show any visual changes
                this.refresh();
            } catch (error) {
                errorHandler.error('Failed to set category color', error as Error, {
                    operation: 'setCategoryColor',
                    details: { categoryPath: categoryItem.fullPath },
                    showToUser: true,
                    userMessage: 'Failed to set category color'
                });
            }
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
            // Exclude placeholder bookmarks from search results
            if (bookmark.filePath.startsWith(CATEGORIES.PLACEHOLDER_PREFIX)) {
                return false;
            }
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
            return;
        }
        
        // Create quick pick items
        const quickPickItems = filteredBookmarks.map(bookmark => ({
            label: bookmark.label || this.getFileName(bookmark.filePath),
            description: `${bookmark.category || 'No category'} • Line ${bookmark.lineNumber || 1}`,
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
        
        // Store the bookmark data for tree-internal drag and drop
        const draggedData = bookmarkItems.map(item => ({
            id: item.bookmark.id,
            filePath: item.bookmark.filePath,
            label: item.bookmark.label,
            lineNumber: item.bookmark.lineNumber,
            category: item.bookmark.category
        }));
        
        treeDataTransfer.set(DRAG_DROP.MIME_TYPE, new vscode.DataTransferItem(draggedData));
        
        // Add URI list for external drops (like dropping to editor)
        const uriList = bookmarkItems
            .map(item => vscode.Uri.file(item.bookmark.filePath).toString())
            .join('\n');
        
        treeDataTransfer.set(DRAG_DROP.URI_LIST_MIME_TYPE, new vscode.DataTransferItem(uriList));
    }
    
    async handleDrop(target: BookmarkItem | CategoryItem | undefined, dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
        const draggedBookmarks = this.extractDraggedBookmarks(dataTransfer);
        if (!draggedBookmarks || draggedBookmarks.length === 0) {
            return;
        }

        if (draggedBookmarks.length === 1) {
            const firstBookmark = draggedBookmarks[0];
            if (firstBookmark) {
                await this.handleSingleBookmarkDrop(firstBookmark, target);
            }
        } else {
            await this.handleMultipleBookmarkDrop(draggedBookmarks, target);
        }
    }

    private extractDraggedBookmarks(dataTransfer: vscode.DataTransfer): Array<{
        id: string;
        filePath: string;
        label?: string;
        lineNumber?: number;
        category?: string;
    }> | undefined {
        const transferItem = dataTransfer.get(DRAG_DROP.MIME_TYPE);
        if (!transferItem) {
            return undefined;
        }

        const draggedBookmarks = transferItem.value as Array<{
            id: string;
            filePath: string;
            label?: string;
            lineNumber?: number;
            category?: string;
        }>;

        return draggedBookmarks && draggedBookmarks.length > 0 ? draggedBookmarks : undefined;
    }

    private async handleSingleBookmarkDrop(
        draggedBookmark: { id: string; filePath: string; label?: string; lineNumber?: number; category?: string },
        target: BookmarkItem | CategoryItem | undefined
    ): Promise<void> {
        if (!draggedBookmark) {
            return;
        }

        const targetCategory = this.determineTargetCategory(target);
        const currentCategory = InputValidator.getCategoryForComparison(draggedBookmark.category);

        // Handle reordering within the same category
        if (target instanceof BookmarkItem && currentCategory === targetCategory) {
            await this.handleReorderOperation(draggedBookmark, target, targetCategory);
            return;
        }

        // Handle cross-category move
        if (currentCategory !== targetCategory) {
            await this.handleCrossCategoryMove(draggedBookmark, currentCategory, targetCategory);
        }
    }

    private async handleMultipleBookmarkDrop(
        draggedBookmarks: Array<{ id: string; filePath: string; label?: string; lineNumber?: number; category?: string }>,
        target: BookmarkItem | CategoryItem | undefined
    ): Promise<void> {
        const targetCategory = this.determineTargetCategory(target);
        const sourceCategories = this.collectSourceCategories(draggedBookmarks, targetCategory);

        const moveCount = await this.moveBookmarksToCategory(draggedBookmarks, targetCategory);
        await this.preserveEmptySourceCategories(sourceCategories, draggedBookmarks.map(b => b.id));

        // Update gutter decorations for all affected files since categories may have changed
        if (this.gutterDecorationService && moveCount > 0) {
            const affectedFiles = new Set<string>();
            for (const bookmark of draggedBookmarks) {
                const currentCategory = InputValidator.getCategoryForComparison(bookmark.category);
                if (currentCategory !== targetCategory) {
                    affectedFiles.add(bookmark.filePath);
                }
            }
            
            for (const filePath of affectedFiles) {
                await this.gutterDecorationService.updateDecorationsForFile(filePath);
            }
        }

        this.refresh();
        this.showMoveSuccessMessage(moveCount, targetCategory);
    }

    private determineTargetCategory(target: BookmarkItem | CategoryItem | undefined): string | null {
        if (target instanceof CategoryItem) {
            return target.fullPath;
        } else if (target instanceof BookmarkItem) {
            return InputValidator.getCategoryForComparison(target.bookmark.category);
        } else {
            // When dropped on root level (target is undefined), it should have no category (null)
            // This allows bookmarks to be moved to root level (uncategorized)
            return null;
        }
    }

    private async handleReorderOperation(
        draggedBookmark: { id: string; category?: string },
        target: BookmarkItem,
        targetCategory: string | null
    ): Promise<void> {
        const categorizedBookmarks = await this.storageService.getBookmarksByCategory();
        const categoryBookmarks = categorizedBookmarks.get(targetCategory) || [];
        const targetPosition = categoryBookmarks.findIndex(b => b.id === target.bookmark.id);
        
        await this.reorderBookmarkInCategory(draggedBookmark.id, targetCategory, targetPosition);
    }

    private async handleCrossCategoryMove(
        draggedBookmark: { id: string; category?: string; filePath: string },
        currentCategory: string | null,
        targetCategory: string | null
    ): Promise<void> {
        if (currentCategory !== null) {
            await this.preserveEmptyCategoryAfterMove(currentCategory, draggedBookmark.id);
        }
        await this.storageService.moveBookmarkToCategory(draggedBookmark.id, targetCategory);
        
        // Update gutter decorations for the affected file since category changed
        if (this.gutterDecorationService) {
            await this.gutterDecorationService.updateDecorationsForFile(draggedBookmark.filePath);
        }
        
        this.refresh();
    }

    private collectSourceCategories(
        draggedBookmarks: Array<{ category?: string }>,
        targetCategory: string | null
    ): Set<string> {
        const sourceCategories = new Set<string>();
        for (const bookmark of draggedBookmarks) {
            const sourceCategory = InputValidator.getCategoryForComparison(bookmark.category);
            if (sourceCategory !== targetCategory && sourceCategory !== null) {
                sourceCategories.add(sourceCategory);
            }
        }
        return sourceCategories;
    }

    private async moveBookmarksToCategory(
        draggedBookmarks: Array<{ id: string; category?: string }>,
        targetCategory: string | null
    ): Promise<number> {
        let moveCount = 0;
        for (const bookmark of draggedBookmarks) {
            const currentCategory = InputValidator.getCategoryForComparison(bookmark.category);
            if (currentCategory !== targetCategory) {
                await this.storageService.moveBookmarkToCategory(bookmark.id, targetCategory);
                moveCount++;
            }
        }
        return moveCount;
    }

    private async preserveEmptySourceCategories(sourceCategories: Set<string>, movingBookmarkIds: string[]): Promise<void> {
        for (const sourceCategory of sourceCategories) {
            await this.preserveEmptyCategoryAfterMultipleMove(sourceCategory, movingBookmarkIds);
        }
    }

    private showMoveSuccessMessage(moveCount: number, targetCategory: string | null): void {
        if (moveCount > 0) {
            const categoryName = targetCategory === null 
                ? 'root level (no category)' 
                : targetCategory;
            errorHandler.showInfo(`Moved ${moveCount} bookmark(s) to "${categoryName}".`);
        }
    }
    
    private async preserveEmptyCategoryAfterMove(sourceCategory: string, movingBookmarkId: string): Promise<void> {
        // Get all bookmarks in the source category
        const allBookmarks = await this.storageService.getBookmarks();
        const categoryBookmarks = allBookmarks.filter(bookmark => 
            bookmark.category === sourceCategory
        );
        
        // Count real bookmarks (excluding placeholders and the one being moved)
        const realBookmarks = categoryBookmarks.filter(bookmark => 
            !bookmark.filePath.startsWith(CATEGORIES.PLACEHOLDER_PREFIX) && 
            bookmark.id !== movingBookmarkId
        );
        
        // If no real bookmarks will remain, create placeholder to preserve category
        if (realBookmarks.length === 0) {
            const placeholderBookmark: Bookmark = {
                id: this.storageService.generateBookmarkId(),
                filePath: CATEGORIES.PLACEHOLDER_PREFIX + sourceCategory,
                label: CATEGORIES.EMPTY_MESSAGE,
                category: sourceCategory,
                createdAt: new Date()
            };
            
            await this.storageService.addBookmark(placeholderBookmark);
        }
    }
    
    private async preserveEmptyCategoryAfterMultipleMove(sourceCategory: string, movingBookmarkIds: string[]): Promise<void> {
        // Get all bookmarks in the source category
        const allBookmarks = await this.storageService.getBookmarks();
        const categoryBookmarks = allBookmarks.filter(bookmark => 
            bookmark.category === sourceCategory
        );
        
        // Count real bookmarks (excluding placeholders and the ones being moved)
        const realBookmarks = categoryBookmarks.filter(bookmark => 
            !bookmark.filePath.startsWith(CATEGORIES.PLACEHOLDER_PREFIX) && 
            !movingBookmarkIds.includes(bookmark.id)
        );
        
        // If no real bookmarks will remain, create placeholder to preserve category
        if (realBookmarks.length === 0) {
            const placeholderBookmark: Bookmark = {
                id: this.storageService.generateBookmarkId(),
                filePath: CATEGORIES.PLACEHOLDER_PREFIX + sourceCategory,
                label: CATEGORIES.EMPTY_MESSAGE,
                category: sourceCategory,
                createdAt: new Date()
            };
            
            await this.storageService.addBookmark(placeholderBookmark);
        }
    }

    private async reorderBookmarkInCategory(bookmarkId: string, categoryName: string | null, targetPosition: number): Promise<void> {
        const allBookmarks = await this.storageService.getBookmarks();
        const draggedBookmarkIndex = allBookmarks.findIndex(b => b.id === bookmarkId);
        
        if (draggedBookmarkIndex === -1) {
            return;
        }
        
        // Get all bookmarks in the target category
        const categoryBookmarks = allBookmarks.filter(b => {
            const bookmarkCategory = InputValidator.getCategoryForComparison(b.category);
            return bookmarkCategory === categoryName;
        });
        const otherBookmarks = allBookmarks.filter(b => {
            const bookmarkCategory = InputValidator.getCategoryForComparison(b.category);
            return bookmarkCategory !== categoryName;
        });
        
        // Remove the dragged bookmark from category list
        const draggedBookmark = categoryBookmarks.find(b => b.id === bookmarkId);
        if (!draggedBookmark) {
            return;
        }
        
        const filteredCategoryBookmarks = categoryBookmarks.filter(b => b.id !== bookmarkId);
        
        // Insert at target position
        if (targetPosition >= 0 && targetPosition < filteredCategoryBookmarks.length) {
            filteredCategoryBookmarks.splice(targetPosition, 0, draggedBookmark);
        } else {
            // Append at end if position is invalid
            filteredCategoryBookmarks.push(draggedBookmark);
        }
        
        // Reconstruct the full bookmark list
        const reorderedBookmarks = [...otherBookmarks, ...filteredCategoryBookmarks];
        
        // Save the reordered bookmarks
        await this.storageService.replaceAllBookmarks(reorderedBookmarks);
        this.refresh();
    }
    
}