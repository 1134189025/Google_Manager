import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import Pagination from '../components/Pagination';

const createProps = (overrides = {}) => ({
  currentPage: 1,
  totalPages: 10,
  totalItems: 1000,
  pageSize: 100,
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
  hasNextPage: true,
  hasPrevPage: false,
  ...overrides,
});

describe('Pagination 组件', () => {
  it('在首页和末页正确禁用导航按钮', () => {
    const { rerender } = render(<Pagination {...createProps()} />);

    expect(screen.getByTitle('首页')).toBeDisabled();
    expect(screen.getByTitle('上一页')).toBeDisabled();
    expect(screen.getByTitle('下一页')).not.toBeDisabled();
    expect(screen.getByTitle('末页')).not.toBeDisabled();

    rerender(
      <Pagination
        {...createProps({
          currentPage: 10,
          totalPages: 10,
          hasPrevPage: true,
          hasNextPage: false,
        })}
      />
    );

    expect(screen.getByTitle('首页')).not.toBeDisabled();
    expect(screen.getByTitle('上一页')).not.toBeDisabled();
    expect(screen.getByTitle('下一页')).toBeDisabled();
    expect(screen.getByTitle('末页')).toBeDisabled();
  });

  it('首页/上一页/下一页/末页和页码按钮会触发正确跳转', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();

    render(
      <Pagination
        {...createProps({
          currentPage: 5,
          totalPages: 10,
          hasPrevPage: true,
          hasNextPage: true,
          onPageChange,
        })}
      />
    );

    await user.click(screen.getByTitle('首页'));
    await user.click(screen.getByTitle('上一页'));
    await user.click(screen.getByRole('button', { name: '6' }));
    await user.click(screen.getByTitle('下一页'));
    await user.click(screen.getByTitle('末页'));

    expect(onPageChange.mock.calls.map(([page]) => page)).toEqual([1, 4, 6, 6, 10]);
  });

  it('页数较多时显示省略号，并支持切换每页条数', async () => {
    const user = userEvent.setup();
    const onPageSizeChange = vi.fn();

    render(
      <Pagination
        {...createProps({
          currentPage: 5,
          totalPages: 10,
          hasPrevPage: true,
          hasNextPage: true,
          onPageSizeChange,
        })}
      />
    );

    expect(screen.getAllByText('...')).toHaveLength(2);

    await user.selectOptions(screen.getByRole('combobox'), '200');

    expect(onPageSizeChange).toHaveBeenCalledWith(200);
  });
});
