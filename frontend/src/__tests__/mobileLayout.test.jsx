import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import HistoryDrawer from '../components/HistoryDrawer';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    getAccounts: vi.fn(),
    getAccountHistory: vi.fn(),
  },
}));

vi.mock('../services/api', () => ({
  default: mockApi,
}));

vi.mock('../components/AccountListView', () => ({
  default: () => <div data-testid="account-list-view">账号列表内容</div>,
}));

vi.mock('../components/ImportView', () => ({
  default: () => <div data-testid="import-view">导入页内容</div>,
}));

vi.mock('../components/EditModal', () => ({
  default: () => null,
}));

describe('布局回归', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockApi.getAccounts.mockResolvedValue([]);
    mockApi.getAccountHistory.mockResolvedValue({ success: true, data: [] });
  });

  it('App 使用左侧胶囊导航承载视图切换，并保留版本信息', async () => {
    const { container } = render(<App />);

    await screen.findByRole('button', { name: '账号列表' });

    // 左侧胶囊导航存在，且不再是旧的顶栏结构
    const sideNav = container.querySelector('aside.side-nav');
    expect(sideNav).not.toBeNull();
    expect(container.querySelector('nav')).toBeNull();

    // 两个视图切换按钮
    expect(screen.getByRole('button', { name: '账号列表' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导入账号' })).toBeInTheDocument();

    // 暗色切换按钮
    expect(screen.getByRole('button', { name: '切换暗色模式' })).toBeInTheDocument();

    // 版本信息移动到侧栏底部
    const version = container.querySelector('.side-nav-version');
    expect(version).not.toBeNull();
    expect(version.textContent).toContain('版本');
    expect(version.textContent).toContain('编译');
  });

  it('点击暗色切换会把主题写到 <html data-theme> 与 localStorage', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    const { container } = render(<App />);

    await screen.findByRole('button', { name: '账号列表' });
    expect(document.documentElement.dataset.theme).toBe('light');

    await user.click(screen.getByRole('button', { name: '切换暗色模式' }));

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark');
    });
    expect(localStorage.getItem('darkMode')).toBe('true');
    expect(container.querySelector('aside.side-nav')).not.toBeNull();
  });

  it('HistoryDrawer 保持全宽并限制最大宽度 420px', async () => {
    const { container } = render(
      <HistoryDrawer
        isOpen={true}
        onClose={vi.fn()}
        account={{ id: 1, email: 'mobile-test@gmail.com' }}
      />
    );

    await waitFor(() => {
      expect(mockApi.getAccountHistory).toHaveBeenCalledWith(1);
    });

    const drawerPanel = container.querySelector('div.fixed.right-0.top-0.h-full');
    expect(drawerPanel).not.toBeNull();
    expect(drawerPanel).toHaveClass('w-full');
    expect(drawerPanel).toHaveClass('max-w-[420px]');
    expect(drawerPanel.className).toContain('sm:w-[420px]');
  });
});
