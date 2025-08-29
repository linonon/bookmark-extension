import * as assert from 'assert';
import * as vscode from 'vscode';
import { BookmarkStorageService } from '../services/bookmarkStorage';
import { CategoryColorService } from '../services/categoryColorService';
import { CATEGORIES } from '../constants';

suite('Bookmarker Extension Tests', () => {
    test('Extension should activate', async () => {
        const extension = vscode.extensions.getExtension('linonon.bookmarker'); // cspell:ignore linonon
        assert.ok(extension, 'Extension should be found');
        
        await extension?.activate();
        assert.ok(extension?.isActive, 'Extension should be active');
    });

    test('BookmarkStorageService initializes correctly', () => {
        const mockContext = {
            workspaceState: {
                get: () => [],
                update: () => Promise.resolve()
            }
        } as any;
        
        const storageService = new BookmarkStorageService(mockContext);
        assert.ok(storageService, 'Storage service should initialize');
    });

    test('CategoryColorService has correct default color', () => {
        const mockContext = {
            workspaceState: {
                get: () => ({}),
                update: () => Promise.resolve()
            }
        } as any;
        
        const colorService = new CategoryColorService(mockContext);
        const defaultColor = colorService.getCategoryColor(null);
        assert.strictEqual(defaultColor, CategoryColorService.DEFAULT_COLOR, 'Default color should match');
    });

    test('CATEGORIES constants are defined', () => {
        assert.ok(CATEGORIES.PLACEHOLDER_PREFIX, 'Placeholder prefix should be defined');
        assert.ok(CATEGORIES.EMPTY_MESSAGE, 'Empty message should be defined');
        assert.strictEqual(CATEGORIES.NO_CATEGORY, null, 'No category should be null');
    });
});
