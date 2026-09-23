import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import EditModal from '../components/EditModal';

const SAMPLE_URL = 'https://sms6688.com/api/sms/recordText?token=a1b2c3d4e5f60718293a4b5c6d7e8f90&tpl=1';
const COMBINED = `12025550123|${SAMPLE_URL}`;

const buildAccount = (overrides = {}) => ({
    id: 1,
    email: 'test@gmail.com',
    password: 'pass',
    recovery: '',
    phone: '',
    secret: '',
    smsUrl: '',
    regYear: '',
    country: '',
    groupName: '',
    remark: '',
    ...overrides,
});

/**
 * 单账号编辑界面：用户直接粘贴 `手机号|接码地址` 整串时必须自动拆分，
 * 这是「在单独账号编辑界面粘贴进去」这条路径的核心行为。
 */
describe('EditModal 手机接码地址', () => {
    let onSubmit;

    beforeEach(() => {
        onSubmit = vi.fn((event) => event?.preventDefault?.());
    });

    it('粘贴整串时自动拆到手机号与接码地址两个输入框', () => {
        render(<EditModal account={buildAccount()} onClose={vi.fn()} onSubmit={onSubmit} />);

        const phoneInput = screen.getByPlaceholderText(/或直接粘贴/);
        const smsInput = screen.getByPlaceholderText(/recordText/);

        fireEvent.paste(phoneInput, {
            clipboardData: { getData: () => COMBINED },
        });

        expect(phoneInput.value).toBe('+12025550123');
        // 完整地址（含 token 与 tpl）必须原样保留
        expect(smsInput.value).toBe(SAMPLE_URL);
    });

    it('粘贴到接码地址输入框同样能拆分', () => {
        render(<EditModal account={buildAccount()} onClose={vi.fn()} onSubmit={onSubmit} />);

        const phoneInput = screen.getByPlaceholderText(/或直接粘贴/);
        const smsInput = screen.getByPlaceholderText(/recordText/);

        fireEvent.paste(smsInput, {
            clipboardData: { getData: () => COMBINED },
        });

        expect(phoneInput.value).toBe('+12025550123');
        expect(smsInput.value).toBe(SAMPLE_URL);
    });

    it('只粘贴单独的接码地址时不影响手机号', () => {
        render(
            <EditModal
                account={buildAccount({ phone: '+8613812345678' })}
                onClose={vi.fn()}
                onSubmit={onSubmit}
            />
        );

        const phoneInput = screen.getByPlaceholderText(/或直接粘贴/);
        const smsInput = screen.getByPlaceholderText(/recordText/);

        fireEvent.paste(smsInput, {
            clipboardData: { getData: () => SAMPLE_URL },
        });

        expect(smsInput.value).toBe(SAMPLE_URL);
        expect(phoneInput.value).toBe('+8613812345678');
    });

    it('已保存的接码地址会回填到输入框', () => {
        render(
            <EditModal
                account={buildAccount({ phone: '+12025550123', smsUrl: SAMPLE_URL })}
                onClose={vi.fn()}
                onSubmit={onSubmit}
            />
        );

        expect(screen.getByPlaceholderText(/recordText/).value).toBe(SAMPLE_URL);
    });

    it('提交时把接码地址规范化为 https 地址', () => {
        render(<EditModal account={buildAccount()} onClose={vi.fn()} onSubmit={onSubmit} />);

        const smsInput = screen.getByPlaceholderText(/recordText/);
        fireEvent.change(smsInput, { target: { value: SAMPLE_URL } });
        fireEvent.click(screen.getByRole('button', { name: '确认保存' }));

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(smsInput.value).toBe(SAMPLE_URL);
    });

    it('非法接码地址阻止提交并提示', () => {
        render(<EditModal account={buildAccount()} onClose={vi.fn()} onSubmit={onSubmit} />);

        const smsInput = screen.getByPlaceholderText(/recordText/);
        fireEvent.change(smsInput, { target: { value: 'http://sms6688.com/x?t=1' } });
        fireEvent.click(screen.getByRole('button', { name: '确认保存' }));

        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.getByText('接码地址必须是 https 链接')).toBeInTheDocument();
    });

    it('清空接码地址允许提交（用于解除绑定）', () => {
        render(
            <EditModal
                account={buildAccount({ smsUrl: SAMPLE_URL })}
                onClose={vi.fn()}
                onSubmit={onSubmit}
            />
        );

        const smsInput = screen.getByPlaceholderText(/recordText/);
        fireEvent.change(smsInput, { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: '确认保存' }));

        expect(onSubmit).toHaveBeenCalledTimes(1);
    });
});
