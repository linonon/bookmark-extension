# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Development workflow
npm run compile          # TypeScript compile + lint + type check
npm run watch           # Watch mode for development
npm run package         # Production build

# Testing
npm test               # Run all tests
npm run pretest        # Compile tests + code + lint

# Using Makefile (alternative)
make build            # Build and package to .vsix
make install          # Build and install to VS Code
make clean           # Remove build artifacts
```

## Architecture

Simple VS Code extension with clean 3-layer architecture:

### Core Components

**Extension Entry (`src/extension.ts`)**
- Main activation function 
- Command registration for 11 bookmark commands
- TreeView setup with drag & drop

**Data Layer (`src/models/bookmark.ts`)**
- `Bookmark` interface: id, filePath, label, lineNumber, category, createdAt
- `CategoryItem` & `BookmarkItem` classes extending `vscode.TreeItem`
- Uses VS Code's native file icons via resourceUri

**Storage Service (`src/services/bookmarkStorage.ts`)**
- Uses VS Code `workspaceState` for persistence
- Single storage strategy (removed global storage)
- Category tree management with hierarchical structure

**Tree Provider (`src/providers/bookmarkTreeProvider.ts`)**
- Implements `TreeDataProvider` & `TreeDragAndDropController`
- Handles all bookmark operations (add/remove/edit)
- Category management with drag & drop between categories
- Search functionality

### Data Flow

```
User Action ’ Command ’ TreeProvider ’ StorageService ’ VS Code WorkspaceState
```

Key files are modified: check git status for current changes to bookmark.ts, bookmarkTreeProvider.ts, and bookmarkStorage.ts.