import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HistoryDrawer from '../components/HistoryDrawer';
import api from '../services/api';
import { formatDbTimestamp } from '../utils/timeUtils';

vi.mock('../services/api', () => ({
    default: {
        getAccountHistory: vi.fn(),
    },
}));

const record = (id, fieldName, oldValue, newValue, changedAt = '2026-01-01 16:30:05') => ({
    id,
    accountId: 1,
    fieldName,
    oldValue,
    newValue,
    changedAt,
});

describe('HistoryDrawer 修改历史', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('显示后端实际追踪的字段（邮箱、状态等），并跳过已下线字段', async () => {
        api.getAccountHistory.mockResolvedValue({
            success: true,
            data: [
                record(1, 'email', 'old@gmail.com', 'new@gmail.com'),
                record(2, 'status', 'inactive', 'pro'),
                record(3, 'remark', null, '备用机'),
                record(4, 'sold_status', 'unsold', 'sold'),
            ],
        });

        render(<HistoryDrawer isOpen onClose={vi.fn()} account={{ id: 1, email: 'new@gmail.com' }} />);

        expect(await screen.findByText('邮箱修改记录')).toBeInTheDocument();
        expect(screen.getByText('状态修改记录')).toBeInTheDocument();
        expect(screen.getByText('备注修改记录')).toBeInTheDocument();
        expect(screen.getByText('old@gmail.com')).toBeInTheDocument();
        // status 按表格里的叫法显示
        expect(screen.getByText('普通')).toBeInTheDocument();
        expect(screen.getByText('Pro')).toBeInTheDocument();
        expect(screen.queryByText('sold')).not.toBeInTheDocument();
        expect(screen.getByText('共 3 条修改记录')).toBeInTheDocument();
    });

    it('修改时间按本机时区显示', async () => {
        api.getAccountHistory.mockResolvedValue({
            success: true,
            data: [record(1, 'phone', '+8613800001111', '+8613800002222', '2026-01-01 16:30:05')],
        });

        render(<HistoryDrawer isOpen onClose={vi.fn()} account={{ id: 1, email: 'a@gmail.com' }} />);

        const [date, time] = formatDbTimestamp('2026-01-01 16:30:05').split(' ');
        expect(await screen.findByText(date)).toBeInTheDocument();
        expect(screen.getByText(time)).toBeInTheDocument();
    });
});
