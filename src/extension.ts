import * as vscode from 'vscode';
import { BookmarkStorageService } from './services/bookmarkStorage';
import { GutterDecorationService } from './services/gutterDecorationService';
import { CategoryColorService } from './services/categoryColorService';
import { BookmarkPositionTracker } from './services/bookmarkPositionTracker';
import { ContentAnchorService } from './services/contentAnchorService';
import { BookmarkTreeProvider } from './providers/bookmarkTreeProvider';
import { Bookmark, BookmarkItem, CategoryItem } from './models/bookmark';
import { errorHandler } from './utils/errorHandler';

export function activate(context: vscode.ExtensionContext) {
	try {
		// Initialize core services
		const storageService = new BookmarkStorageService(context);
		const categoryColorService = new CategoryColorService(context);
		const gutterDecorationService = new GutterDecorationService(storageService, context, categoryColorService);
		
		// Initialize position tracking services
		const contentAnchorService = new ContentAnchorService(storageService);
		const positionTracker = new BookmarkPositionTracker(storageService, () => {
			// Callback to refresh tree view when bookmarks are updated
			treeProvider.refresh();
			gutterDecorationService.refreshAllDecorations();
		});
		
		const treeProvider = new BookmarkTreeProvider(storageService);
		
		// Connect services
		treeProvider.setGutterDecorationService(gutterDecorationService);
		treeProvider.setCategoryColorService(categoryColorService);
		treeProvider.setContentAnchorService(contentAnchorService);
		
		// Register tree data provider
		const treeView = vscode.window.createTreeView('bookmarkerExplorer', {
			treeDataProvider: treeProvider,
			showCollapseAll: true,
			canSelectMany: true,
			dragAndDropController: treeProvider
		});

		// Command handler functions
		const handleRemoveBookmark = (item: BookmarkItem, allSelected?: BookmarkItem[]) => {
			if (allSelected && allSelected.length > 1) {
				// Multi-selection: remove all selected bookmarks
				const bookmarkItems = allSelected.filter(selected => selected instanceof BookmarkItem && selected.bookmark);
				if (bookmarkItems.length > 0) {
					return treeProvider.removeMultipleBookmarks(bookmarkItems);
				}
			} else if (item?.bookmark) {
				// Single selection: remove single bookmark
				return treeProvider.removeBookmark(item);
			}
			// Return undefined for cases where no action is taken
			return undefined;
		};

		const handleEditBookmarkLabel = (item: BookmarkItem, allSelected?: BookmarkItem[]) => {
			// Only allow editing single bookmark labels
			if (allSelected && allSelected.length > 1) {
				errorHandler.showInfo('Label editing is only available for single bookmarks. Please select one bookmark.');
				return;
			}
			return item?.bookmark && treeProvider.editBookmarkLabel(item);
		};

		const handleRenameCategory = (item: CategoryItem) => {
			return item?.categoryName && treeProvider.renameCategory(item);
		};

		const handleRemoveCategory = (item: CategoryItem) => {
			return item?.categoryName && treeProvider.removeCategory(item);
		};

		const handleAddSubCategory = (item: CategoryItem) => {
			return item?.fullPath && treeProvider.addSubCategory(item);
		};

		const handleSetCategoryColor = (item: CategoryItem) => {
			return item?.fullPath && treeProvider.setCategoryColor(item);
		};
	
		// Register commands
		const commandMap = {
			'bookmarker.addBookmark': () => treeProvider.addCurrentFileBookmark(),
			'bookmarker.addBookmarkWithLabel': () => treeProvider.addCurrentFileBookmarkWithLabel(),
			'bookmarker.removeBookmark': handleRemoveBookmark,
			'bookmarker.editBookmarkLabel': handleEditBookmarkLabel,
			'bookmarker.clearAllBookmarks': () => treeProvider.clearAllBookmarks(),
			'bookmarker.refreshBookmarks': () => {
				treeProvider.refresh();
				gutterDecorationService.refreshAllDecorations();
			},
			'bookmarker.openBookmark': (bookmark: Bookmark) => treeProvider.openBookmarkFile(bookmark),
			'bookmarker.renameCategory': handleRenameCategory,
			'bookmarker.removeCategory': handleRemoveCategory,
			'bookmarker.createNewCategory': () => treeProvider.createNewCategory(),
			'bookmarker.searchBookmarks': () => treeProvider.searchBookmarks(),
			'bookmarker.addSubCategory': handleAddSubCategory,
			'bookmarker.setCategoryColor': handleSetCategoryColor,
			'bookmarker.generateMissingAnchors': async () => {
				const count = await contentAnchorService.generateMissingAnchors();
				if (count > 0) {
					vscode.window.showInformationMessage(`Generated content anchors for ${count} bookmarks. Position tracking is now active for these bookmarks.`);
					treeProvider.refresh();
				} else {
					vscode.window.showInformationMessage('All bookmarks already have content anchors for position tracking.');
				}
			}
		};

		const commands = Object.entries(commandMap).map(([name, handler]) =>
			vscode.commands.registerCommand(name, handler)
		);
		
		// Add all disposables to context
		context.subscriptions.push(treeView, gutterDecorationService, positionTracker, ...commands);
		
		// Initialize missing content anchors for existing bookmarks on startup
		setTimeout(async () => {
			try {
				const generatedCount = await contentAnchorService.generateMissingAnchors();
				if (generatedCount > 0) {
					errorHandler.info(`Auto-generated content anchors for ${generatedCount} existing bookmarks`, {
						operation: 'activate',
						showToUser: false
					});
				}
			} catch (error) {
				errorHandler.debug('Failed to auto-generate missing anchors on startup', {
					operation: 'activate',
					details: { error: error instanceof Error ? error.message : String(error) }
				});
			}
		}, 2000); // Delay to avoid blocking extension activation

		// Initialize error handler
		errorHandler.info('Bookmarker extension activated with position tracking', {
			operation: 'activate',
			showToUser: false
		});
	} catch (error) {
		errorHandler.error('Failed to activate Bookmarker extension', error as Error, {
			operation: 'activate',
			showToUser: true
		});
		throw error;
	}
}

export function deactivate() {
	errorHandler.info('Bookmarker extension deactivated', {
		operation: 'deactivate',
		showToUser: false
	});
	errorHandler.dispose();
}
