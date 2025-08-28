import * as vscode from 'vscode';

export interface Bookmark {
    id: string;
    filePath: string;
    label?: string;
    lineNumber?: number;
    workspacePath?: string;
    category?: string;
    createdAt: Date;
}

export interface CategoryNode {
    name: string;
    fullPath: string;
    children: Map<string, CategoryNode>;
    bookmarks: Bookmark[];
    isExpanded?: boolean;
}

export interface BookmarkGroup {
    name: string;
    bookmarks: Bookmark[];
    isExpanded?: boolean;
}

export type BookmarkData = Bookmark[];

export class CategoryItem extends vscode.TreeItem {
    constructor(
        public readonly categoryName: string,
        public readonly fullPath: string,
        public readonly bookmarkCount: number,
        public readonly hasChildren: boolean = false,
        public readonly level: number = 0,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Expanded
    ) {
        super(categoryName, collapsibleState);
        
        this.tooltip = `${fullPath} (${bookmarkCount} bookmarks${hasChildren ? ', has subcategories' : ''})`;
        this.description = `${bookmarkCount} items`;
        this.contextValue = 'category';
        
        // Use VS Code's default folder icons
        if (collapsibleState === vscode.TreeItemCollapsibleState.Collapsed) {
            this.iconPath = new vscode.ThemeIcon('folder');
        } else {
            this.iconPath = new vscode.ThemeIcon('folder-opened');
        }
    }
}

export class BookmarkItem extends vscode.TreeItem {
    constructor(
        public readonly bookmark: Bookmark,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        super(bookmark.label || bookmark.filePath, collapsibleState);
        
        this.tooltip = `${bookmark.filePath}${bookmark.lineNumber ? `:${bookmark.lineNumber}` : ''}`;
        this.description = this.getRelativePath(bookmark.filePath);
        this.contextValue = 'bookmark';
        
        // Use VS Code's file icon theme by setting resourceUri
        this.resourceUri = vscode.Uri.file(bookmark.filePath);
        
        // Command to open file when clicked
        this.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [
                vscode.Uri.file(bookmark.filePath),
                bookmark.lineNumber ? { selection: new vscode.Range(bookmark.lineNumber - 1, 0, bookmark.lineNumber - 1, 0) } : undefined
            ]
        };
    }
    
    private getRelativePath(filePath: string): string {
        // Use VS Code's built-in method to get relative path
        const relativePath = vscode.workspace.asRelativePath(filePath, false);
        return relativePath !== filePath ? relativePath : filePath;
    }
}