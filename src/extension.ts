import * as vscode from 'vscode';
import { BookmarkStorageService } from './services/bookmarkStorage';
import { BookmarkTreeProvider } from './providers/bookmarkTreeProvider';
import { BookmarkItem, CategoryItem } from './models/bookmark';

export function activate(context: vscode.ExtensionContext) {
	// Initialize services
	const storageService = new BookmarkStorageService(context);
	const treeProvider = new BookmarkTreeProvider(storageService);
	
	// Register tree data provider
	const treeView = vscode.window.createTreeView('bookmarkerExplorer', {
		treeDataProvider: treeProvider,
		showCollapseAll: true,
		canSelectMany: false,
		dragAndDropController: treeProvider
	});
	
	// Register commands
	const commandMap = {
		'bookmarker.addBookmark': () => treeProvider.addCurrentFileBookmark(),
		'bookmarker.addBookmarkWithLabel': () => treeProvider.addCurrentFileBookmarkWithLabel(),
		'bookmarker.removeBookmark': (item: BookmarkItem) => item?.bookmark && treeProvider.removeBookmark(item),
		'bookmarker.editBookmarkLabel': (item: BookmarkItem) => item?.bookmark && treeProvider.editBookmarkLabel(item),
		'bookmarker.clearAllBookmarks': () => treeProvider.clearAllBookmarks(),
		'bookmarker.refreshBookmarks': () => treeProvider.refresh(),
		'bookmarker.openBookmark': (bookmark: any) => treeProvider.openBookmarkFile(bookmark),
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
	
	// Extension activated silently
}

export function deactivate() {
	// Cleanup if needed
}
