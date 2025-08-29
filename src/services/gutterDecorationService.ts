import * as vscode from 'vscode';
import * as path from 'path';
import { BookmarkStorageService } from './bookmarkStorage';
import { errorHandler } from '../utils/errorHandler';
import { CATEGORIES } from '../constants';

export class GutterDecorationService {
    private decorationType: vscode.TextEditorDecorationType;
    private decorationsByFile = new Map<string, vscode.DecorationOptions[]>();
    
    constructor(private storageService: BookmarkStorageService, context: vscode.ExtensionContext) {
        const iconPath = path.join(context.extensionPath, 'resources', 'bookmark-gutter.svg');
        
        errorHandler.debug('Initializing gutter decoration service', {
            operation: 'constructor',
            details: { 
                iconPath,
                extensionPath: context.extensionPath
            }
        });
        
        this.decorationType = vscode.window.createTextEditorDecorationType({
            gutterIconPath: vscode.Uri.file(iconPath),
            gutterIconSize: 'auto',
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            overviewRulerColor: new vscode.ThemeColor('list.highlightForeground')
        });
        
        // Listen for editor changes to update decorations
        vscode.window.onDidChangeActiveTextEditor(this.onActiveEditorChanged, this);
        vscode.workspace.onDidChangeTextDocument(this.onDocumentChanged, this);
        
        // Initialize decorations for the currently active editor
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            this.updateDecorationsForEditor(activeEditor);
        }
    }

    private async onActiveEditorChanged(editor: vscode.TextEditor | undefined): Promise<void> {
        if (editor) {
            await this.updateDecorationsForEditor(editor);
        }
    }

    private async onDocumentChanged(event: vscode.TextDocumentChangeEvent): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document === event.document) {
            await this.updateDecorationsForEditor(editor);
        }
    }

    async updateDecorationsForEditor(editor: vscode.TextEditor): Promise<void> {
        try {
            const filePath = editor.document.fileName;
            const bookmarks = await this.storageService.getBookmarks();
            
            errorHandler.debug('Updating decorations for editor', {
                operation: 'updateDecorationsForEditor',
                details: {
                    filePath,
                    totalBookmarks: bookmarks.length
                }
            });
            
            const fileBookmarks = bookmarks.filter(bookmark => 
                bookmark.filePath === filePath && 
                bookmark.lineNumber !== undefined &&
                !bookmark.filePath.startsWith(CATEGORIES.PLACEHOLDER_PREFIX)
            );

            const decorations: vscode.DecorationOptions[] = [];
            
            for (const bookmark of fileBookmarks) {
                if (bookmark.lineNumber) {
                    const line = bookmark.lineNumber - 1; // Convert to 0-based indexing
                    const range = new vscode.Range(line, 0, line, 0);
                    
                    decorations.push({
                        range,
                        hoverMessage: new vscode.MarkdownString(
                            `**Bookmark:** ${bookmark.label || 'Untitled'}\n\n` +
                            `**File:** ${bookmark.filePath}\n\n` +
                            `**Line:** ${bookmark.lineNumber}\n\n` +
                            `${bookmark.category ? `**Category:** ${bookmark.category}\n\n` : ''}` +
                            `*Right-click to remove bookmark*`
                        )
                    });
                }
            }

            // Store decorations for this file
            this.decorationsByFile.set(filePath, decorations);
            
            // Apply decorations to the editor
            editor.setDecorations(this.decorationType, decorations);

            errorHandler.info('Applied gutter decorations for file', {
                operation: 'updateDecorationsForEditor',
                details: {
                    filePath,
                    fileBookmarks: fileBookmarks.length,
                    decorationCount: decorations.length,
                    bookmarksFound: fileBookmarks.map(b => `${b.label || 'Untitled'} (line ${b.lineNumber})`)
                },
                showToUser: decorations.length > 0 // Only show to user if decorations were applied
            });
        } catch (error) {
            errorHandler.error('Failed to update gutter decorations', error as Error, {
                operation: 'updateDecorationsForEditor',
                details: { filePath: editor.document.fileName }
            });
        }
    }

    async updateDecorationsForFile(filePath: string): Promise<void> {
        // Find editor for the specific file
        const editor = vscode.window.visibleTextEditors.find(
            editor => editor.document.fileName === filePath
        );
        
        if (editor) {
            await this.updateDecorationsForEditor(editor);
        }
    }

    async refreshAllDecorations(): Promise<void> {
        // Update decorations for all visible editors
        for (const editor of vscode.window.visibleTextEditors) {
            await this.updateDecorationsForEditor(editor);
        }
    }

    async clearDecorationsForFile(filePath: string): Promise<void> {
        const editor = vscode.window.visibleTextEditors.find(
            editor => editor.document.fileName === filePath
        );
        
        if (editor) {
            editor.setDecorations(this.decorationType, []);
            this.decorationsByFile.delete(filePath);
        }
    }

    clearAllDecorations(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            editor.setDecorations(this.decorationType, []);
        }
        this.decorationsByFile.clear();
    }

    getDecorationsForFile(filePath: string): vscode.DecorationOptions[] {
        return this.decorationsByFile.get(filePath) || [];
    }

    dispose(): void {
        this.decorationType.dispose();
        this.decorationsByFile.clear();
    }
}