import * as vscode from 'vscode';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

export interface ErrorContext {
    operation: string;
    details?: Record<string, any>;
    showToUser?: boolean;
    userMessage?: string;
}

export class ErrorHandler {
    private static instance: ErrorHandler;
    private outputChannel: vscode.OutputChannel;
    private logLevel: LogLevel = LogLevel.INFO;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Bookmarker');
    }

    static getInstance(): ErrorHandler {
        if (!ErrorHandler.instance) {
            ErrorHandler.instance = new ErrorHandler();
        }
        return ErrorHandler.instance;
    }

    setLogLevel(level: LogLevel): void {
        this.logLevel = level;
    }

    private log(level: LogLevel, message: string, context?: ErrorContext): void {
        if (level < this.logLevel) {
            return;
        }

        const timestamp = new Date().toISOString();
        const levelStr = LogLevel[level];
        
        let logMessage = `[${timestamp}] [${levelStr}] ${message}`;
        
        if (context?.operation) {
            logMessage += ` (Operation: ${context.operation})`;
        }
        
        if (context?.details) {
            logMessage += ` Details: ${JSON.stringify(context.details)}`;
        }

        this.outputChannel.appendLine(logMessage);
    }

    private showUserNotification(level: LogLevel, message: string): void {
        const config = vscode.workspace.getConfiguration('bookmarker');
        const notificationLevel = config.get<string>('notifications.level', 'errors-warnings');
        
        // Check if we should show this notification based on user preference
        const shouldShow = this.shouldShowNotification(level, notificationLevel);
        
        if (!shouldShow) {
            return;
        }
        
        switch (level) {
            case LogLevel.ERROR:
                vscode.window.showErrorMessage(message);
                break;
            case LogLevel.WARN:
                vscode.window.showWarningMessage(message);
                break;
            case LogLevel.INFO:
                vscode.window.showInformationMessage(message);
                break;
            default:
                // Don't show DEBUG messages to users
                break;
        }
    }
    
    private shouldShowNotification(level: LogLevel, notificationLevel: string): boolean {
        switch (notificationLevel) {
            case 'all':
                return level !== LogLevel.DEBUG;
            case 'errors-warnings':
                return level === LogLevel.ERROR || level === LogLevel.WARN;
            case 'errors-only':
                return level === LogLevel.ERROR;
            case 'none':
                return false;
            default:
                return level === LogLevel.ERROR || level === LogLevel.WARN;
        }
    }
    
    /**
     * Show information message respecting user configuration
     */
    showInfo(message: string): void {
        const config = vscode.workspace.getConfiguration('bookmarker');
        const notificationLevel = config.get<string>('notifications.level', 'errors-warnings');
        
        if (this.shouldShowNotification(LogLevel.INFO, notificationLevel)) {
            vscode.window.showInformationMessage(message);
        }
    }

    debug(message: string, context?: ErrorContext): void {
        this.log(LogLevel.DEBUG, message, context);
    }

    info(message: string, context?: ErrorContext): void {
        this.log(LogLevel.INFO, message, context);
        if (context?.showToUser) {
            this.showUserNotification(LogLevel.INFO, context.userMessage || message);
        }
    }

    warn(message: string, context?: ErrorContext): void {
        this.log(LogLevel.WARN, message, context);
        if (context?.showToUser) {
            this.showUserNotification(LogLevel.WARN, context.userMessage || message);
        }
    }

    error(message: string, error?: Error, context?: ErrorContext): void {
        let fullMessage = message;
        if (error) {
            fullMessage += `: ${error.message}`;
            if (error.stack) {
                fullMessage += `\nStack: ${error.stack}`;
            }
        }
        
        this.log(LogLevel.ERROR, fullMessage, context);
        
        if (context?.showToUser) {
            const userMessage = context.userMessage || this.getUserFriendlyErrorMessage(message, error);
            this.showUserNotification(LogLevel.ERROR, userMessage);
        }
    }

    private getUserFriendlyErrorMessage(message: string, error?: Error): string {
        // Provide user-friendly error messages for common errors
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError?.code === 'ENOENT') {
            return 'File not found. The bookmarked file may have been moved or deleted.';
        }
        if (nodeError?.code === 'EACCES') {
            return 'Permission denied. Please check file permissions.';
        }
        if (message.toLowerCase().includes('bookmark')) {
            return 'An error occurred while managing bookmarks. Please try again.';
        }
        return 'An unexpected error occurred. Please check the output panel for details.';
    }

    async handleAsync<T>(
        operation: () => Promise<T>,
        context: ErrorContext
    ): Promise<T | undefined> {
        try {
            this.debug(`Starting operation: ${context.operation}`, context);
            const result = await operation();
            this.debug(`Operation completed successfully: ${context.operation}`, context);
            return result;
        } catch (error) {
            this.error(
                `Operation failed: ${context.operation}`,
                error instanceof Error ? error : new Error(String(error)),
                context
            );
            return undefined;
        }
    }

    handleSync<T>(
        operation: () => T,
        context: ErrorContext
    ): T | undefined {
        try {
            this.debug(`Starting operation: ${context.operation}`, context);
            const result = operation();
            this.debug(`Operation completed successfully: ${context.operation}`, context);
            return result;
        } catch (error) {
            this.error(
                `Operation failed: ${context.operation}`,
                error instanceof Error ? error : new Error(String(error)),
                context
            );
            return undefined;
        }
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}

// Export a singleton instance for convenience
export const errorHandler = ErrorHandler.getInstance();