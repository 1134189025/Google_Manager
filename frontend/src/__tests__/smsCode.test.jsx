import { render, screen, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import useSmsCodes from '../hooks/useSmsCodes';
import SmsCodeCell from '../components/SmsCodeCell';
import AccountTable from '../components/AccountTable';

const SAMPLE_URL = 'https://sms6688.com/api/sms/recordText?token=a1b2c3d4e5f60718293a4b5c6d7e8f90&tpl=1';

const buildAccount = (overrides = {}) => ({
    id: 1,
    email: 'test@gmail.com',
    password: 'pass',
    recovery: null,
    phone: '+12025550123',
    secret: null,
    smsUrl: SAMPLE_URL,
    regYear: null,
    country: null,
    groupName: null,
    remark: null,
    status: 'inactive',
    createdAt: '2024-01-01 00:00:00',
    updatedAt: '2024-01-01 00:00:00',
    ...overrides,
});

const successPayload = (code) => ({
    success: true,
    data: {
        status: 'success',
        code,
        message: null,
        error: null,
        retryAfterSeconds: null,
        fetchedAt: '2024-01-01T00:00:00.000Z',
    },
});

describe('useSmsCodes 轮询 Hook', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('只为配置了接码地址的账号请求验证码', async () => {
        const fetcher = vi.fn().mockResolvedValue(successPayload('821371'));
        const accounts = [
            buildAccount({ id: 1 }),
            buildAccount({ id: 2, smsUrl: '' }),
        ];

        const { result } = renderHook(() => useSmsCodes({ accounts, fetchSmsCode: fetcher }));

        await act(async () => {
            await Promise.resolve();
        });

        expect(fetcher).toHaveBeenCalledWith(1);
        expect(fetcher).not.toHaveBeenCalledWith(2);

        await waitFor(() => {
            expect(result.current.smsCodes[1]?.code).toBe('821371');
        });
        expect(result.current.smsCodes[2]).toBeUndefined();
    });

    it('取到验证码后展示状态与倒计时，并保留前导零', async () => {
        const fetcher = vi.fn().mockResolvedValue(successPayload('004512'));
        const accounts = [buildAccount({ id: 7 })];

        const { result } = renderHook(() => useSmsCodes({ accounts, fetchSmsCode: fetcher }));

        await waitFor(() => {
            expect(result.current.smsCodes[7]?.code).toBe('004512');
        });
        expect(result.current.smsCodes[7]?.status).toBe('success');
        expect(result.current.smsCodes[7]?.loading).toBe(false);
    });

    it('链接失效时暂停自动重试，手动刷新可解除', async () => {
        const fetcher = vi.fn().mockResolvedValue({
            success: true,
            data: {
                status: 'invalid_link',
                code: null,
                message: '已失效，请获取最新链接',
                error: null,
                retryAfterSeconds: null,
                fetchedAt: '2024-01-01T00:00:00.000Z',
            },
        });
        const accounts = [buildAccount({ id: 3 })];

        const { result } = renderHook(() => useSmsCodes({ accounts, fetchSmsCode: fetcher }));

        await waitFor(() => {
            expect(result.current.smsCodes[3]?.status).toBe('invalid_link');
        });
        expect(result.current.smsCodes[3]?.autoPaused).toBe(true);

        const callsAfterFirst = fetcher.mock.calls.length;
        // 链接失效后不应继续自动请求
        await act(async () => {
            await vi.advanceTimersByTimeAsync(6500);
        });
        expect(fetcher.mock.calls.length).toBe(callsAfterFirst);

        // 手动刷新会再试一次
        await act(async () => {
            await result.current.refresh(3);
        });
        expect(fetcher.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    });

    it('请求失败时保留旧验证码并标记为「上次」', async () => {
        const fetcher = vi.fn()
            .mockResolvedValueOnce(successPayload('821371'))
            .mockRejectedValueOnce(new Error('网络请求超时'));
        const accounts = [buildAccount({ id: 4 })];

        const { result } = renderHook(() => useSmsCodes({ accounts, fetchSmsCode: fetcher }));

        await waitFor(() => {
            expect(result.current.smsCodes[4]?.code).toBe('821371');
        });

        // 等待下一次自动刷新并失败
        await act(async () => {
            await vi.advanceTimersByTimeAsync(6000);
        });

        await waitFor(() => {
            expect(result.current.smsCodes[4]?.status).toBe('error');
        });
        expect(result.current.smsCodes[4]?.code).toBe('821371');
        expect(result.current.smsCodes[4]?.stale).toBe(true);
    });

    it('翻页后旧页账号的运行时状态被清理', async () => {
        const fetcher = vi.fn().mockResolvedValue(successPayload('821371'));
        const firstPage = [buildAccount({ id: 5 })];

        const { result, rerender } = renderHook(
            ({ accounts }) => useSmsCodes({ accounts, fetchSmsCode: fetcher }),
            { initialProps: { accounts: firstPage } }
        );

        await waitFor(() => {
            expect(result.current.smsCodes[5]?.code).toBe('821371');
        });

        // 切换到另一页（不包含账号 5）
        rerender({ accounts: [buildAccount({ id: 6 })] });

        await waitFor(() => {
            expect(result.current.smsCodes[5]).toBeUndefined();
        });
    });

    it('切换接码地址后不沿用旧链接的验证码', async () => {
        const fetcher = vi.fn()
            .mockResolvedValueOnce(successPayload('821371'))
            .mockResolvedValueOnce({
                success: true,
                data: {
                    status: 'empty',
                    code: null,
                    message: '暂无短信',
                    error: null,
                    retryAfterSeconds: null,
                    fetchedAt: '2024-01-01T00:00:05.000Z',
                },
            });

        const { result, rerender } = renderHook(
            ({ accounts }) => useSmsCodes({ accounts, fetchSmsCode: fetcher }),
            { initialProps: { accounts: [buildAccount({ id: 8 })] } }
        );

        await waitFor(() => {
            expect(result.current.smsCodes[8]?.code).toBe('821371');
        });

        // 换成另一个接码地址：旧验证码必须立即失效
        rerender({
            accounts: [buildAccount({ id: 8, smsUrl: `${SAMPLE_URL}&x=2` })],
        });

        await waitFor(() => {
            expect(result.current.smsCodes[8]?.code).toBeNull();
        });
    });

    it('页面隐藏时暂停请求，恢复可见后继续', async () => {
        const fetcher = vi.fn().mockResolvedValue(successPayload('821371'));
        const accounts = [buildAccount({ id: 9 })];

        renderHook(() => useSmsCodes({ accounts, fetchSmsCode: fetcher }));

        await waitFor(() => {
            expect(fetcher).toHaveBeenCalled();
        });

        const hiddenState = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
        });

        const callsWhenHidden = fetcher.mock.calls.length;
        await act(async () => {
            await vi.advanceTimersByTimeAsync(8000);
        });
        expect(fetcher.mock.calls.length).toBe(callsWhenHidden);

        hiddenState.mockReturnValue('visible');
        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await waitFor(() => {
            expect(fetcher.mock.calls.length).toBeGreaterThan(callsWhenHidden);
        });

        hiddenState.mockRestore();
    });
});

describe('SmsCodeCell 单元格', () => {
    it('未配置接码地址时显示未配置，且不展示任何地址', () => {
        render(
            <SmsCodeCell
                account={buildAccount()}
                entry={undefined}
                host=""
                hasUrl={false}
                onCopy={vi.fn()}
                onEdit={vi.fn()}
                onRefresh={vi.fn()}
            />
        );

        expect(screen.getByText('未配置')).toBeInTheDocument();
        expect(screen.queryByText(/token=/)).not.toBeInTheDocument();
    });

    it('取到验证码时点击只复制验证码本身', () => {
        const onCopy = vi.fn();
        render(
            <SmsCodeCell
                account={buildAccount()}
                entry={{ status: 'success', code: '821371', secondsLeft: 5, loading: false, stale: false }}
                host="sms6688.com"
                hasUrl
                onCopy={onCopy}
                onEdit={vi.fn()}
                onRefresh={vi.fn()}
            />
        );

        screen.getByText('821371').closest('button').click();
        expect(onCopy).toHaveBeenCalledWith('821371', '手机验证码', { stale: false });
    });

    it('失败后保留的旧验证码标注「上次」', () => {
        render(
            <SmsCodeCell
                account={buildAccount()}
                entry={{
                    status: 'error',
                    code: '821371',
                    error: '网络请求超时',
                    secondsLeft: 10,
                    loading: false,
                    stale: true,
                }}
                host="sms6688.com"
                hasUrl
                onCopy={vi.fn()}
                onEdit={vi.fn()}
                onRefresh={vi.fn()}
            />
        );

        expect(screen.getByText('821371')).toBeInTheDocument();
        expect(screen.getByText('上次')).toBeInTheDocument();
    });

    it('暂无短信时显示等待短信而不是验证码', () => {
        render(
            <SmsCodeCell
                account={buildAccount()}
                entry={{ status: 'empty', code: null, message: '暂无短信', secondsLeft: 5, loading: false, stale: false }}
                host="sms6688.com"
                hasUrl
                onCopy={vi.fn()}
                onEdit={vi.fn()}
                onRefresh={vi.fn()}
            />
        );

        expect(screen.getByText('等待短信')).toBeInTheDocument();
    });

    it('链接失效时给出明确提示', () => {
        render(
            <SmsCodeCell
                account={buildAccount()}
                entry={{ status: 'invalid_link', code: null, autoPaused: true, secondsLeft: 0, loading: false, stale: false }}
                host="sms6688.com"
                hasUrl
                onCopy={vi.fn()}
                onEdit={vi.fn()}
                onRefresh={vi.fn()}
            />
        );

        expect(screen.getByText('链接失效')).toBeInTheDocument();
    });
});

describe('AccountTable 手机验证码列位置', () => {
    const pagination = { currentPage: 1, pageSize: 100, totalItems: 1, totalPages: 1 };

    it('列顺序为 2FA → 手机 → 手机验证码 → 标签', () => {
        render(
            <AccountTable
                paginatedData={[buildAccount()]}
                pagination={pagination}
                loading={false}
                sortConfig={{ key: null, direction: null }}
                onSortChange={vi.fn()}
                selectedIds={new Set()}
                onToggleSelectAll={vi.fn()}
                onToggleCheckbox={vi.fn()}
                onRowMouseDown={vi.fn()}
                onRowMouseEnter={vi.fn()}
                editingCell={null}
                editValue=""
                setEditValue={vi.fn()}
                inputRef={{ current: null }}
                showSuggestions={false}
                filteredSuggestions={[]}
                onCellClick={vi.fn()}
                onCellDoubleClick={vi.fn()}
                onEditableInputBlur={vi.fn()}
                onKeyDown={vi.fn()}
                onSelectSuggestion={vi.fn()}
                toggleStatus={vi.fn()}
                onEdit={vi.fn()}
                onDelete={vi.fn()}
                copyToClipboard={vi.fn()}
                copyAllInfo={vi.fn()}
                copyPhoneWithSmsUrl={vi.fn()}
                openHistoryDrawer={vi.fn()}
                twoFACodes={{}}
                smsCodes={{}}
                onSmsRefresh={vi.fn()}
                onSmsCopy={vi.fn()}
            />
        );

        const headers = screen.getAllByRole('columnheader').map(th => th.textContent);
        const headerText = headers.join('|');

        expect(headerText).toContain('2FA');
        expect(headerText).toContain('手机');
        expect(headerText).toContain('手机验证码');
        expect(headerText).toContain('标签');

        // 手机验证码必须紧跟在「手机」之后、且在「标签」之前
        const phoneIndex = headers.findIndex(text => text.trim().startsWith('手机') && !text.includes('验证码'));
        const smsIndex = headers.findIndex(text => text.includes('手机验证码'));
        const tagIndex = headers.findIndex(text => text.trim().startsWith('标签'));

        expect(phoneIndex).toBeGreaterThan(-1);
        expect(smsIndex).toBe(phoneIndex + 1);
        expect(tagIndex).toBe(smsIndex + 1);
    });
});
