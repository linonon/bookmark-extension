import { VALIDATION } from '../constants';

export interface ValidationResult {
    isValid: boolean;
    error?: string;
    sanitized?: string;
}

export class InputValidator {
    /**
     * Validates and sanitizes bookmark labels
     */
    static validateBookmarkLabel(label: string): ValidationResult {
        if (!label) {
            return { isValid: false, error: 'Label cannot be empty' };
        }

        if (label.length > VALIDATION.MAX_LABEL_LENGTH) {
            return { 
                isValid: false, 
                error: `Label must be less than ${VALIDATION.MAX_LABEL_LENGTH} characters` 
            };
        }

        // Remove potentially dangerous characters and normalize whitespace
        const sanitized = label
            .replace(/[\r\n\t]/g, ' ')  // Replace line breaks and tabs with spaces
            .replace(/\s+/g, ' ')       // Normalize multiple spaces to single space
            .trim();                    // Remove leading/trailing whitespace

        if (!sanitized) {
            return { isValid: false, error: 'Label cannot be empty after sanitization' };
        }

        return { isValid: true, sanitized };
    }

    /**
     * Validates and sanitizes category names
     */
    static validateCategoryName(categoryName: string): ValidationResult {
        if (!categoryName) {
            return { isValid: false, error: 'Category name cannot be empty' };
        }

        if (categoryName.length > VALIDATION.MAX_CATEGORY_LENGTH) {
            return { 
                isValid: false, 
                error: `Category name must be less than ${VALIDATION.MAX_CATEGORY_LENGTH} characters` 
            };
        }

        // Check for invalid characters
        if (VALIDATION.INVALID_CATEGORY_CHARS.test(categoryName)) {
            return { 
                isValid: false, 
                error: 'Category name contains invalid characters. Avoid < > : " | ? *' 
            };
        }

        // Check for invalid path patterns
        if (categoryName.includes('//') || categoryName.startsWith('/') || categoryName.endsWith('/')) {
            return { 
                isValid: false, 
                error: 'Invalid category path format. Use "Parent/Child" format without leading or trailing slashes' 
            };
        }

        // Sanitize the category name
        const parts = categoryName.split(VALIDATION.CATEGORY_PATH_SEPARATOR);
        const sanitizedParts = parts.map(part => 
            part.trim().replace(/\s+/g, ' ')
        ).filter(part => part.length > 0);

        if (sanitizedParts.length === 0) {
            return { isValid: false, error: 'Category name cannot be empty after sanitization' };
        }

        const sanitized = sanitizedParts.join(VALIDATION.CATEGORY_PATH_SEPARATOR);
        return { isValid: true, sanitized };
    }

    /**
     * Validates file paths to prevent path traversal attacks
     */
    static validateFilePath(filePath: string): ValidationResult {
        if (!filePath) {
            return { isValid: false, error: 'File path cannot be empty' };
        }

        // Check for path traversal attempts
        if (filePath.includes('..') || filePath.includes('~')) {
            return { 
                isValid: false, 
                error: 'File path contains potentially dangerous characters' 
            };
        }

        // Normalize path separators and remove duplicate slashes
        const sanitized = filePath
            .replace(/\\/g, '/') // Normalize backslashes to forward slashes
            .replace(/\/+/g, '/'); // Remove duplicate slashes

        return { isValid: true, sanitized };
    }

    /**
     * Validates and sanitizes search terms to prevent regex injection
     */
    static validateSearchTerm(searchTerm: string): ValidationResult {
        if (!searchTerm) {
            return { isValid: false, error: 'Search term cannot be empty' };
        }

        if (searchTerm.length > 100) { // Reasonable search term length limit
            return { 
                isValid: false, 
                error: 'Search term is too long' 
            };
        }

        // Escape regex special characters to prevent injection
        const sanitized = searchTerm
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
            .trim();

        if (!sanitized) {
            return { isValid: false, error: 'Search term cannot be empty after sanitization' };
        }

        return { isValid: true, sanitized };
    }

    /**
     * Validates workspace folder names
     */
    static validateWorkspacePath(workspacePath: string): ValidationResult {
        if (!workspacePath) {
            return { isValid: true, sanitized: workspacePath }; // Allow empty workspace paths
        }

        // Check for dangerous path patterns
        if (workspacePath.includes('..') || workspacePath.includes('~')) {
            return { 
                isValid: false, 
                error: 'Workspace path contains potentially dangerous characters' 
            };
        }

        const sanitized = workspacePath.trim();
        return { isValid: true, sanitized };
    }

    /**
     * General purpose text sanitizer for user inputs
     */
    static sanitizeUserInput(input: string, maxLength: number = 200): string {
        if (!input) {
            return '';
        }
        
        return input
            .replace(/[\r\n\t]/g, ' ')  // Replace line breaks with spaces
            .replace(/\s+/g, ' ')       // Normalize whitespace
            .slice(0, maxLength)        // Truncate to max length
            .trim();                    // Remove leading/trailing whitespace
    }

    /**
     * Validates that a string is safe for use in VS Code UI elements
     */
    static validateUIText(text: string, maxLength: number = 100): ValidationResult {
        if (!text) {
            return { isValid: false, error: 'Text cannot be empty' };
        }

        if (text.length > maxLength) {
            return { 
                isValid: false, 
                error: `Text must be less than ${maxLength} characters` 
            };
        }

        // Remove control characters and other potentially problematic characters
        const sanitized = text
            .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
            .replace(/\s+/g, ' ')            // Normalize whitespace
            .trim();

        if (!sanitized) {
            return { isValid: false, error: 'Text cannot be empty after sanitization' };
        }

        return { isValid: true, sanitized };
    }

    /**
     * Normalizes category values for consistent handling of null/undefined/empty values
     * 
     * Rules:
     * - undefined -> null (no category)
     * - null -> null (preserve no category)
     * - empty string '' -> null (treat as no category)
     * - whitespace-only string -> null (treat as no category)
     * - valid string -> return as-is
     */
    static normalizeCategoryValue(category: string | null | undefined): string | null {
        // Handle undefined - convert to null for no category
        if (category === undefined) {
            return null;
        }

        // Handle null - preserve null for no category
        if (category === null) {
            return null;
        }

        // Handle string values
        const trimmed = category.trim();
        
        // Empty or whitespace-only strings should be treated as no category
        if (trimmed === '') {
            return null;
        }

        // Return valid category string as-is
        return trimmed;
    }

    /**
     * Get category for comparison purposes
     */
    static getCategoryForComparison(category: string | null | undefined): string | null {
        return this.normalizeCategoryValue(category);
    }
}