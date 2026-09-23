// frontend/src/services/adapters/index.ts

import type { ApiAdapter } from '../types';
import { TauriAdapter } from './tauri-adapter';

// 单例适配器实例
let adapterInstance: ApiAdapter | null = null;

/**
 * 获取 API 适配器
 *
 * 自用桌面版只有一种运行形态：Tauri 桌面进程内通过 invoke 调用 Rust 命令。
 */
export const getAdapter = (): ApiAdapter => {
  if (adapterInstance) {
    return adapterInstance;
  }

  adapterInstance = new TauriAdapter();
  return adapterInstance;
};

/**
 * 重置适配器实例（用于测试）
 */
export const resetAdapter = (): void => {
  adapterInstance = null;
};

/**
 * 设置自定义适配器（用于测试）
 */
export const setAdapter = (adapter: ApiAdapter): void => {
  adapterInstance = adapter;
};

// 导出适配器类以便直接使用
export { TauriAdapter } from './tauri-adapter';
export type { ApiAdapter } from '../types';
