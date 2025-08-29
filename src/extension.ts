import * as vscode from 'vscode';
import { BookmarkStorageService } from './services/bookmarkStorage';
import { BookmarkTreeProvider } from './providers/bookmarkTreeProvider';
import { Bookmark, BookmarkItem, CategoryItem } from './models/bookmark';
import { errorHandler } from './utils/errorHandler';

export function activate(context: vscode.ExtensionContext) {
	// Initialize services
	const storageService = new BookmarkStorageService(context);
	const treeProvider = new BookmarkTreeProvider(storageService);
	
	// Register tree data provider
	const treeView = vscode.window.createTreeView('bookmarkerExplorer', {
		treeDataProvider: treeProvider,
		showCollapseAll: true,
		canSelectMany: true,
		dragAndDropController: treeProvider
	});
	
	// Register commands
	const commandMap = {
		'bookmarker.addBookmark': () => treeProvider.addCurrentFileBookmark(),
		'bookmarker.addBookmarkWithLabel': () => treeProvider.addCurrentFileBookmarkWithLabel(),
		'bookmarker.removeBookmark': (item: BookmarkItem, allSelected?: BookmarkItem[]) => {
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
		},
		'bookmarker.editBookmarkLabel': (item: BookmarkItem, allSelected?: BookmarkItem[]) => {
			// Only allow editing single bookmark labels
			if (allSelected && allSelected.length > 1) {
				vscode.window.showInformationMessage('Label editing is only available for single bookmarks. Please select one bookmark.');
				return;
			}
			return item?.bookmark && treeProvider.editBookmarkLabel(item);
		},
		'bookmarker.clearAllBookmarks': () => treeProvider.clearAllBookmarks(),
		'bookmarker.refreshBookmarks': () => treeProvider.refresh(),
		'bookmarker.openBookmark': (bookmark: Bookmark) => treeProvider.openBookmarkFile(bookmark),
		'bookmarker.renameCategory': (item: CategoryItem) => item?.categoryName && treeProvider.renameCategory(item),
		'bookmarker.removeCategory': (item: CategoryItem) => item?.categoryName && treeProvider.removeCategory(item),
		'bookmarker.createNewCategory': () => treeProvider.createNewCategory(),
		'bookmarker.searchBookmarks': () => treeProvider.searchBookmarks(),
		'bookmarker.addSubCategory': (item: CategoryItem) => item?.fullPath && treeProvider.addSubCategory(item)
	};

	const commands = Object.entries(commandMap).map(([name, handler]) =>
		vscode.commands.registerCommand(name, handler)
	);
	
	// Add all disposables to context
	context.subscriptions.push(treeView, ...commands);
	
	// Initialize error handler
	errorHandler.info('Bookmarker extension activated', {
		operation: 'activate',
		showToUser: false
	});
}

export function deactivate() {
	errorHandler.info('Bookmarker extension deactivated', {
		operation: 'deactivate',
		showToUser: false
	});
	errorHandler.dispose();
}
