# Bookmarker VS Code Extension - Simple Build
.PHONY: help build install clean

# Default target
help: ## Show available commands
	@echo "VS Code Extension Build Commands:"
	@echo "================================"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-12s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: ## Compile and package extension to .vsix file
	@echo "🏗️  Building extension..."
	npm run vscode:prepublish
	npx @vscode/vsce package
	@echo "✅ Extension built successfully"
	@ls -la *.vsix

install: build ## Build and install extension to VS Code
	@echo "🔧 Installing extension..."
	@VSIX_FILE=$$(ls *.vsix 2>/dev/null | head -1); \
	if [ -n "$$VSIX_FILE" ]; then \
		code --install-extension "$$VSIX_FILE" --force; \
		echo "✅ Extension installed: $$VSIX_FILE"; \
	else \
		echo "❌ No .vsix file found"; \
		exit 1; \
	fi

clean: ## Remove build artifacts
	@echo "🧹 Cleaning..."
	rm -f *.vsix
	rm -rf dist out
	@echo "✅ Clean completed"