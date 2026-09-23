import { getAdapter } from './adapters/index.ts';

// 获取适配器实例（自动检测 Tauri/HTTP 模式）
const adapter = getAdapter();
const getErrorMessage = (error) => error instanceof Error ? error.message : String(error);

const api = {
    // 获取所有账号
    async getAccounts(search = '') {
        try {
            const accounts = await adapter.getAccounts(search || undefined);
            return accounts;
        } catch (error) {
            console.error('Failed to get accounts:', error);
            throw error;
        }
    },

    // 获取回收站账号
    async getDeletedAccounts() {
        try {
            const accounts = await adapter.getDeletedAccounts();
            return { success: true, data: accounts };
        } catch (error) {
            console.error('Failed to get deleted accounts:', error);
            return { success: false, data: [], message: getErrorMessage(error) };
        }
    },

    // 批量导入账号
    async batchImport(accounts) {
        try {
            const result = await adapter.batchImport(accounts);
            return {
                success: true,
                successCount: result.successCount,
                failCount: result.failCount
            };
        } catch (error) {
            console.error('Failed to batch import:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // 创建账号
    async createAccount(account) {
        try {
            const newAccount = await adapter.createAccount(account);
            return { success: true, data: newAccount };
        } catch (error) {
            console.error('Failed to create account:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // 更新账号
    async updateAccount(id, data) {
        try {
            const account = await adapter.updateAccount(id, data);
            return { success: true, data: account };
        } catch (error) {
            console.error('Failed to update account:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // 删除账号
    async deleteAccount(id) {
        try {
            await adapter.deleteAccount(id);
            return { success: true };
        } catch (error) {
            console.error('Failed to delete account:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // 恢复账号
    async restoreAccount(id) {
        try {
            const account = await adapter.restoreAccount(id);
            return { success: true, data: account };
        } catch (error) {
            console.error('Failed to restore account:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // 永久删除回收站账号
    async purgeAccount(id) {
        try {
            await adapter.purgeAccount(id);
            return { success: true };
        } catch (error) {
            console.error('Failed to purge account:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // 清空回收站
    async purgeAllDeleted() {
        try {
            const count = await adapter.purgeAllDeleted();
            return { success: true, data: count };
        } catch (error) {
            console.error('Failed to purge deleted accounts:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // 切换状态
    async toggleStatus(id) {
        try {
            const account = await adapter.toggleStatus(id);
            return { success: true, data: account };
        } catch (error) {
            console.error('Failed to toggle status:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // 获取 2FA 验证码
    async get2FACode(id) {
        try {
            // 首先获取账号信息以获得 secret
            const accounts = await adapter.getAccounts();
            const account = accounts.find(acc => acc.id === id);

            if (!account || !account.secret) {
                return {
                    success: false,
                    message: 'Account not found or secret not configured'
                };
            }

            // 使用 secret 生成 TOTP
            const result = await adapter.generateTotp(account.secret);

            return {
                success: true,
                code: result.code,
                remaining: result.remaining
            };
        } catch (error) {
            console.error('Failed to generate 2FA code:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // 获取手机短信验证码（实时对接接码地址，仅查询当前账号自己的链接）
    async fetchSmsCode(accountId) {
        try {
            const result = await adapter.fetchSmsCode(accountId);
            return { success: true, data: result };
        } catch (error) {
            console.error('Failed to fetch sms code:', error);
            return {
                success: false,
                message: getErrorMessage(error),
                data: {
                    status: 'error',
                    code: null,
                    message: null,
                    error: getErrorMessage(error),
                    retryAfterSeconds: null,
                    fetchedAt: new Date().toISOString(),
                },
            };
        }
    },

    // 获取账号修改历史记录
    async getAccountHistory(id) {
        try {
            const history = await adapter.getAccountHistory(id);
            return { success: true, data: history };
        } catch (error) {
            console.error('Failed to get account history:', error);
            return { success: false, message: getErrorMessage(error), data: [] };
        }
    },

    // 删除所有账号
    async deleteAllAccounts() {
        try {
            const result = await adapter.deleteAllAccounts();
            return { success: true, data: result };
        } catch (error) {
            console.error('Failed to delete all accounts:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // 创建数据库备份
    async createBackup(reason = 'manual') {
        try {
            const path = await adapter.createBackup(reason);
            return { success: true, data: path };
        } catch (error) {
            console.error('Failed to create backup:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // 列出备份
    async listBackups() {
        try {
            const backups = await adapter.listBackups();
            return { success: true, data: backups };
        } catch (error) {
            console.error('Failed to list backups:', error);
            return { success: false, data: [], message: getErrorMessage(error) };
        }
    },

    // 恢复备份
    async restoreBackup(backupName) {
        try {
            await adapter.restoreBackup(backupName);
            return { success: true };
        } catch (error) {
            console.error('Failed to restore backup:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // 导出账号为文本
    async exportAccountsText(accountIds, search, config) {
        try {
            const textContent = await adapter.exportAccountsText(accountIds, search, config);
            return { success: true, data: textContent };
        } catch (error) {
            console.error('Failed to export accounts:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    }
};

export default api;
