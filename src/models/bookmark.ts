import * as vscode from 'vscode';

export enum CategoryColor {
    BLUE = 'blue',
    GREEN = 'green', 
    RED = 'red',
    PURPLE = 'purple',
    ORANGE = 'orange',
    YELLOW = 'yellow',
    PINK = 'pink',
    GRAY = 'gray'
}

export interface CategoryColorInfo {
    id: CategoryColor;
    name: string;
    displayName: string;
    themeColor: string;
    hexColor: string;
}

export interface Bookmark {
    id: string;
    filePath: string;
    label?: string | undefined;
    lineNumber?: number | undefined;
    workspacePath?: string | undefined;
    category?: string | null | undefined;
    createdAt: Date;
    
    // Dynamic position tracking fields
    contentAnchor?: string;           // Partial content of the line for position tracking
    lastKnownContent?: string;        // Complete line content snapshot
    trackingEnabled?: boolean;        // Whether position tracking is enabled for this bookmark
}

export interface CategoryNode {
    name: string;
    fullPath: string;
    children: Map<string, CategoryNode>;
    bookmarks: Bookmark[];
    isExpanded?: boolean;
    color?: CategoryColor;
}

export type CategoryColorMapping = {
    [categoryPath: string]: CategoryColor;
};

export type BookmarkData = Bookmark[];

export class CategoryItem extends vscode.TreeItem {
    constructor(
        public readonly categoryName: string,
        public readonly fullPath: string,
        public readonly bookmarkCount: number,
        public readonly hasChildren: boolean = false,
        public readonly level: number = 0,
        public override readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Expanded
    ) {
        super(categoryName, collapsibleState);
        
        this.tooltip = `${fullPath} (${bookmarkCount} bookmarks${hasChildren ? ', has subcategories' : ''})`;
        this.description = `${bookmarkCount} items`;
        
        // All categories use the same context value now
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
        public override readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        super(bookmark.label || bookmark.filePath, collapsibleState);
        
        this.tooltip = `${bookmark.filePath}${bookmark.lineNumber ? `:${bookmark.lineNumber}` : ''}`;
        this.description = this.getRelativePathWithLine(bookmark.filePath, bookmark.lineNumber);
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
    
    private getRelativePathWithLine(filePath: string, lineNumber?: number): string {
        // Use VS Code's built-in method to get relative path
        const relativePath = vscode.workspace.asRelativePath(filePath, false);
        const basePath = relativePath !== filePath ? relativePath : filePath;
        
        // Append line number if available
        return lineNumber ? `${basePath}:${lineNumber}` : basePath;
    }
}