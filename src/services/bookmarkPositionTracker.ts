import * as vscode from 'vscode';
import { Bookmark } from '../models/bookmark';
import { BookmarkStorageService } from './bookmarkStorage';
import { errorHandler } from '../utils/errorHandler';

export class BookmarkPositionTracker implements vscode.Disposable {
    private documentChangeDisposable?: vscode.Disposable;
    private isEnabled: boolean = true;
    private debouncedUpdate = new Map<string, NodeJS.Timeout>();

    constructor(
        private storageService: BookmarkStorageService,
        private onBookmarksUpdated?: () => void
    ) {
        this.initializeDocumentChangeListener();
    }

    private initializeDocumentChangeListener(): void {
        // Listen for document content changes
        this.documentChangeDisposable = vscode.workspace.onDidChangeTextDocument(
            this.onDocumentChanged.bind(this)
        );
        
        errorHandler.debug('BookmarkPositionTracker initialized', {
            operation: 'initializeDocumentChangeListener'
        });
    }

    private async onDocumentChanged(event: vscode.TextDocumentChangeEvent): Promise<void> {
        // Check if position tracking is enabled via configuration
        const config = vscode.workspace.getConfiguration('bookmarker');
        const trackingEnabled = config.get<boolean>('positionTracking.enabled', true);
        
        if (!this.isEnabled || !trackingEnabled || event.contentChanges.length === 0) {
            return;
        }

        const filePath = event.document.uri.fsPath;
        
        try {
            // Get bookmarks for this file
            const allBookmarks = await this.storageService.getBookmarks();
            const fileBookmarks = allBookmarks.filter(b => 
                b.filePath === filePath && 
                b.trackingEnabled !== false && // Default to enabled if not specified
                b.lineNumber !== undefined
            );

            if (fileBookmarks.length === 0) {
                return; // No bookmarks to track in this file
            }

            // Update bookmark positions based on document changes
            const updatedBookmarks = this.updateBookmarkPositions(event.contentChanges, fileBookmarks);
            
            if (updatedBookmarks.length > 0) {
                // Debounce updates to avoid excessive storage operations
                this.debounceBookmarkUpdate(filePath, updatedBookmarks);
            }

        } catch (error) {
            errorHandler.error('Failed to process document changes', error as Error, {
                operation: 'onDocumentChanged',
                details: { filePath }
            });
        }
    }

    private updateBookmarkPositions(
        changes: readonly vscode.TextDocumentContentChangeEvent[], 
        bookmarks: Bookmark[]
    ): Bookmark[] {
        const updatedBookmarks: Bookmark[] = [];
        
        // Sort changes from bottom to top to avoid position conflicts
        const sortedChanges = [...changes].sort((a, b) => b.range.start.line - a.range.start.line);
        
        for (const change of sortedChanges) {
            const lineDelta = this.calculateLineDelta(change);
            
            if (lineDelta !== 0) {
                bookmarks.forEach(bookmark => {
                    if (bookmark.lineNumber !== undefined) {
                        const bookmarkLine = bookmark.lineNumber;
                        let shouldUpdate = false;
                        let newLineNumber = bookmarkLine;
                        
                        if (bookmarkLine > change.range.end.line) {
                            // Change is before bookmark line - bookmark moves down/up
                            newLineNumber = bookmarkLine + lineDelta;
                            shouldUpdate = true;
                        } else if (bookmarkLine >= change.range.start.line && bookmarkLine <= change.range.end.line) {
                            // Change affects bookmark line directly
                            if (lineDelta > 0 && change.text.includes('\n')) {
                                // Line break inserted in bookmark line - determine proper behavior
                                const insertPosition = change.range.start.character;
                                const isSingleLineChange = change.range.start.line === change.range.end.line;
                                
                                if (isSingleLineChange) {
                                    // Single line with newline insertion
                                    if (insertPosition === 0) {
                                        // Newline inserted at beginning of line - content moves down
                                        newLineNumber = bookmarkLine + lineDelta;
                                        shouldUpdate = true;
                                    } else {
                                        // Newline inserted elsewhere - bookmark stays with original line
                                        // The original content remains on the current line
                                        newLineNumber = bookmarkLine;
                                        shouldUpdate = false; // No change needed
                                    }
                                } else {
                                    // Multi-line change - use conservative approach
                                    // Keep bookmark on original line unless it's a pure insertion at start
                                    if (insertPosition === 0 && change.range.start.line === bookmarkLine) {
                                        newLineNumber = bookmarkLine + lineDelta;
                                        shouldUpdate = true;
                                    } else {
                                        newLineNumber = bookmarkLine;
                                        shouldUpdate = false;
                                    }
                                }
                            } else if (lineDelta < 0) {
                                // Lines were deleted at bookmark position
                                // Keep bookmark at the start of the affected range
                                newLineNumber = Math.max(1, change.range.start.line + 1);
                                shouldUpdate = true;
                            } else {
                                // Text insertion/deletion without newlines - bookmark stays put
                                newLineNumber = bookmarkLine;
                                shouldUpdate = false;
                            }
                        }
                        // If change is after bookmark line, bookmark doesn't move
                        
                        if (shouldUpdate && newLineNumber >= 1 && newLineNumber !== bookmarkLine) {
                            bookmark.lineNumber = newLineNumber;
                            updatedBookmarks.push(bookmark);
                            
                            errorHandler.debug('Bookmark position updated', {
                                operation: 'updateBookmarkPositions',
                                details: {
                                    bookmarkId: bookmark.id,
                                    oldLine: bookmarkLine,
                                    newLine: bookmark.lineNumber,
                                    delta: lineDelta,
                                    changeRange: `${change.range.start.line}-${change.range.end.line}`,
                                    changePosition: change.range.start.character,
                                    hasNewline: change.text.includes('\n'),
                                    changeText: change.text.replace(/\n/g, '\\n').substring(0, 50),
                                    reason: bookmarkLine > change.range.end.line ? 'before-bookmark' : 
                                           bookmarkLine >= change.range.start.line ? 'on-bookmark' : 'after-bookmark'
                                }
                            });
                        }
                    }
                });
            }
        }
        
        return updatedBookmarks;
    }

    private calculateLineDelta(change: vscode.TextDocumentContentChangeEvent): number {
        const startLine = change.range.start.line;
        const endLine = change.range.end.line;
        const deletedLines = endLine - startLine;
        const insertedLines = (change.text.match(/\n/g) || []).length;
        
        return insertedLines - deletedLines;
    }

    private debounceBookmarkUpdate(filePath: string, bookmarks: Bookmark[]): void {
        // Clear existing timeout for this file
        const existingTimeout = this.debouncedUpdate.get(filePath);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
        }

        // Get throttle time from configuration
        const config = vscode.workspace.getConfiguration('bookmarker');
        const throttleMs = config.get<number>('positionTracking.updateThrottleMs', 100);

        // Set new debounced update
        const timeout = setTimeout(async () => {
            try {
                // Apply all pending updates for this file
                for (const bookmark of bookmarks) {
                    await this.storageService.updateBookmark(bookmark.id, {
                        lineNumber: bookmark.lineNumber
                    });
                }

                // Notify listeners that bookmarks were updated
                if (this.onBookmarksUpdated) {
                    this.onBookmarksUpdated();
                }

                this.debouncedUpdate.delete(filePath);

                errorHandler.debug('Debounced bookmark update completed', {
                    operation: 'debounceBookmarkUpdate',
                    details: { filePath, updateCount: bookmarks.length }
                });

            } catch (error) {
                errorHandler.error('Failed to update bookmark positions', error as Error, {
                    operation: 'debounceBookmarkUpdate',
                    details: { filePath },
                    showToUser: false
                });
            }
        }, throttleMs); // Use configured throttle time

        this.debouncedUpdate.set(filePath, timeout);
    }

    public async updateContentAnchor(bookmark: Bookmark, document?: vscode.TextDocument): Promise<void> {
        if (!bookmark.lineNumber || bookmark.trackingEnabled === false) {
            return;
        }

        try {
            let targetDocument = document;
            
            if (!targetDocument) {
                // Open document if not provided
                targetDocument = await vscode.workspace.openTextDocument(bookmark.filePath);
            }

            const lineIndex = bookmark.lineNumber - 1; // Convert to 0-based index
            
            if (lineIndex >= 0 && lineIndex < targetDocument.lineCount) {
                const lineText = targetDocument.lineAt(lineIndex).text;
                
                // Generate content anchor (first 50 characters, trimmed and normalized)
                const contentAnchor = lineText.trim().substring(0, 50).replace(/\s+/g, ' ');
                
                // Update bookmark with anchor information
                await this.storageService.updateBookmark(bookmark.id, {
                    contentAnchor,
                    lastKnownContent: lineText,
                    trackingEnabled: true
                });

                errorHandler.debug('Content anchor updated', {
                    operation: 'updateContentAnchor',
                    details: {
                        bookmarkId: bookmark.id,
                        lineNumber: bookmark.lineNumber,
                        anchorLength: contentAnchor.length
                    }
                });
            }
        } catch (error) {
            errorHandler.error('Failed to update content anchor', error as Error, {
                operation: 'updateContentAnchor',
                details: { bookmarkId: bookmark.id, filePath: bookmark.filePath }
            });
        }
    }

    public setEnabled(enabled: boolean): void {
        this.isEnabled = enabled;
        errorHandler.debug(`BookmarkPositionTracker ${enabled ? 'enabled' : 'disabled'}`, {
            operation: 'setEnabled'
        });
    }

    public isTrackingEnabled(): boolean {
        return this.isEnabled;
    }

    public dispose(): void {
        // Clear all pending timeouts
        this.debouncedUpdate.forEach(timeout => clearTimeout(timeout));
        this.debouncedUpdate.clear();
        
        // Dispose document change listener
        if (this.documentChangeDisposable) {
            this.documentChangeDisposable.dispose();
        }

        errorHandler.debug('BookmarkPositionTracker disposed', {
            operation: 'dispose'
        });
    }
}