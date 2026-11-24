import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import HistoryDrawer from '../components/HistoryDrawer';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    getAccounts: vi.fn(),
    getAccountHistory: vi.fn(),
    getBrowserStatuses: vi.fn(),
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
    mockApi.getBrowserStatuses.mockResolvedValue({ success: true, data: {} });
  });

  it('App 使用悬浮圆角侧栏导航承载视图切换，默认进入首页并保留版本信息', async () => {
    const { container } = render(<App />);

    await screen.findByRole('button', { name: '首页' });

    const sideNav = container.querySelector('aside.side-nav');
    expect(sideNav).not.toBeNull();

    // 主导航与系统分区按钮
    expect(screen.getByRole('button', { name: '首页' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /账号列表/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导入账号' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回收站' })).toBeInTheDocument();
    expect(screen.getByTitle('账号浏览器设置')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '检查更新' })).toBeInTheDocument();

    // 暗黑优先：默认处于暗色模式，提供「切换亮色模式」按钮
    expect(screen.getByRole('button', { name: '切换亮色模式' })).toBeInTheDocument();

    // 版本信息显示在侧栏底部，悬停提示含完整版本与编译时间
    const version = container.querySelector('.side-nav-version');
    expect(version).not.toBeNull();
    expect(version.getAttribute('title')).toContain('版本');
    expect(version.getAttribute('title')).toContain('编译');
  });

  it('默认暗色并在点击对比度按钮时切换为亮色，写入 <html data-theme> 与 localStorage', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    const { container } = render(<App />);

    await screen.findByRole('button', { name: '切换亮色模式' });
    expect(document.documentElement.dataset.theme).toBe('dark');

    await user.click(screen.getByRole('button', { name: '切换亮色模式' }));

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('light');
    });
    expect(localStorage.getItem('darkMode')).toBe('false');
    expect(screen.getByRole('button', { name: '切换暗色模式' })).toBeInTheDocument();
    expect(container.querySelector('aside.side-nav')).not.toBeNull();
  });

  it('HistoryDrawer 保持全宽并限制最大宽度 420px', async () => {
    render(
      <HistoryDrawer
        isOpen={true}
        onClose={vi.fn()}
        account={{ id: 1, email: 'mobile-test@gmail.com' }}
      />
    );

    await waitFor(() => {
      expect(mockApi.getAccountHistory).toHaveBeenCalledWith(1);
    });

    // 抽屉渲染在 body 下（避免祖先 transform 影响 fixed 定位），从整个文档查找
    const drawerPanel = document.body.querySelector('div.fixed.right-0.top-0.h-full');
    expect(drawerPanel).not.toBeNull();
    expect(drawerPanel.parentElement).toBe(document.body);
    expect(drawerPanel).toHaveClass('w-full');
    expect(drawerPanel).toHaveClass('max-w-[420px]');
    expect(drawerPanel.className).toContain('sm:w-[420px]');
  });

  it('拦截非编辑区的网页默认右键菜单与 F5/Ctrl+R 刷新，保留输入框右键复制粘贴', async () => {
    const { container } = render(<App />);
    await screen.findByRole('button', { name: '首页' });

    const main = container.querySelector('main.main-wrapper');
    const blockedEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    main.dispatchEvent(blockedEvent);
    expect(blockedEvent.defaultPrevented).toBe(true);

    const input = document.createElement('input');
    main.appendChild(input);
    const allowedEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    input.dispatchEvent(allowedEvent);
    expect(allowedEvent.defaultPrevented).toBe(false);
    main.removeChild(input);

    const f5Event = new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true });
    window.dispatchEvent(f5Event);
    expect(f5Event.defaultPrevented).toBe(true);
    expect(fireEvent.keyDown(window, { key: 'r', ctrlKey: true })).toBe(false);
  });
});
