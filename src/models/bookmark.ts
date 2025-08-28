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

export interface BookmarkGroup {
    name: string;
    bookmarks: Bookmark[];
    isExpanded?: boolean;
}

export type BookmarkData = Bookmark[];

export class CategoryItem extends vscode.TreeItem {
    constructor(
        public readonly categoryName: string,
        public readonly bookmarkCount: number,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Expanded
    ) {
        super(categoryName, collapsibleState);
        
        this.tooltip = `${categoryName} (${bookmarkCount} bookmarks)`;
        this.description = `${bookmarkCount} items`;
        this.contextValue = 'category';
        this.iconPath = new vscode.ThemeIcon('folder');
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
        
        // Set icon based on file type
        this.iconPath = this.getFileIcon(bookmark.filePath);
        
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
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return filePath;
        }
        
        for (const folder of workspaceFolders) {
            const relativePath = vscode.workspace.asRelativePath(filePath, false);
            if (relativePath !== filePath) {
                return relativePath;
            }
        }
        
        return filePath;
    }
    
    private getFileIcon(filePath: string): vscode.ThemeIcon {
        const ext = filePath.split('.').pop()?.toLowerCase();
        
        switch (ext) {
            case 'ts':
            case 'tsx':
                return new vscode.ThemeIcon('symbol-class', new vscode.ThemeColor('symbolIcon.classForeground'));
            case 'js':
            case 'jsx':
                return new vscode.ThemeIcon('symbol-method', new vscode.ThemeColor('symbolIcon.methodForeground'));
            case 'json':
                return new vscode.ThemeIcon('json');
            case 'md':
                return new vscode.ThemeIcon('markdown');
            case 'py':
                return new vscode.ThemeIcon('symbol-function', new vscode.ThemeColor('symbolIcon.functionForeground'));
            case 'html':
            case 'htm':
                return new vscode.ThemeIcon('symbol-property', new vscode.ThemeColor('symbolIcon.propertyForeground'));
            case 'css':
            case 'scss':
            case 'sass':
                return new vscode.ThemeIcon('symbol-color', new vscode.ThemeColor('symbolIcon.colorForeground'));
            default:
                return new vscode.ThemeIcon('file');
        }
    }
}