import * as vscode from 'vscode';
import { Bookmark, BookmarkItem, CategoryItem, CategoryNode } from '../models/bookmark';
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
            // Root level - return top-level categories
            const categoryTree = await this.storageService.getCategoryTree();
            const result: (BookmarkItem | CategoryItem)[] = [];
            
            // Add root-level categories
            for (const [categoryName, categoryNode] of categoryTree.children) {
                const hasChildren = categoryNode.children.size > 0;
                const bookmarkCount = this.getBookmarkCountInNode(categoryNode);
                
                // Check if category has any content (bookmarks or subcategories)
                const hasRealContent = hasChildren || categoryNode.bookmarks.length > 0;
                
                if (hasRealContent) {
                    // Special case: Hide Uncategorized category if it has 0 real bookmarks
                    if (categoryName === BookmarkStorageService.DEFAULT_CATEGORY && bookmarkCount === 0 && !hasChildren) {
                        continue; // Skip showing empty Uncategorized category
                    }
                    
                    result.push(new CategoryItem(
                        categoryName,
                        categoryNode.fullPath,
                        bookmarkCount,
                        hasChildren,
                        0
                    ));
                }
            }
            
            // Add root-level bookmarks (if any), excluding placeholder bookmarks
            for (const bookmark of categoryTree.bookmarks) {
                if (!bookmark.filePath.startsWith('__placeholder__')) {
                    result.push(new BookmarkItem(bookmark));
                }
            }
            
            return result.sort((a, b) => {
                // Categories first, then bookmarks
                if (a instanceof CategoryItem && b instanceof BookmarkItem) {
                    return -1;
                }
                if (a instanceof BookmarkItem && b instanceof CategoryItem) {
                    return 1;
                }
                
                // Sort categories: default category first, then alphabetically
                if (a instanceof CategoryItem && b instanceof CategoryItem) {
                    if (a.categoryName === BookmarkStorageService.DEFAULT_CATEGORY) {
                        return -1;
                    }
                    if (b.categoryName === BookmarkStorageService.DEFAULT_CATEGORY) {
                        return 1;
                    }
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
                    // Special case: Hide Uncategorized category if it has 0 real bookmarks
                    if (subCategoryNode.fullPath === BookmarkStorageService.DEFAULT_CATEGORY && bookmarkCount === 0 && !hasChildren) {
                        continue; // Skip showing empty Uncategorized category
                    }
                    
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
                if (!bookmark.filePath.startsWith('__placeholder__')) {
                    result.push(new BookmarkItem(bookmark));
                }
            }
            
            return result.sort((a, b) => {
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
        let count = node.bookmarks.filter(b => !b.filePath.startsWith('__placeholder__')).length;
        
        // Recursively count bookmarks in child nodes
        for (const [, childNode] of node.children) {
            count += this.getBookmarkCountInNode(childNode);
        }
        
        return count;
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
        let selectedCategory = category || BookmarkStorageService.DEFAULT_CATEGORY;
        if (!category) {
            const categoryTree = await this.storageService.getCategoryTree();
            const categories = this.storageService.getAvailableCategories(categoryTree);
            const categoryOptions = [...categories, '+ Create New Category'];
            
            const selectedOption = await vscode.window.showQuickPick(categoryOptions, {
                placeHolder: 'Select category for bookmark'
            });
            
            if (selectedOption === undefined) {
                return; // User cancelled
            }
            
            if (selectedOption === '+ Create New Category') {
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
        const categoryTree = await this.storageService.getCategoryTree();
        const categories = this.storageService.getAvailableCategories(categoryTree);
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
                prompt: 'Enter new category name (use / for nested categories, e.g., Frontend/React)',
                placeHolder: 'My Category or Parent/Child Category'
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
    }
    
    async removeBookmark(bookmarkItem: BookmarkItem): Promise<void> {
        await this.storageService.removeBookmark(bookmarkItem.bookmark.id);
        this.refresh();
    }
    
    async editBookmarkLabel(bookmarkItem: BookmarkItem): Promise<void> {
        const newLabel = await vscode.window.showInputBox({
            prompt: 'Enter new bookmark label',
            value: bookmarkItem.bookmark.label || this.getFileName(bookmarkItem.bookmark.filePath)
        });
        
        if (newLabel !== undefined && newLabel !== bookmarkItem.bookmark.label) {
            await this.storageService.updateBookmark(bookmarkItem.bookmark.id, { label: newLabel });
            this.refresh();
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
            prompt: 'Enter new category name (use / for nested categories)',
            value: categoryItem.fullPath,
            placeHolder: 'Category name or Parent/Child'
        });
        
        if (newName && newName !== categoryItem.fullPath) {
            // Get all bookmarks in this category and its subcategories
            const allBookmarks = await this.storageService.getBookmarks();
            const bookmarksToUpdate = allBookmarks.filter(bookmark => {
                const category = bookmark.category || BookmarkStorageService.DEFAULT_CATEGORY;
                return category === categoryItem.fullPath || category.startsWith(categoryItem.fullPath + '/');
            });
            
            for (const bookmark of bookmarksToUpdate) {
                const oldCategory = bookmark.category || BookmarkStorageService.DEFAULT_CATEGORY;
                let newCategory: string;
                
                if (oldCategory === categoryItem.fullPath) {
                    // Direct match - use new name
                    newCategory = newName;
                } else {
                    // Subcategory - replace the prefix
                    newCategory = oldCategory.replace(categoryItem.fullPath, newName);
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
            const category = bookmark.category || BookmarkStorageService.DEFAULT_CATEGORY;
            return category === categoryItem.fullPath || category.startsWith(categoryItem.fullPath + '/');
        });
        
        // Check if category only contains placeholder bookmarks (empty category)
        const realBookmarks = bookmarksToUpdate.filter(bookmark => 
            !bookmark.filePath.startsWith('__placeholder__')
        );
        
        let shouldRemove = false;
        
        if (realBookmarks.length === 0) {
            // Category is empty (only placeholders), remove without confirmation
            shouldRemove = true;
        } else {
            // Category has real bookmarks, ask for confirmation
            const confirmation = await vscode.window.showWarningMessage(
                `Remove category "${categoryItem.fullPath}" and all subcategories? ${realBookmarks.length} bookmark(s) will be moved to "${BookmarkStorageService.DEFAULT_CATEGORY}".`,
                { modal: true },
                'Remove',
                'Cancel'
            );
            shouldRemove = confirmation === 'Remove';
        }
        
        if (shouldRemove) {
            // Move all bookmarks to default category (including placeholders)
            for (const bookmark of bookmarksToUpdate) {
                await this.storageService.moveBookmarkToCategory(bookmark.id, BookmarkStorageService.DEFAULT_CATEGORY);
            }
            
            this.refresh();
        }
    }
    
    async createNewCategory(): Promise<void> {
        const categoryName = await vscode.window.showInputBox({
            prompt: 'Enter category name (use / for nested categories, e.g., Frontend/React)',
            placeHolder: 'My Category or Parent/Child Category',
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Category name cannot be empty';
                }
                if (value.includes('//') || value.startsWith('/') || value.endsWith('/')) {
                    return 'Invalid category path format';
                }
                return null;
            }
        });
        
        if (categoryName && categoryName.trim()) {
            const trimmedName = categoryName.trim();
            
            // Create a temporary placeholder bookmark to establish the category structure
            const placeholderBookmark: Bookmark = {
                id: this.storageService.generateBookmarkId(),
                filePath: '__placeholder__' + trimmedName,
                label: '[Empty Category - Add bookmarks here]',
                lineNumber: undefined,
                workspacePath: undefined,
                category: trimmedName,
                createdAt: new Date()
            };
            
            await this.storageService.addBookmark(placeholderBookmark);
            this.refresh();
            
            vscode.window.showInformationMessage(`Category "${trimmedName}" created successfully!`);
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
                filePath: '__placeholder__' + fullSubCategoryPath,
                label: '[Empty Category - Add bookmarks here]',
                lineNumber: undefined,
                workspacePath: undefined,
                category: fullSubCategoryPath,
                createdAt: new Date()
            };
            
            await this.storageService.addBookmark(placeholderBookmark);
            this.refresh();
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
            if (bookmark.filePath.startsWith('__placeholder__')) {
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
            description: `${bookmark.category || BookmarkStorageService.DEFAULT_CATEGORY} • Line ${bookmark.lineNumber || 1}`,
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
        
        // Only handle single bookmark drag for reordering
        if (draggedBookmarks.length > 1) {
            vscode.window.showWarningMessage('Multiple bookmark reordering is not supported');
            return;
        }
        
        const draggedBookmark = draggedBookmarks[0];
        
        // Determine target category and position
        let targetCategory = BookmarkStorageService.DEFAULT_CATEGORY;
        let targetPosition: number | undefined;
        
        if (target instanceof CategoryItem) {
            // Dropped on a category folder - move to category, append at end
            targetCategory = target.fullPath;
        } else if (target instanceof BookmarkItem) {
            // Dropped on another bookmark
            targetCategory = target.bookmark.category || BookmarkStorageService.DEFAULT_CATEGORY;
            const currentCategory = draggedBookmark.category || BookmarkStorageService.DEFAULT_CATEGORY;
            
            if (currentCategory === targetCategory) {
                // Same category - this is a reorder operation
                const categorizedBookmarks = await this.storageService.getBookmarksByCategory();
                const categoryBookmarks = categorizedBookmarks.get(targetCategory) || [];
                
                // Find target position
                targetPosition = categoryBookmarks.findIndex(b => b.id === target.bookmark.id);
                
                // Reorder within category
                await this.reorderBookmarkInCategory(draggedBookmark.id, targetCategory, targetPosition);
                return;
            }
        } else {
            // Dropped on empty space - use default category
            targetCategory = BookmarkStorageService.DEFAULT_CATEGORY;
        }
        
        // Cross-category move
        const currentCategory = draggedBookmark.category || BookmarkStorageService.DEFAULT_CATEGORY;
        if (currentCategory !== targetCategory) {
            // Check if source category will become empty after move
            await this.preserveEmptyCategoryAfterMove(currentCategory, draggedBookmark.id);
            
            await this.storageService.moveBookmarkToCategory(draggedBookmark.id, targetCategory);
            this.refresh();
        }
    }
    
    private async preserveEmptyCategoryAfterMove(sourceCategory: string, movingBookmarkId: string): Promise<void> {
        // Don't preserve default category - it's the default
        if (sourceCategory === BookmarkStorageService.DEFAULT_CATEGORY) {
            return;
        }
        
        // Get all bookmarks in the source category
        const allBookmarks = await this.storageService.getBookmarks();
        const categoryBookmarks = allBookmarks.filter(bookmark => 
            (bookmark.category || BookmarkStorageService.DEFAULT_CATEGORY) === sourceCategory
        );
        
        // Count real bookmarks (excluding placeholders and the one being moved)
        const realBookmarks = categoryBookmarks.filter(bookmark => 
            !bookmark.filePath.startsWith('__placeholder__') && 
            bookmark.id !== movingBookmarkId
        );
        
        // If no real bookmarks will remain, create placeholder to preserve category
        if (realBookmarks.length === 0) {
            const placeholderBookmark: Bookmark = {
                id: this.storageService.generateBookmarkId(),
                filePath: '__placeholder__' + sourceCategory,
                label: '[Empty Category - Add bookmarks here]',
                lineNumber: undefined,
                workspacePath: undefined,
                category: sourceCategory,
                createdAt: new Date()
            };
            
            await this.storageService.addBookmark(placeholderBookmark);
        }
    }

    private async reorderBookmarkInCategory(bookmarkId: string, categoryName: string, targetPosition: number): Promise<void> {
        const allBookmarks = await this.storageService.getBookmarks();
        const draggedBookmarkIndex = allBookmarks.findIndex(b => b.id === bookmarkId);
        
        if (draggedBookmarkIndex === -1) {
            return;
        }
        
        // Get all bookmarks in the target category
        const categoryBookmarks = allBookmarks.filter(b => (b.category || BookmarkStorageService.DEFAULT_CATEGORY) === categoryName);
        const otherBookmarks = allBookmarks.filter(b => (b.category || BookmarkStorageService.DEFAULT_CATEGORY) !== categoryName);
        
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