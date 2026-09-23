import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExportDialog from '../components/ExportDialog';

const previewAccounts = [
  {
    id: 1,
    email: 'first@gmail.com',
    password: 'pass-1',
    recovery: 'recover-1@gmail.com',
    secret: 'SECRET-1',
    phone: '+8613800000000',
    regYear: '2024',
    country: 'CN',
    groupName: '组A',
    remark: '第一条',
    status: 'pro',
  },
];

const createProps = (overrides = {}) => ({
  isOpen: true,
  onClose: vi.fn(),
  onExport: vi.fn(),
  exportMode: 'filtered',
  exportScopeCounts: { all: 1, filtered: 1, selected: 0 },
  previewAccounts,
  ...overrides,
});

const setViewport = (width) => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  window.dispatchEvent(new Event('resize'));
};

describe('ExportDialog 窄屏交互', () => {
  afterEach(() => {
    setViewport(1024);
  });

  it('窄屏下保留滚动容器、单列分隔符布局和底部操作区', () => {
    setViewport(375);
    render(<ExportDialog {...createProps()} />);

    const heading = screen.getByRole('heading', { name: '导出账号配置' });
    const panel = heading.parentElement?.parentElement?.parentElement;
    const separatorGrid = screen.getByText('四横线 (----)').closest('button')?.parentElement;
    const footer = screen.getByRole('button', { name: '导出' }).parentElement;

    expect(panel).toHaveClass('w-full', 'max-w-2xl', 'max-h-[90vh]', 'overflow-y-auto');
    expect(separatorGrid).toHaveClass('grid-cols-1', 'sm:grid-cols-2');
    expect(footer).toHaveClass('flex-col-reverse', 'sm:flex-row');
    expect(screen.getByRole('button', { name: '取消' })).toHaveClass('w-full', 'sm:w-auto');
    expect(screen.getByRole('button', { name: '导出' })).toHaveClass('w-full', 'sm:w-auto');
  });

  it('窄屏下仍可关闭弹窗并提交自定义导出配置', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onExport = vi.fn();

    setViewport(375);
    render(<ExportDialog {...createProps({ onClose, onExport })} />);

    await user.click(screen.getByRole('button', { name: '关闭导出配置' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByText('自定义').closest('button'));
    await user.type(screen.getByPlaceholderText('输入自定义分隔符'), '|#|');
    await user.click(screen.getByRole('button', { name: '导出' }));

    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({
      separator: '|#|',
    }));
  });

  it('导出配置里不再提供「出售状态」字段', () => {
    setViewport(1024);
    render(<ExportDialog {...createProps()} />);

    expect(screen.queryByText('出售状态')).not.toBeInTheDocument();
  });
});
