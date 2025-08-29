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
	const commands = [
		vscode.commands.registerCommand('bookmarker.addBookmark', async () => {
			await treeProvider.addCurrentFileBookmark();
		}),
		
		vscode.commands.registerCommand('bookmarker.addBookmarkWithLabel', async () => {
			await treeProvider.addCurrentFileBookmarkWithLabel();
		}),
		
		vscode.commands.registerCommand('bookmarker.removeBookmark', async (bookmarkItem: BookmarkItem) => {
			if (bookmarkItem && bookmarkItem.bookmark) {
				await treeProvider.removeBookmark(bookmarkItem);
			}
		}),
		
		vscode.commands.registerCommand('bookmarker.editBookmarkLabel', async (bookmarkItem: BookmarkItem) => {
			if (bookmarkItem && bookmarkItem.bookmark) {
				await treeProvider.editBookmarkLabel(bookmarkItem);
			}
		}),
		
		vscode.commands.registerCommand('bookmarker.clearAllBookmarks', async () => {
			await treeProvider.clearAllBookmarks();
		}),
		
		vscode.commands.registerCommand('bookmarker.refreshBookmarks', () => {
			treeProvider.refresh();
		}),
		
		// Command for opening bookmarked files (used by TreeItem command)
		vscode.commands.registerCommand('bookmarker.openBookmark', async (bookmark) => {
			await treeProvider.openBookmarkFile(bookmark);
		}),
		
		// Category management commands
		
		vscode.commands.registerCommand('bookmarker.renameCategory', async (categoryItem: CategoryItem) => {
			if (categoryItem && categoryItem.categoryName) {
				await treeProvider.renameCategory(categoryItem);
			}
		}),
		
		vscode.commands.registerCommand('bookmarker.removeCategory', async (categoryItem: CategoryItem) => {
			if (categoryItem && categoryItem.categoryName) {
				await treeProvider.removeCategory(categoryItem);
			}
		}),
		
		vscode.commands.registerCommand('bookmarker.createNewCategory', async () => {
			await treeProvider.createNewCategory();
		}),
		
		vscode.commands.registerCommand('bookmarker.searchBookmarks', async () => {
			await treeProvider.searchBookmarks();
		}),
		
		vscode.commands.registerCommand('bookmarker.addSubCategory', async (categoryItem: CategoryItem) => {
			if (categoryItem && categoryItem.fullPath) {
				await treeProvider.addSubCategory(categoryItem);
			}
		})
	];
	
	// Add all disposables to context
	context.subscriptions.push(treeView, ...commands);
	
	// Extension activated silently
}

export function deactivate() {
	// Cleanup if needed
}
