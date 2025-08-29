import * as vscode from 'vscode';
import * as path from 'path';
import { BookmarkStorageService } from './bookmarkStorage';
import { CategoryColorService } from './categoryColorService';
import { errorHandler } from '../utils/errorHandler';
import { CATEGORIES } from '../constants';
import { CategoryColor } from '../models/bookmark';

export class GutterDecorationService {
    private decorationTypes = new Map<CategoryColor, vscode.TextEditorDecorationType>();
    private decorationsByFile = new Map<string, Map<CategoryColor, vscode.DecorationOptions[]>>();
    private categoryColorService: CategoryColorService;
    
    constructor(
        private storageService: BookmarkStorageService, 
        context: vscode.ExtensionContext,
        categoryColorService?: CategoryColorService
    ) {
        this.categoryColorService = categoryColorService || new CategoryColorService(context);
        
        errorHandler.debug('Initializing gutter decoration service', {
            operation: 'constructor',
            details: { 
                extensionPath: context.extensionPath
            }
        });
        
        // Initialize all color decoration types
        this.initializeDecorationTypes(context);
        
        // Listen for editor changes to update decorations
        vscode.window.onDidChangeActiveTextEditor(this.onActiveEditorChanged, this);
        vscode.workspace.onDidChangeTextDocument(this.onDocumentChanged, this);
        
        // Initialize decorations for the currently active editor
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            this.updateDecorationsForEditor(activeEditor);
        }
    }
    
    /**
     * Initialize all color decoration types
     */
    private initializeDecorationTypes(context: vscode.ExtensionContext): void {
        CategoryColorService.PREDEFINED_COLORS.forEach(colorInfo => {
            // Use corresponding color SVG file
            const iconFileName = `bookmark-${colorInfo.name}.svg`;
            const iconPath = path.join(context.extensionPath, 'resources', iconFileName);
            
            const decorationType = vscode.window.createTextEditorDecorationType({
                gutterIconPath: vscode.Uri.file(iconPath),
                gutterIconSize: 'auto',
                overviewRulerLane: vscode.OverviewRulerLane.Right,
                overviewRulerColor: this.categoryColorService.getThemeColor(colorInfo.id)
            });
            
            this.decorationTypes.set(colorInfo.id, decorationType);
        });
        
        errorHandler.debug('Initialized decoration types for all colors', {
            operation: 'initializeDecorationTypes',
            details: { 
                colorCount: this.decorationTypes.size,
                colors: Array.from(this.decorationTypes.keys())
            }
        });
    }

    private async onActiveEditorChanged(editor: vscode.TextEditor | undefined): Promise<void> {
        if (editor) {
            await this.updateDecorationsForEditor(editor);
        }
    }

    private async onDocumentChanged(_event: vscode.TextDocumentChangeEvent): Promise<void> {
        // Don't immediately update decorations on document change
        // Let the BookmarkPositionTracker handle position updates first
        // Decorations will be updated via the positionTracker callback
        // This prevents showing stale bookmark positions
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

            // Group bookmarks by color
            const decorationsByColor = new Map<CategoryColor, vscode.DecorationOptions[]>();
            
            for (const bookmark of fileBookmarks) {
                if (bookmark.lineNumber) {
                    const line = bookmark.lineNumber - 1; // Convert to 0-based indexing
                    const range = new vscode.Range(line, 0, line, 0);
                    
                    // Get bookmark color
                    const categoryColor = this.categoryColorService.getCategoryColor(bookmark.category || null);
                    
                    // Create decoration options
                    const decoration: vscode.DecorationOptions = {
                        range,
                        hoverMessage: new vscode.MarkdownString(
                            `**Bookmark:** ${bookmark.label || 'Untitled'}\n\n` +
                            `**File:** ${bookmark.filePath}\n\n` +
                            `**Line:** ${bookmark.lineNumber}\n\n` +
                            `${bookmark.category ? `**Category:** ${bookmark.category}\n\n` : ''}` +
                            `**Color:** ${this.categoryColorService.getColorInfo(categoryColor)?.displayName || 'Default'}\n\n` +
                            `*Right-click to remove bookmark*`
                        )
                    };
                    
                    // Group by color
                    if (!decorationsByColor.has(categoryColor)) {
                        decorationsByColor.set(categoryColor, []);
                    }
                    decorationsByColor.get(categoryColor)!.push(decoration);
                }
            }

            // Clear all previous decorations
            for (const [, decorationType] of this.decorationTypes) {
                editor.setDecorations(decorationType, []);
            }

            // Apply new decorations (by color)
            for (const [color, decorations] of decorationsByColor) {
                const decorationType = this.decorationTypes.get(color);
                if (decorationType) {
                    editor.setDecorations(decorationType, decorations);
                }
            }

            // Store decorations for this file
            this.decorationsByFile.set(filePath, decorationsByColor);
            
            const totalDecorations = Array.from(decorationsByColor.values())
                .reduce((sum, decorations) => sum + decorations.length, 0);

            errorHandler.info('Applied gutter decorations for file', {
                operation: 'updateDecorationsForEditor',
                details: {
                    filePath,
                    fileBookmarks: fileBookmarks.length,
                    decorationCount: totalDecorations,
                    colorBreakdown: Array.from(decorationsByColor.entries()).map(
                        ([color, decorations]) => `${color}: ${decorations.length}`
                    ),
                    bookmarksFound: fileBookmarks.map(b => 
                        `${b.label || 'Untitled'} (line ${b.lineNumber}, ${b.category || 'root'})`
                    )
                },
                showToUser: totalDecorations > 0
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
            // Clear all color decorations
            for (const decorationType of this.decorationTypes.values()) {
                editor.setDecorations(decorationType, []);
            }
            this.decorationsByFile.delete(filePath);
        }
    }

    clearAllDecorations(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            // Clear all color decorations
            for (const decorationType of this.decorationTypes.values()) {
                editor.setDecorations(decorationType, []);
            }
        }
        this.decorationsByFile.clear();
    }

    getDecorationsForFile(filePath: string): Map<CategoryColor, vscode.DecorationOptions[]> {
        return this.decorationsByFile.get(filePath) || new Map();
    }

    /**
     * Refresh category colors (called when color settings change)
     */
    async refreshCategoryColors(): Promise<void> {
        errorHandler.info('Refreshing category colors', {
            operation: 'refreshCategoryColors'
        });
        
        // Update decorations for all visible editors
        for (const editor of vscode.window.visibleTextEditors) {
            await this.updateDecorationsForEditor(editor);
        }
    }

    /**
     * Get category color service
     */
    getCategoryColorService(): CategoryColorService {
        return this.categoryColorService;
    }

    dispose(): void {
        // Clean up all decoration types
        for (const decorationType of this.decorationTypes.values()) {
            decorationType.dispose();
        }
        this.decorationTypes.clear();
        this.decorationsByFile.clear();
    }
}