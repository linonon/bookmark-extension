import * as vscode from 'vscode';
import { CategoryColor, CategoryColorInfo, CategoryColorMapping } from '../models/bookmark';
import { errorHandler } from '../utils/errorHandler';
import { STORAGE_KEYS } from '../constants';

export class CategoryColorService {
    private static readonly CATEGORY_COLORS_STORAGE_KEY = STORAGE_KEYS.WORKSPACE_BOOKMARKS + '-colors';
    
    // 8 種預定義顏色配置
    public static readonly PREDEFINED_COLORS: CategoryColorInfo[] = [
        {
            id: CategoryColor.BLUE,
            name: 'blue',
            displayName: '🔵 Blue',
            themeColor: 'list.highlightForeground',
            hexColor: '#007ACC'
        },
        {
            id: CategoryColor.GREEN,
            name: 'green', 
            displayName: '🟢 Green',
            themeColor: 'gitDecoration.addedResourceForeground',
            hexColor: '#16A085'
        },
        {
            id: CategoryColor.RED,
            name: 'red',
            displayName: '🔴 Red', 
            themeColor: 'gitDecoration.deletedResourceForeground',
            hexColor: '#E74C3C'
        },
        {
            id: CategoryColor.PURPLE,
            name: 'purple',
            displayName: '🟣 Purple',
            themeColor: 'gitDecoration.modifiedResourceForeground', 
            hexColor: '#8E44AD'
        },
        {
            id: CategoryColor.ORANGE,
            name: 'orange',
            displayName: '🟠 Orange',
            themeColor: 'editorWarning.foreground',
            hexColor: '#F39C12'
        },
        {
            id: CategoryColor.YELLOW,
            name: 'yellow',
            displayName: '🟡 Yellow',
            themeColor: 'editorInfo.foreground', 
            hexColor: '#F1C40F'
        },
        {
            id: CategoryColor.PINK,
            name: 'pink',
            displayName: '🩷 Pink',
            themeColor: 'charts.pink',
            hexColor: '#FF69B4'
        },
        {
            id: CategoryColor.GRAY,
            name: 'gray',
            displayName: '🩶 Gray',
            themeColor: 'descriptionForeground',
            hexColor: '#7F8C8D'
        }
    ];

    // 默認顏色 (根目錄使用)
    public static readonly DEFAULT_COLOR = CategoryColor.BLUE;

    constructor(private context: vscode.ExtensionContext) {}

    /**
     * 獲取分類的顏色設置
     */
    getCategoryColor(categoryPath: string | null): CategoryColor {
        if (categoryPath === null || categoryPath === '') {
            // 根目錄書籤始終使用默認顏色
            return CategoryColorService.DEFAULT_COLOR;
        }

        const colorMappings = this.getColorMappings();
        return colorMappings[categoryPath] || CategoryColorService.DEFAULT_COLOR;
    }

    /**
     * 設置分類顏色
     */
    async setCategoryColor(categoryPath: string, color: CategoryColor): Promise<void> {
        if (categoryPath === null || categoryPath === '') {
            errorHandler.warn('Cannot set color for root category', {
                operation: 'setCategoryColor',
                showToUser: true,
                userMessage: 'Cannot change color for root category'
            });
            return;
        }

        const colorMappings = this.getColorMappings();
        colorMappings[categoryPath] = color;

        await this.saveColorMappings(colorMappings);
        
        errorHandler.info('Category color updated', {
            operation: 'setCategoryColor',
            details: { categoryPath, color },
            showToUser: true,
            userMessage: `Category "${categoryPath}" color updated to ${this.getColorInfo(color)?.displayName}`
        });
    }

    /**
     * 重置分類顏色為默認
     */
    async resetCategoryColor(categoryPath: string): Promise<void> {
        if (categoryPath === null || categoryPath === '') {
            return;
        }

        const colorMappings = this.getColorMappings();
        delete colorMappings[categoryPath];

        await this.saveColorMappings(colorMappings);
        
        errorHandler.info('Category color reset', {
            operation: 'resetCategoryColor',
            details: { categoryPath },
            showToUser: true,
            userMessage: `Category "${categoryPath}" color reset to default`
        });
    }

    /**
     * 獲取顏色資訊
     */
    getColorInfo(color: CategoryColor): CategoryColorInfo | undefined {
        return CategoryColorService.PREDEFINED_COLORS.find(c => c.id === color);
    }

    /**
     * 獲取所有可用顏色
     */
    getAvailableColors(): CategoryColorInfo[] {
        return CategoryColorService.PREDEFINED_COLORS;
    }

    /**
     * 檢查分類是否可以設置顏色
     */
    canSetColor(categoryPath: string | null): boolean {
        return categoryPath !== null && categoryPath !== '';
    }

    /**
     * 獲取顏色的 VS Code ThemeColor
     */
    getThemeColor(color: CategoryColor): vscode.ThemeColor {
        const colorInfo = this.getColorInfo(color);
        return new vscode.ThemeColor(colorInfo?.themeColor || 'list.highlightForeground');
    }

    /**
     * 獲取所有分類顏色映射
     */
    private getColorMappings(): CategoryColorMapping {
        return this.context.workspaceState.get<CategoryColorMapping>(
            CategoryColorService.CATEGORY_COLORS_STORAGE_KEY,
            {}
        );
    }

    /**
     * 保存顏色映射
     */
    private async saveColorMappings(mappings: CategoryColorMapping): Promise<void> {
        await this.context.workspaceState.update(
            CategoryColorService.CATEGORY_COLORS_STORAGE_KEY,
            mappings
        );
    }

    /**
     * 清除所有顏色設置
     */
    async clearAllColors(): Promise<void> {
        await this.saveColorMappings({});
        errorHandler.info('All category colors cleared', {
            operation: 'clearAllColors',
            showToUser: true,
            userMessage: 'All category color settings cleared'
        });
    }
}