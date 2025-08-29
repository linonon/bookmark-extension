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
        const debug = config.get<boolean>('positionTracking.debug', false);
        
        if (!this.isEnabled || !trackingEnabled || event.contentChanges.length === 0) {
            return;
        }

        const filePath = event.document.uri.fsPath;
        
        // Optional verbose diagnostics for each content change
        if (debug) {
            for (const c of event.contentChanges) {
                errorHandler.debug('Doc change', {
                    operation: 'onDocumentChanged',
                    details: {
                        filePath,
                        startLine: c.range.start.line,
                        endLine: c.range.end.line,
                        startChar: c.range.start.character,
                        insertedNewlines: (c.text.match(/\n/g) || []).length,
                        textPreview: c.text.replace(/\n/g, '\\n').substring(0, 80)
                    }
                });
            }
        }
        
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
            const { updates: updatedBookmarks, removals: removedBookmarkIds } = this.updateBookmarkPositions(event.contentChanges, fileBookmarks);

            if (updatedBookmarks.length > 0 || removedBookmarkIds.length > 0) {
                // Debounce updates/removals to avoid excessive storage operations
                this.debounceBookmarkUpdate(filePath, updatedBookmarks, removedBookmarkIds);
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
    ): { updates: Bookmark[]; removals: string[] } {
        const updatedBookmarks: Bookmark[] = [];
        const removedBookmarkIds = new Set<string>();
        
        // Sort changes from bottom to top to avoid position conflicts
        const sortedChanges = [...changes].sort((a, b) => b.range.start.line - a.range.start.line);
        
        for (const change of sortedChanges) {
            const lineDelta = this.calculateLineDelta(change);
            
            if (lineDelta !== 0) {
                bookmarks.forEach(bookmark => {
                    if (removedBookmarkIds.has(bookmark.id)) {
                        return; // already scheduled for removal
                    }
                    if (bookmark.lineNumber !== undefined) {
            const bookmarkLine = bookmark.lineNumber;        // 1-based
            const bmZero = bookmarkLine - 1;                 // normalize to 0-based for comparisons
                        let shouldUpdate = false;
                        let shouldRemove = false;
                        let newLineNumber = bookmarkLine;
                        
            if (bmZero > change.range.end.line) {
                            // Change is before bookmark line - bookmark moves down/up
                            newLineNumber = bookmarkLine + lineDelta;
                            shouldUpdate = true;
            } else if (bmZero >= change.range.start.line && bmZero <= change.range.end.line) {
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
                    if (insertPosition === 0 && change.range.start.line === bmZero) {
                                        newLineNumber = bookmarkLine + lineDelta;
                                        shouldUpdate = true;
                                    } else {
                                        newLineNumber = bookmarkLine;
                                        shouldUpdate = false;
                                    }
                                }
                            } else if (lineDelta < 0) {
                                // Lines were deleted overlapping the bookmark position
                                // Heuristic: if deletion starts at column 0 of the bookmark line (common for vim 'dd'), remove bookmark
                                const startsAtLineStart = change.range.start.character === 0;
                                const endsAtLineStart = change.range.end.character === 0; // common for full line deletions
                                const fullLineDeletionHeuristic = startsAtLineStart && (endsAtLineStart || change.range.end.line > change.range.start.line);
                                // VS Code ranges are end-exclusive; treat end.line as exclusive to avoid removing bookmark when only the previous line is deleted
                                const bookmarkWithinDeletedSpan = bmZero >= change.range.start.line && bmZero < change.range.end.line;

                                if (fullLineDeletionHeuristic && bookmarkWithinDeletedSpan) {
                                    shouldRemove = true; // delete the bookmark because its line was removed
                                } else {
                                    // Fallback: move bookmark to the start of the affected range
                                    newLineNumber = Math.max(1, change.range.start.line + 1);
                                    shouldUpdate = true;
                                }
                            } else {
                                // Text insertion/deletion without newlines - bookmark stays put
                                newLineNumber = bookmarkLine;
                                shouldUpdate = false;
                            }
                        }
                        // If change is after bookmark line, bookmark doesn't move
                        
                        if (shouldRemove) {
                            removedBookmarkIds.add(bookmark.id);
                            errorHandler.debug('Bookmark removed due to line deletion', {
                                operation: 'updateBookmarkPositions',
                                details: {
                                    bookmarkId: bookmark.id,
                                    oldLine: bookmarkLine,
                                    changeRange: `${change.range.start.line}-${change.range.end.line}`,
                                    reason: 'line-deleted'
                                }
                            });
                        } else if (shouldUpdate && newLineNumber >= 1 && newLineNumber !== bookmarkLine) {
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
                    reason: bmZero > change.range.end.line ? 'before-bookmark' : 
                       bmZero >= change.range.start.line ? 'on-bookmark' : 'after-bookmark'
                                }
                            });
                        }
                    }
                });
            }
        }
        
    return { updates: updatedBookmarks, removals: Array.from(removedBookmarkIds) };
    }

    private calculateLineDelta(change: vscode.TextDocumentContentChangeEvent): number {
        const startLine = change.range.start.line;
        const endLine = change.range.end.line;
        const deletedLines = endLine - startLine;
        const insertedLines = (change.text.match(/\n/g) || []).length;
        
        return insertedLines - deletedLines;
    }

    private debounceBookmarkUpdate(filePath: string, bookmarks: Bookmark[], removals: string[] = []): void {
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
                    const update: Partial<Bookmark> = {};
                    if (bookmark.lineNumber !== undefined) {
                        update.lineNumber = bookmark.lineNumber;
                    }
                    await this.storageService.updateBookmark(bookmark.id, update);
                }

                // Apply removals
                for (const id of removals) {
                    await this.storageService.removeBookmark(id);
                }

                // Notify listeners that bookmarks were updated
                if (this.onBookmarksUpdated) {
                    this.onBookmarksUpdated();
                }

                this.debouncedUpdate.delete(filePath);

                errorHandler.debug('Debounced bookmark update completed', {
                    operation: 'debounceBookmarkUpdate',
                    details: { filePath, updateCount: bookmarks.length, removeCount: removals.length }
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