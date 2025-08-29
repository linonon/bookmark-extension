import * as vscode from 'vscode';
import { Bookmark } from '../models/bookmark';
import { BookmarkStorageService } from './bookmarkStorage';
import { errorHandler } from '../utils/errorHandler';

export interface RelocationResult {
    success: boolean;
    newLineNumber?: number;
    confidence: number; // 0-1, where 1 is exact match
    method: 'exact' | 'fuzzy' | 'failed';
}

export class ContentAnchorService {
    constructor(private storageService: BookmarkStorageService) {}

    /**
     * Generate a content anchor for a given line of text
     */
    generateAnchor(lineText: string, maxLength?: number): string {
        // Get anchor length from configuration if not provided
        if (maxLength === undefined) {
            const config = vscode.workspace.getConfiguration('bookmarker');
            maxLength = config.get<number>('positionTracking.anchorLength', 50);
        }
        
        return lineText.trim().substring(0, maxLength).replace(/\s+/g, ' ');
    }

    /**
     * Attempt to relocate a bookmark based on its content anchor
     */
    async relocateByAnchor(bookmark: Bookmark): Promise<RelocationResult> {
        if (!bookmark.contentAnchor || !bookmark.lineNumber) {
            return {
                success: false,
                confidence: 0,
                method: 'failed'
            };
        }

        try {
            const document = await vscode.workspace.openTextDocument(bookmark.filePath);
            
            // Define search range around the original position
            const searchRange = this.getSearchRange(bookmark.lineNumber, document.lineCount);
            
            // Try exact match first
            const exactMatch = this.findExactMatch(document, bookmark.contentAnchor, searchRange);
            if (exactMatch !== null) {
                return {
                    success: true,
                    newLineNumber: exactMatch,
                    confidence: 1.0,
                    method: 'exact'
                };
            }

            // Try fuzzy match if exact match fails
            const fuzzyMatch = this.findFuzzyMatch(document, bookmark.contentAnchor, searchRange);
            if (fuzzyMatch.lineNumber !== null && fuzzyMatch.confidence > 0.8) {
                return {
                    success: true,
                    newLineNumber: fuzzyMatch.lineNumber,
                    confidence: fuzzyMatch.confidence,
                    method: 'fuzzy'
                };
            }

            return {
                success: false,
                confidence: fuzzyMatch.confidence,
                method: 'failed'
            };

        } catch (error) {
            errorHandler.error('Failed to relocate bookmark by anchor', error as Error, {
                operation: 'relocateByAnchor',
                details: { bookmarkId: bookmark.id, filePath: bookmark.filePath }
            });

            return {
                success: false,
                confidence: 0,
                method: 'failed'
            };
        }
    }

    /**
     * Batch relocate multiple bookmarks for a file
     */
    async relocateBookmarksInFile(filePath: string): Promise<Map<string, RelocationResult>> {
        const results = new Map<string, RelocationResult>();
        
        try {
            const allBookmarks = await this.storageService.getBookmarks();
            const fileBookmarks = allBookmarks.filter(b => 
                b.filePath === filePath && 
                b.contentAnchor && 
                b.lineNumber
            );

            if (fileBookmarks.length === 0) {
                return results;
            }

            // Process all bookmarks in the file
            for (const bookmark of fileBookmarks) {
                const result = await this.relocateByAnchor(bookmark);
                results.set(bookmark.id, result);

                // Update bookmark if relocation was successful
                if (result.success && result.newLineNumber) {
                    await this.storageService.updateBookmark(bookmark.id, {
                        lineNumber: result.newLineNumber
                    });

                    errorHandler.debug('Bookmark relocated by anchor', {
                        operation: 'relocateBookmarksInFile',
                        details: {
                            bookmarkId: bookmark.id,
                            oldLine: bookmark.lineNumber,
                            newLine: result.newLineNumber,
                            confidence: result.confidence,
                            method: result.method
                        }
                    });
                }
            }

        } catch (error) {
            errorHandler.error('Failed to relocate bookmarks in file', error as Error, {
                operation: 'relocateBookmarksInFile',
                details: { filePath }
            });
        }

        return results;
    }

    private getSearchRange(originalLine: number, totalLines: number): { start: number; end: number } {
        // Search in a window around the original position
        const searchWindow = 20; // lines to search above and below
        
        return {
            start: Math.max(1, originalLine - searchWindow),
            end: Math.min(totalLines, originalLine + searchWindow)
        };
    }

    private findExactMatch(
        document: vscode.TextDocument, 
        anchor: string, 
        range: { start: number; end: number }
    ): number | null {
        for (let lineNum = range.start; lineNum <= range.end; lineNum++) {
            const lineIndex = lineNum - 1; // Convert to 0-based
            
            if (lineIndex >= 0 && lineIndex < document.lineCount) {
                const lineText = document.lineAt(lineIndex).text;
                const lineAnchor = this.generateAnchor(lineText);
                
                if (lineAnchor === anchor) {
                    return lineNum;
                }
            }
        }
        
        return null;
    }

    private findFuzzyMatch(
        document: vscode.TextDocument, 
        anchor: string, 
        range: { start: number; end: number }
    ): { lineNumber: number | null; confidence: number } {
        let bestMatch: { lineNumber: number | null; confidence: number } = {
            lineNumber: null,
            confidence: 0
        };

        for (let lineNum = range.start; lineNum <= range.end; lineNum++) {
            const lineIndex = lineNum - 1; // Convert to 0-based
            
            if (lineIndex >= 0 && lineIndex < document.lineCount) {
                const lineText = document.lineAt(lineIndex).text;
                const lineAnchor = this.generateAnchor(lineText);
                
                const confidence = this.calculateSimilarity(anchor, lineAnchor);
                
                if (confidence > bestMatch.confidence) {
                    bestMatch = {
                        lineNumber: lineNum,
                        confidence
                    };
                }
            }
        }

        return bestMatch;
    }

    private calculateSimilarity(str1: string, str2: string): number {
        // Use Levenshtein distance to calculate similarity
        const len1 = str1.length;
        const len2 = str2.length;
        
        if (len1 === 0) {
            return len2 === 0 ? 1 : 0;
        }
        if (len2 === 0) {
            return 0;
        }
        
        // Create matrix
        const matrix: number[][] = [];
        for (let i = 0; i <= len1; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= len2; j++) {
            matrix[0]![j] = j;
        }
        
        // Fill matrix
        for (let i = 1; i <= len1; i++) {
            for (let j = 1; j <= len2; j++) {
                if (str1.charAt(i - 1) === str2.charAt(j - 1)) {
                    matrix[i]![j] = matrix[i - 1]![j - 1]!;
                } else {
                    matrix[i]![j] = Math.min(
                        matrix[i - 1]![j - 1]! + 1, // substitution
                        matrix[i]![j - 1]! + 1,     // insertion
                        matrix[i - 1]![j]! + 1      // deletion
                    );
                }
            }
        }
        
        const distance = matrix[len1]![len2]!;
        const maxLength = Math.max(len1, len2);
        
        // Convert distance to similarity (0-1, where 1 is identical)
        return maxLength === 0 ? 1 : (maxLength - distance) / maxLength;
    }

    /**
     * Validate and update content anchors for bookmarks that don't have them
     */
    async generateMissingAnchors(): Promise<number> {
        let updatedCount = 0;
        
        try {
            const allBookmarks = await this.storageService.getBookmarks();
            const bookmarksNeedingAnchors = allBookmarks.filter(b => 
                b.lineNumber && 
                !b.contentAnchor && 
                b.trackingEnabled !== false
            );

            for (const bookmark of bookmarksNeedingAnchors) {
                try {
                    const document = await vscode.workspace.openTextDocument(bookmark.filePath);
                    const lineIndex = bookmark.lineNumber! - 1;
                    
                    if (lineIndex >= 0 && lineIndex < document.lineCount) {
                        const lineText = document.lineAt(lineIndex).text;
                        const contentAnchor = this.generateAnchor(lineText);
                        
                        await this.storageService.updateBookmark(bookmark.id, {
                            contentAnchor,
                            lastKnownContent: lineText,
                            trackingEnabled: true
                        });
                        
                        updatedCount++;
                    }
                } catch (fileError) {
                    // Skip bookmarks for files that can't be opened
                    errorHandler.debug('Skipped anchor generation for inaccessible file', {
                        operation: 'generateMissingAnchors',
                        details: { bookmarkId: bookmark.id, filePath: bookmark.filePath }
                    });
                }
            }

            if (updatedCount > 0) {
                errorHandler.info(`Generated content anchors for ${updatedCount} bookmarks`, {
                    operation: 'generateMissingAnchors',
                    showToUser: updatedCount >= 10 // Only show to user if many were updated
                });
            }

        } catch (error) {
            errorHandler.error('Failed to generate missing anchors', error as Error, {
                operation: 'generateMissingAnchors'
            });
        }

        return updatedCount;
    }
}