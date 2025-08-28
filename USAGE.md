# Bookmark Extension Usage Guide

## 🚀 Features

- **Quick Bookmarking**: Add bookmarks to any file with a single command
- **Custom Labels**: Add descriptive labels to your bookmarks
- **Organized Categories**: Group bookmarks into categories/folders
- **Activity Bar Integration**: View all bookmarks in the Explorer panel with hierarchical display
- **Search & Filter**: Find bookmarks quickly with powerful search
- **Persistent Storage**: Bookmarks persist across VS Code sessions
- **Line-specific**: Bookmarks remember the exact line where they were created
- **File Type Icons**: Visual indicators for different file types
- **Right-click Context**: Easy access from editor context menu

## 🎯 How to Use

### Adding Bookmarks

1. **Quick Bookmark**: `Ctrl+Alt+B` (Windows/Linux) or `Cmd+Alt+B` (Mac)
   - Adds a bookmark at the current cursor position
   - Uses automatic label: `filename:lineNumber`

2. **Bookmark with Custom Label**: `Ctrl+Alt+Shift+B` (Windows/Linux) or `Cmd+Alt+Shift+B` (Mac)
   - Prompts for a custom bookmark label
   - Perfect for meaningful descriptions

3. **Right-click Menu**:
   - Right-click in any file editor
   - Select "Add Bookmark" or "Add Bookmark with Label"

### Managing Bookmarks & Categories

#### Bookmark Organization
- **View Bookmarks**: Look in the Explorer panel → "Bookmarks" section (now organized by categories)
- **Open Bookmark**: Click on any bookmark to jump to that file and line
- **Edit Label**: Click the edit icon (pencil) next to any bookmark
- **Move to Category**: Use the folder icon to move bookmarks between categories
- **Remove Bookmark**: Click the trash icon next to any bookmark

#### Category Management
- **Create Category**: Categories are created automatically when you add bookmarks, or use the "New Category" command
- **Rename Category**: Click the edit icon next to any category folder
- **Remove Category**: Click the trash icon next to category (moves bookmarks to "General")
- **Expand/Collapse**: Click category folders to show/hide bookmarks

#### Search & Discovery
- **Search Bookmarks**: `Ctrl+Alt+F` (Windows/Linux) or `Cmd+Alt+F` (Mac)
  - Search by filename, path, label, or category
  - Quick pick interface with instant results
  - Click to instantly jump to any found bookmark

#### Other Actions
- **Clear All**: Use the clear all button in the bookmarks panel (removes all bookmarks)
- **Refresh**: Manually refresh the bookmark tree view

### Storage Details

Your bookmarks are stored using VS Code's **GlobalState**, which means:
- ✅ Bookmarks persist across VS Code restarts
- ✅ Available across all workspaces
- ✅ Automatically synced with VS Code settings sync
- ✅ No external files or databases needed

## 🛠 Development & Testing

### Testing Your Extension

1. **Development Mode**:
   ```bash
   # Watch for changes
   npm run watch
   
   # Press F5 in VS Code to launch Extension Development Host
   ```

2. **Test Commands**:
   - Open any file in the Extension Development Host
   - Try the keyboard shortcuts or right-click menu
   - Check the Explorer panel for the "Bookmarks" section

### Architecture

```
src/
├── extension.ts              # Main activation and command registration
├── models/
│   └── bookmark.ts          # Data models and TreeItem implementation
├── services/
│   └── bookmarkStorage.ts   # GlobalState persistence layer
└── providers/
    └── bookmarkTreeProvider.ts  # Activity Bar tree view logic
```

The extension follows a clean architecture with separation of concerns:
- **Models**: Define data structures
- **Services**: Handle storage operations
- **Providers**: Manage UI integration
- **Extension**: Coordinate everything together

## 🎨 Customization Ideas

Future enhancements you could add:
- Bookmark categories/folders
- Import/export functionality
- Workspace-specific bookmarks
- Bookmark search and filtering
- Custom bookmark icons
- Bookmark synchronization across devices