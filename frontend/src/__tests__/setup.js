import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// 模拟 Tauri 2 总会注入的内部对象（isTauriRuntime 据此判断桌面环境）
window.__TAURI_INTERNALS__ = {
  invoke: vi.fn(),
};

// 在线更新插件：默认「没有新版本」，需要时在用例里覆盖
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn().mockResolvedValue(null),
}));
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn().mockResolvedValue(undefined),
}));
