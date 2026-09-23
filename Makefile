.PHONY: help install dev build check test frontend-build

# Default target
.DEFAULT_GOAL := help

CYAN := \033[0;36m
GREEN := \033[0;32m
RESET := \033[0m

help: ## Display this help message
	@echo "$(CYAN)Google Manager（自用桌面版） - Available Commands$(RESET)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-15s$(RESET) %s\n", $$1, $$2}'
	@echo ""

install: ## Install frontend dependencies
	@echo "$(CYAN)Installing frontend dependencies...$(RESET)"
	cd frontend && pnpm install
	@echo "$(GREEN)Installation complete!$(RESET)"

dev: ## Start Tauri development mode
	@echo "$(CYAN)Starting Tauri dev mode...$(RESET)"
	cd src-tauri && cargo tauri dev

build: ## Build the desktop app (installer + exe)
	@echo "$(CYAN)Building desktop app...$(RESET)"
	cd src-tauri && cargo tauri build
	@echo "$(GREEN)Build complete!$(RESET)"

frontend-build: ## Build frontend only
	cd frontend && pnpm run build

check: ## Rust compile check
	cd src-tauri && cargo check --all-targets

test: ## Run all unit tests
	@echo "$(CYAN)Running frontend tests...$(RESET)"
	cd frontend && pnpm test -- --run
	@echo "$(CYAN)Running Rust tests...$(RESET)"
	cd src-tauri && cargo test

clean: ## Clean build artifacts
	rm -rf frontend/node_modules
	rm -rf frontend/dist
