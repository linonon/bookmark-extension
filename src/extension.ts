import * as vscode from 'vscode';
import { BookmarkStorageService } from './services/bookmarkStorage';
import { BookmarkTreeProvider } from './providers/bookmarkTreeProvider';
import { BookmarkItem, CategoryItem } from './models/bookmark';

export function activate(context: vscode.ExtensionContext) {
	console.log('Bookmark Extension is now active!');
	
	// Initialize services
	const storageService = new BookmarkStorageService(context);
	const treeProvider = new BookmarkTreeProvider(storageService);
	
	// Register tree data provider
	const treeView = vscode.window.createTreeView('bookmarkExplorer', {
		treeDataProvider: treeProvider,
		showCollapseAll: true,
		canSelectMany: false
	});
	
	// Register commands
	const commands = [
		vscode.commands.registerCommand('bookmark-extension.addBookmark', async () => {
			await treeProvider.addCurrentFileBookmark();
		}),
		
		vscode.commands.registerCommand('bookmark-extension.addBookmarkWithLabel', async () => {
			const label = await vscode.window.showInputBox({
				prompt: 'Enter bookmark label',
				placeHolder: 'My bookmark label'
			});
			
			if (label !== undefined) {
				await treeProvider.addCurrentFileBookmark(label);
			}
		}),
		
		vscode.commands.registerCommand('bookmark-extension.removeBookmark', async (bookmarkItem: BookmarkItem) => {
			if (bookmarkItem && bookmarkItem.bookmark) {
				await treeProvider.removeBookmark(bookmarkItem);
			}
		}),
		
		vscode.commands.registerCommand('bookmark-extension.editBookmarkLabel', async (bookmarkItem: BookmarkItem) => {
			if (bookmarkItem && bookmarkItem.bookmark) {
				await treeProvider.editBookmarkLabel(bookmarkItem);
			}
		}),
		
		vscode.commands.registerCommand('bookmark-extension.clearAllBookmarks', async () => {
			await treeProvider.clearAllBookmarks();
		}),
		
		vscode.commands.registerCommand('bookmark-extension.refreshBookmarks', () => {
			treeProvider.refresh();
		}),
		
		// Command for opening bookmarked files (used by TreeItem command)
		vscode.commands.registerCommand('bookmark-extension.openBookmark', async (bookmark) => {
			await treeProvider.openBookmarkFile(bookmark);
		}),
		
		// Category management commands
		vscode.commands.registerCommand('bookmark-extension.moveBookmarkToCategory', async (bookmarkItem: BookmarkItem) => {
			if (bookmarkItem && bookmarkItem.bookmark) {
				await treeProvider.moveBookmarkToCategory(bookmarkItem);
			}
		}),
		
		vscode.commands.registerCommand('bookmark-extension.renameCategory', async (categoryItem: CategoryItem) => {
			if (categoryItem && categoryItem.categoryName) {
				await treeProvider.renameCategory(categoryItem);
			}
		}),
		
		vscode.commands.registerCommand('bookmark-extension.removeCategory', async (categoryItem: CategoryItem) => {
			if (categoryItem && categoryItem.categoryName) {
				await treeProvider.removeCategory(categoryItem);
			}
		}),
		
		vscode.commands.registerCommand('bookmark-extension.createNewCategory', async () => {
			await treeProvider.createNewCategory();
		}),
		
		vscode.commands.registerCommand('bookmark-extension.searchBookmarks', async () => {
			await treeProvider.searchBookmarks();
		})
	];
	
	// Add all disposables to context
	context.subscriptions.push(treeView, ...commands);
	
	// Optional: Show welcome message on first activation
	const hasShownWelcome = context.globalState.get('hasShownWelcome', false);
	if (!hasShownWelcome) {
		vscode.window.showInformationMessage(
			'Bookmark Extension activated! Right-click in any file to add bookmarks.',
			'Got it!'
		);
		context.globalState.update('hasShownWelcome', true);
	}
}

export function deactivate() {
	// Cleanup if needed
}
