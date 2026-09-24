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
