import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ImportView from '../components/ImportView';

describe('ImportView 组件', () => {
  const mockOnImport = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('基础渲染', () => {
    it('渲染导入表单标题和说明', () => {
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      expect(screen.getByText('导入账号')).toBeInTheDocument();
      expect(screen.getByText('导入后状态默认设为"未开启"')).toBeInTheDocument();
    });

    it('默认显示单个导入模式', () => {
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      const singleTab = screen.getByRole('button', { name: /单个导入/i });
      expect(singleTab).toHaveClass('active');
      expect(screen.getByText('单个账号信息')).toBeInTheDocument();
    });

    it('显示切换标签', () => {
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      expect(screen.getByRole('button', { name: /单个导入/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /批量导入/i })).toBeInTheDocument();
    });
  });

  describe('单个导入模式', () => {
    it('渲染所有表单字段', () => {
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      expect(screen.getByPlaceholderText('example@gmail.com')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('输入密码')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('recovery@example.com')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('默认+86，可填 +12192731268')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('TOTP密钥')).toBeInTheDocument();
    });

    it('单个导入显示与批量一致的行格式参考', () => {
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      expect(screen.getByText('行格式参考（与批量解析一致）')).toBeInTheDocument();
      expect(screen.getByText(/邮箱----密码----恢复邮箱----2FA密钥/)).toBeInTheDocument();
      expect(screen.getByText(/邮箱\|密码\|恢复邮箱\|2FA密钥/)).toBeInTheDocument();
      expect(screen.getByText(/卡号：邮箱密码：密码----2FA密钥/)).toBeInTheDocument();
      expect(screen.getByText(/尾字段会自动识别手机号（默认\+86）/)).toBeInTheDocument();
    });

    it('显示必填标记', () => {
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      const requiredMarks = screen.getAllByText('*');
      expect(requiredMarks).toHaveLength(2); // 邮箱和密码
    });

    it('填写邮箱和密码', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      const emailInput = screen.getByPlaceholderText('example@gmail.com');
      const passwordInput = screen.getByPlaceholderText('输入密码');

      await user.type(emailInput, 'newaccount@gmail.com');
      await user.type(passwordInput, 'password123');

      expect(emailInput).toHaveValue('newaccount@gmail.com');
      expect(passwordInput).toHaveValue('password123');
    });

    it('填写可选字段', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      const recoveryInput = screen.getByPlaceholderText('recovery@example.com');
      const secretInput = screen.getByPlaceholderText('TOTP密钥');

      await user.type(recoveryInput, 'recovery@example.com');
      await user.type(secretInput, 'ABCD1234');

      expect(recoveryInput).toHaveValue('recovery@example.com');
      expect(secretInput).toHaveValue('ABCD1234');
    });

    it('实时预览显示等待状态', () => {
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      expect(screen.getByText('请填写账号信息')).toBeInTheDocument();
      expect(screen.getByText('邮箱和密码为必填项')).toBeInTheDocument();
      expect(screen.getByText('Status: WAITING')).toBeInTheDocument();
      expect(screen.getByText('Count: 0')).toBeInTheDocument();
    });

    it('填写必填项后实时预览更新', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      const emailInput = screen.getByPlaceholderText('example@gmail.com');
      const passwordInput = screen.getByPlaceholderText('输入密码');

      await user.type(emailInput, 'test@gmail.com');
      await user.type(passwordInput, 'password123');

      // 预览区域应该显示账号信息
      expect(screen.getByText('test@gmail.com')).toBeInTheDocument();
      expect(screen.getByText('Status: READY')).toBeInTheDocument();
      expect(screen.getByText('Count: 1')).toBeInTheDocument();
    });

    it('密码在预览中显示为圆点', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      const emailInput = screen.getByPlaceholderText('example@gmail.com');
      const passwordInput = screen.getByPlaceholderText('输入密码');

      await user.type(emailInput, 'test@gmail.com');
      await user.type(passwordInput, 'pass123');

      // 密码应该显示为7个圆点
      expect(screen.getByText('•'.repeat(7))).toBeInTheDocument();
    });

    it('未填写可选字段显示未设置', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      const emailInput = screen.getByPlaceholderText('example@gmail.com');
      const passwordInput = screen.getByPlaceholderText('输入密码');

      await user.type(emailInput, 'test@gmail.com');
      await user.type(passwordInput, 'password123');

      // 恢复邮箱、手机号、手机验证码、2FA密钥、注册年份和国家都显示"未设置"
      const notSetElements = screen.getAllByText('未设置');
      expect(notSetElements).toHaveLength(6);
    });

    it('填写2FA密钥后显示已设置', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      const emailInput = screen.getByPlaceholderText('example@gmail.com');
      const passwordInput = screen.getByPlaceholderText('输入密码');
      const secretInput = screen.getByPlaceholderText('TOTP密钥');

      await user.type(emailInput, 'test@gmail.com');
      await user.type(passwordInput, 'password123');
      await user.type(secretInput, 'ABCD1234');

      expect(screen.getByText('已设置')).toBeInTheDocument();
    });

    it('导入按钮初始禁用', () => {
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      const importButton = screen.getByRole('button', { name: /立即导入/i });
      expect(importButton).toBeDisabled();
    });

    it('填写必填项后导入按钮启用', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      const emailInput = screen.getByPlaceholderText('example@gmail.com');
      const passwordInput = screen.getByPlaceholderText('输入密码');

      await user.type(emailInput, 'test@gmail.com');
      await user.type(passwordInput, 'password123');

      const importButton = screen.getByRole('button', { name: /立即导入/i });
      expect(importButton).not.toBeDisabled();
    });

    it('点击导入按钮调用 onImport', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      const emailInput = screen.getByPlaceholderText('example@gmail.com');
      const passwordInput = screen.getByPlaceholderText('输入密码');

      await user.type(emailInput, 'test@gmail.com');
      await user.type(passwordInput, 'password123');

      const importButton = screen.getByRole('button', { name: /立即导入/i });
      await user.click(importButton);

      expect(mockOnImport).toHaveBeenCalledWith([{
        email: 'test@gmail.com',
        password: 'password123',
        recovery: '',
        phone: '',
        secret: '',
        sms_url: '',
        reg_year: '',
        country: '',
        group_name: '',
        remark: '',
      }]);
    });

    it('导入时自动去除2FA密钥中的空格', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      const emailInput = screen.getByPlaceholderText('example@gmail.com');
      const passwordInput = screen.getByPlaceholderText('输入密码');
      const secretInput = screen.getByPlaceholderText('TOTP密钥');

      await user.type(emailInput, 'test@gmail.com');
      await user.type(passwordInput, 'password123');
      await user.type(secretInput, 'ABCD 1234 EFGH 5678');

      const importButton = screen.getByRole('button', { name: /立即导入/i });
      await user.click(importButton);

      expect(mockOnImport).toHaveBeenCalledWith([{
        email: 'test@gmail.com',
        password: 'password123',
        recovery: '',
        phone: '',
        secret: 'ABCD1234EFGH5678',
        sms_url: '',
        reg_year: '',
        country: '',
        group_name: '',
        remark: '',
      }]);
    });

    it('导入包含所有字段的完整数据', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      await user.type(screen.getByPlaceholderText('example@gmail.com'), 'test@gmail.com');
      await user.type(screen.getByPlaceholderText('输入密码'), 'password123');
      await user.type(screen.getByPlaceholderText('recovery@example.com'), 'recovery@example.com');
      await user.type(screen.getByPlaceholderText('TOTP密钥'), 'ABCD1234');

      const importButton = screen.getByRole('button', { name: /立即导入/i });
      await user.click(importButton);

      expect(mockOnImport).toHaveBeenCalledWith([{
        email: 'test@gmail.com',
        password: 'password123',
        recovery: 'recovery@example.com',
        phone: '',
        secret: 'ABCD1234',
        sms_url: '',
        reg_year: '',
        country: '',
        group_name: '',
        remark: '',
      }]);
    });

    it('单个导入手机号默认补 +86，保留显式国家码', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      await user.type(screen.getByPlaceholderText('example@gmail.com'), 'phone-test@gmail.com');
      await user.type(screen.getByPlaceholderText('输入密码'), 'password123');
      await user.type(screen.getByPlaceholderText('默认+86，可填 +12192731268'), '13812345678');

      await user.click(screen.getByRole('button', { name: /立即导入/i }));
      expect(mockOnImport).toHaveBeenLastCalledWith([{
        email: 'phone-test@gmail.com',
        password: 'password123',
        recovery: '',
        phone: '+8613812345678',
        sms_url: '',
        secret: '',
        reg_year: '',
        country: '',
        group_name: '',
        remark: '',
      }]);

      vi.clearAllMocks();

      await user.clear(screen.getByPlaceholderText('example@gmail.com'));
      await user.clear(screen.getByPlaceholderText('输入密码'));
      await user.clear(screen.getByPlaceholderText('默认+86，可填 +12192731268'));

      await user.type(screen.getByPlaceholderText('example@gmail.com'), 'phone-intl@gmail.com');
      await user.type(screen.getByPlaceholderText('输入密码'), 'password123');
      await user.type(screen.getByPlaceholderText('默认+86，可填 +12192731268'), '+1 2192731268');

      await user.click(screen.getByRole('button', { name: /立即导入/i }));
      expect(mockOnImport).toHaveBeenLastCalledWith([{
        email: 'phone-intl@gmail.com',
        password: 'password123',
        recovery: '',
        phone: '+12192731268',
        secret: '',
        sms_url: '',
        reg_year: '',
        country: '',
        group_name: '',
        remark: '',
      }]);
    });
  });

  describe('批量导入模式', () => {
    it('切换到批量导入模式', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      const batchTab = screen.getByRole('button', { name: /批量导入/i });
      await user.click(batchTab);

      expect(batchTab).toHaveClass('active');
      expect(screen.getByText('粘贴数据区域')).toBeInTheDocument();
    });

    it('显示格式说明', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      await user.click(screen.getByRole('button', { name: /批量导入/i }));

      expect(screen.getByText(/支持多种格式/i)).toBeInTheDocument();
      expect(screen.getByText(/支持分隔符：\| ---- —— --- --/i)).toBeInTheDocument();
    });

    it('显示文本输入区域', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      await user.click(screen.getByRole('button', { name: /批量导入/i }));

      const textarea = screen.getByPlaceholderText(/示例：/i);
      expect(textarea).toBeInTheDocument();
    });

    it('初始状态预览区域为空', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      await user.click(screen.getByRole('button', { name: /批量导入/i }));

      expect(screen.getByText('等待解析数据...')).toBeInTheDocument();
      expect(screen.getByText('Count: 0')).toBeInTheDocument();
    });

    it('解析使用中文破折号的单行数据', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      await user.click(screen.getByRole('button', { name: /批量导入/i }));

      const textarea = screen.getByPlaceholderText(/示例：/i);
      await user.type(textarea, 'test@gmail.com——password123——recovery@example.com——ABCD1234');

      // 等待防抖完成
      expect(await screen.findByText('test@gmail.com')).toBeInTheDocument();
      expect(screen.getByText('Count: 1')).toBeInTheDocument();
    });

    it('解析使用四个横线的单行数据', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      await user.click(screen.getByRole('button', { name: /批量导入/i }));

      const textarea = screen.getByPlaceholderText(/示例：/i);
      await user.type(textarea, 'test@gmail.com----password123');

      expect(await screen.findByText('test@gmail.com')).toBeInTheDocument();
    });

    it('解析使用两个横线的单行数据', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      await user.click(screen.getByRole('button', { name: /批量导入/i }));

      const textarea = screen.getByPlaceholderText(/示例：/i);
      await user.type(textarea, 'test@gmail.com--password123');

      expect(await screen.findByText('test@gmail.com')).toBeInTheDocument();
    });

    it('解析多行数据', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      await user.click(screen.getByRole('button', { name: /批量导入/i }));

      const textarea = screen.getByPlaceholderText(/示例：/i);
      const multiLineData = 'test1@gmail.com——pass1\ntest2@gmail.com——pass2\ntest3@gmail.com——pass3';

      await user.type(textarea, multiLineData);

      expect(await screen.findByText('test1@gmail.com')).toBeInTheDocument();
      expect(screen.getByText('test2@gmail.com')).toBeInTheDocument();
      expect(screen.getByText('test3@gmail.com')).toBeInTheDocument();
      expect(screen.getByText('Count: 3')).toBeInTheDocument();
    });

    it('过滤空行', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      await user.click(screen.getByRole('button', { name: /批量导入/i }));

      const textarea = screen.getByPlaceholderText(/示例：/i);
      const dataWithEmptyLines = 'test1@gmail.com——pass1\n\n\ntest2@gmail.com——pass2\n\n';

      await user.type(textarea, dataWithEmptyLines);

      expect(await screen.findByText('Count: 2')).toBeInTheDocument();
    });

    it('批量导入按钮初始禁用', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      await user.click(screen.getByRole('button', { name: /批量导入/i }));

      const importButton = screen.getByRole('button', { name: /立即导入/i });
      expect(importButton).toBeDisabled();
    });

    it('有数据后批量导入按钮启用', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      await user.click(screen.getByRole('button', { name: /批量导入/i }));

      const textarea = screen.getByPlaceholderText(/示例：/i);
      await user.type(textarea, 'test@gmail.com——password123');

      // 等待防抖完成和按钮启用
      const importButton = await screen.findByRole('button', { name: /立即导入 \(1条\)/i });
      expect(importButton).not.toBeDisabled();
    });

    it('点击批量导入按钮调用 onImport', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      await user.click(screen.getByRole('button', { name: /批量导入/i }));

      const textarea = screen.getByPlaceholderText(/示例：/i);
      await user.type(textarea, 'test@gmail.com——password123——recovery@example.com——ABCD234567EFGH23');

      // 等待防抖完成
      const importButton = await screen.findByRole('button', { name: /立即导入 \(1条\)/i });
      await user.click(importButton);

      expect(mockOnImport).toHaveBeenCalledWith([{
        email: 'test@gmail.com',
        password: 'password123',
        recovery: 'recovery@example.com',
        phone: '',
        secret: 'ABCD234567EFGH23',
        sms_url: '',
        reg_year: '',
        country: '',
        group_name: '',
        remark: '',
      }]);
    });

    it('批量导入自动去除2FA密钥中的空格', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      await user.click(screen.getByRole('button', { name: /批量导入/i }));

      const textarea = screen.getByPlaceholderText(/示例：/i);
      await user.type(textarea, 'test@gmail.com——password123——recovery@example.com——ABCD 2345 67EF GH23');

      // 等待防抖完成
      const importButton = await screen.findByRole('button', { name: /立即导入 \(1条\)/i });
      await user.click(importButton);

      expect(mockOnImport).toHaveBeenCalledWith([{
        email: 'test@gmail.com',
        password: 'password123',
        recovery: 'recovery@example.com',
        phone: '',
        secret: 'ABCD234567EFGH23',
        sms_url: '',
        reg_year: '',
        country: '',
        group_name: '',
        remark: '',
      }]);
    });

    it('批量导入显示正确的条数', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      await user.click(screen.getByRole('button', { name: /批量导入/i }));

      const textarea = screen.getByPlaceholderText(/示例：/i);
      await user.type(textarea, 'test1@gmail.com——pass1\ntest2@gmail.com——pass2\ntest3@gmail.com——pass3');

      expect(await screen.findByRole('button', { name: /立即导入 \(3条\)/i })).toBeInTheDocument();
    });
  });

  describe('返回列表按钮', () => {
    it('单个导入模式下点击返回列表调用 onCancel', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      const cancelButton = screen.getByRole('button', { name: /返回列表/i });
      await user.click(cancelButton);

      expect(mockOnCancel).toHaveBeenCalled();
    });

    it('批量导入模式下点击返回列表调用 onCancel', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      await user.click(screen.getByRole('button', { name: /批量导入/i }));

      const cancelButton = screen.getByRole('button', { name: /返回列表/i });
      await user.click(cancelButton);

      expect(mockOnCancel).toHaveBeenCalled();
    });
  });

  describe('模式切换', () => {
    it('从单个导入切换到批量导入', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      expect(screen.getByText('单个账号信息')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /批量导入/i }));

      expect(screen.getByText('粘贴数据区域')).toBeInTheDocument();
      expect(screen.queryByText('单个账号信息')).not.toBeInTheDocument();
    });

    it('从批量导入切换回单个导入', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      await user.click(screen.getByRole('button', { name: /批量导入/i }));
      expect(screen.getByText('粘贴数据区域')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /单个导入/i }));

      expect(screen.getByText('单个账号信息')).toBeInTheDocument();
      expect(screen.queryByText('粘贴数据区域')).not.toBeInTheDocument();
    });
  });

  describe('边界情况', () => {
    it('处理只有邮箱没有密码的数据', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      await user.click(screen.getByRole('button', { name: /批量导入/i }));

      const textarea = screen.getByPlaceholderText(/示例：/i);
      await user.type(textarea, 'test@gmail.com');

      // 等待防抖完成，无有效数据时按钮应该被禁用或不可见
      await waitFor(() => {
        const importButton = screen.queryByRole('button', { name: /立即导入/i });
        // 按钮可能不存在（count为0）或被禁用
        if (importButton) {
          expect(importButton).toBeDisabled();
        }
      });
    });

    it('处理包含空白字符的邮箱和密码', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      const emailInput = screen.getByPlaceholderText('example@gmail.com');
      const passwordInput = screen.getByPlaceholderText('输入密码');

      await user.type(emailInput, '  test@gmail.com  ');
      await user.type(passwordInput, '  password123  ');

      const importButton = screen.getByRole('button', { name: /立即导入/i });
      await user.click(importButton);

      // 应该自动 trim
      expect(mockOnImport).toHaveBeenCalledWith([{
        email: 'test@gmail.com',
        password: 'password123',
        recovery: '',
        phone: '',
        secret: '',
        sms_url: '',
        reg_year: '',
        country: '',
        group_name: '',
        remark: '',
      }]);
    });

    it('单个导入只填写邮箱不能提交', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      const emailInput = screen.getByPlaceholderText('example@gmail.com');
      await user.type(emailInput, 'test@gmail.com');

      const importButton = screen.getByRole('button', { name: /立即导入/i });
      expect(importButton).toBeDisabled();
    });

    it('单个导入只填写密码不能提交', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      const passwordInput = screen.getByPlaceholderText('输入密码');
      await user.type(passwordInput, 'password123');

      const importButton = screen.getByRole('button', { name: /立即导入/i });
      expect(importButton).toBeDisabled();
    });

    it('清空批量导入文本区域恢复初始状态', async () => {
      const user = userEvent.setup();
      render(<ImportView onImport={mockOnImport} onCancel={mockOnCancel} />);

      await user.click(screen.getByRole('button', { name: /批量导入/i }));

      const textarea = screen.getByPlaceholderText(/示例：/i);
      await user.type(textarea, 'test@gmail.com——password123');

      expect(await screen.findByText('Count: 1')).toBeInTheDocument();

      await user.clear(textarea);

      // 等待防抖完成并重置
      expect(await screen.findByText('Count: 0')).toBeInTheDocument();
      expect(screen.getByText('等待解析数据...')).toBeInTheDocument();
    });
  });
});
