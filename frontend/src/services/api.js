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
    },

    // 生成导出文本并由后端直接写入指定文件，返回 { path, count }
    async exportAccountsToFile(accountIds, search, config, path) {
        try {
            const result = await adapter.exportAccountsToFile(accountIds, search, config, path);
            return { success: true, data: result };
        } catch (error) {
            console.error('Failed to export accounts to file:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // ─── 账号独立浏览器 ───────────────────────────────────────────

    // 打开账号浏览器：未运行则启动，运行中则切到已有窗口
    async openAccountBrowser(accountId) {
        try {
            const result = await adapter.openAccountBrowser(accountId);
            return { success: true, data: result };
        } catch (error) {
            console.error('Failed to open account browser:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // 查询配置目录状态（键为原始邮箱）
    async getBrowserStatuses(emails) {
        try {
            const statuses = await adapter.getBrowserStatuses(emails);
            return { success: true, data: statuses };
        } catch (error) {
            console.error('Failed to get browser statuses:', error);
            return { success: false, data: {}, message: getErrorMessage(error) };
        }
    },

    // 清理缓存：accountIds 为 null 时清理全部配置
    async clearBrowserCache(accountIds = null) {
        try {
            const result = await adapter.clearBrowserCache(accountIds);
            return { success: true, data: result };
        } catch (error) {
            console.error('Failed to clear browser cache:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // 按邮箱删除配置目录（仍被其他记录使用或正在运行的会跳过）
    async deleteBrowserProfiles(emails) {
        try {
            const result = await adapter.deleteBrowserProfiles(emails);
            return { success: true, data: result };
        } catch (error) {
            console.error('Failed to delete browser profiles:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async getBrowserSettings() {
        try {
            const settings = await adapter.getBrowserSettings();
            return { success: true, data: settings };
        } catch (error) {
            console.error('Failed to get browser settings:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async saveBrowserSettings(settings) {
        try {
            const saved = await adapter.saveBrowserSettings(settings);
            return { success: true, data: saved };
        } catch (error) {
            console.error('Failed to save browser settings:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async getBrowserUsage() {
        try {
            const usage = await adapter.getBrowserUsage();
            return { success: true, data: usage };
        } catch (error) {
            console.error('Failed to get browser usage:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async openBrowserProfileDir(accountId) {
        try {
            await adapter.openBrowserProfileDir(accountId);
            return { success: true };
        } catch (error) {
            console.error('Failed to open browser profile dir:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // ─── 工作区概览 / 续费 / 备忘提醒 ────────────────────────────

    async getWorkspaceOverview() {
        try {
            const data = await adapter.getWorkspaceOverview();
            return { success: true, data };
        } catch (error) {
            console.error('Failed to get workspace overview:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async getUsdCnyRate(forceRefresh = false) {
        try {
            const data = await adapter.getUsdCnyRate(forceRefresh);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to get USD/CNY rate:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async getRenewalsSummary(withinDays = 90) {
        try {
            const data = await adapter.getRenewalsSummary(withinDays);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to get renewals summary:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async advanceRenewal(kind, id) {
        try {
            const nextDate = await adapter.advanceRenewal(kind, id);
            return { success: true, data: nextDate };
        } catch (error) {
            console.error('Failed to advance renewal:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async getReminders() {
        try {
            const data = await adapter.getReminders();
            return { success: true, data };
        } catch (error) {
            console.error('Failed to get reminders:', error);
            return { success: false, data: [], message: getErrorMessage(error) };
        }
    },

    async createReminder(reminder) {
        try {
            const data = await adapter.createReminder(reminder);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to create reminder:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async updateReminder(id, reminder) {
        try {
            const data = await adapter.updateReminder(id, reminder);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to update reminder:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async deleteReminder(id) {
        try {
            await adapter.deleteReminder(id);
            return { success: true };
        } catch (error) {
            console.error('Failed to delete reminder:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async completeReminder(id) {
        try {
            const data = await adapter.completeReminder(id);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to complete reminder:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async writeTextFile(path, content) {
        try {
            const savedPath = await adapter.writeTextFile(path, content);
            return { success: true, data: savedPath };
        } catch (error) {
            console.error('Failed to write text file:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async readTextFile(path) {
        try {
            const content = await adapter.readTextFile(path);
            return { success: true, data: content };
        } catch (error) {
            console.error('Failed to read text file:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async openExternalUrl(url) {
        try {
            await adapter.openExternalUrl(url);
            return { success: true };
        } catch (error) {
            console.error('Failed to open external url:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // ─── 账号与密钥库 ──────────────────────────────────────────────

    async getVaultFolders() {
        try {
            const data = await adapter.getVaultFolders();
            return { success: true, data };
        } catch (error) {
            console.error('Failed to get vault folders:', error);
            return { success: false, data: [], message: getErrorMessage(error) };
        }
    },

    async createVaultFolder(folder) {
        try {
            const data = await adapter.createVaultFolder(folder);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to create vault folder:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async updateVaultFolder(id, folder) {
        try {
            const data = await adapter.updateVaultFolder(id, folder);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to update vault folder:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async deleteVaultFolder(id) {
        try {
            await adapter.deleteVaultFolder(id);
            return { success: true };
        } catch (error) {
            console.error('Failed to delete vault folder:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async getVaultItems(search = '') {
        try {
            const data = await adapter.getVaultItems(search || undefined);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to get vault items:', error);
            return { success: false, data: [], message: getErrorMessage(error) };
        }
    },

    async createVaultItem(item) {
        try {
            const data = await adapter.createVaultItem(item);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to create vault item:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async updateVaultItem(id, item) {
        try {
            const data = await adapter.updateVaultItem(id, item);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to update vault item:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async deleteVaultItem(id) {
        try {
            await adapter.deleteVaultItem(id);
            return { success: true };
        } catch (error) {
            console.error('Failed to delete vault item:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async batchImportVaultItems(items) {
        try {
            const data = await adapter.batchImportVaultItems(items);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to batch import vault items:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // ─── U 卡与支付卡 ──────────────────────────────────────────────

    async getPaymentCards() {
        try {
            const data = await adapter.getPaymentCards();
            return { success: true, data };
        } catch (error) {
            console.error('Failed to get payment cards:', error);
            return { success: false, data: [], message: getErrorMessage(error) };
        }
    },

    async createPaymentCard(card) {
        try {
            const data = await adapter.createPaymentCard(card);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to create payment card:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async updatePaymentCard(id, card) {
        try {
            const data = await adapter.updatePaymentCard(id, card);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to update payment card:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async deletePaymentCard(id) {
        try {
            await adapter.deletePaymentCard(id);
            return { success: true };
        } catch (error) {
            console.error('Failed to delete payment card:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // ─── 域名管理与 Cloudflare DNS ────────────────────────────────

    async getDomains() {
        try {
            const data = await adapter.getDomains();
            return { success: true, data };
        } catch (error) {
            console.error('Failed to get domains:', error);
            return { success: false, data: [], message: getErrorMessage(error) };
        }
    },

    async createDomain(domain) {
        try {
            const data = await adapter.createDomain(domain);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to create domain:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async updateDomain(id, domain) {
        try {
            const data = await adapter.updateDomain(id, domain);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to update domain:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async deleteDomain(id) {
        try {
            await adapter.deleteDomain(id);
            return { success: true };
        } catch (error) {
            console.error('Failed to delete domain:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async probeDomain(id) {
        try {
            const data = await adapter.probeDomain(id);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to probe domain:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async getCloudflareConnections() {
        try {
            const data = await adapter.getCloudflareConnections();
            return { success: true, data };
        } catch (error) {
            console.error('Failed to get cloudflare connections:', error);
            return { success: false, data: [], message: getErrorMessage(error) };
        }
    },

    async saveCloudflareConnection(id, connection) {
        try {
            const data = await adapter.saveCloudflareConnection(id, connection);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to save cloudflare connection:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async deleteCloudflareConnection(id) {
        try {
            await adapter.deleteCloudflareConnection(id);
            return { success: true };
        } catch (error) {
            console.error('Failed to delete cloudflare connection:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async listCloudflareZones(connectionId) {
        try {
            const data = await adapter.listCloudflareZones(connectionId);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to list cloudflare zones:', error);
            return { success: false, data: [], message: getErrorMessage(error) };
        }
    },

    async importCloudflareZones(connectionId, zones) {
        try {
            const count = await adapter.importCloudflareZones(connectionId, zones);
            return { success: true, data: count };
        } catch (error) {
            console.error('Failed to import cloudflare zones:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async listDomainDnsRecords(domainId) {
        try {
            const data = await adapter.listDomainDnsRecords(domainId);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to list domain DNS records:', error);
            return { success: false, data: [], message: getErrorMessage(error) };
        }
    },

    async applyDomainDnsRecord(domainId, action, recordId = null, record = null) {
        try {
            const data = await adapter.applyDomainDnsRecord(domainId, action, recordId, record);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to apply domain DNS record:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // ─── AI 订阅与 OAuth / CLI 额度 ──────────────────────────────

    async getAiSubscriptions() {
        try {
            const data = await adapter.getAiSubscriptions();
            return { success: true, data };
        } catch (error) {
            console.error('Failed to get AI subscriptions:', error);
            return { success: false, data: [], message: getErrorMessage(error) };
        }
    },

    async createAiSubscription(subscription) {
        try {
            const data = await adapter.createAiSubscription(subscription);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to create AI subscription:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async updateAiSubscription(id, subscription) {
        try {
            const data = await adapter.updateAiSubscription(id, subscription);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to update AI subscription:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async deleteAiSubscription(id) {
        try {
            await adapter.deleteAiSubscription(id);
            return { success: true };
        } catch (error) {
            console.error('Failed to delete AI subscription:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async startAiOauth(provider, subscriptionId) {
        try {
            const data = await adapter.startAiOauth(provider, subscriptionId);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to start AI OAuth:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async getAiOauthStatus(sessionId) {
        try {
            const data = await adapter.getAiOauthStatus(sessionId);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to get AI OAuth status:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async completeAiOauth(sessionId, callbackInput) {
        try {
            const data = await adapter.completeAiOauth(sessionId, callbackInput);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to complete AI OAuth:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async cancelAiOauth(sessionId) {
        try {
            await adapter.cancelAiOauth(sessionId);
            return { success: true };
        } catch (error) {
            console.error('Failed to cancel AI OAuth:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async disconnectAiOauth(id) {
        try {
            const data = await adapter.disconnectAiOauth(id);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to disconnect AI OAuth:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async refreshAiSubscriptionQuota(id) {
        try {
            const data = await adapter.refreshAiSubscriptionQuota(id);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to refresh AI subscription quota:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async readAntigravityCliQuota() {
        try {
            const data = await adapter.readAntigravityCliQuota();
            return { success: true, data };
        } catch (error) {
            console.error('Failed to read Antigravity CLI quota:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // ─── 服务器台账、SSH 终端与 SFTP ───────────────────────────────

    async getServers(search = '') {
        try {
            const data = await adapter.getServers(search);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to get servers:', error);
            return { success: false, data: [], message: getErrorMessage(error) };
        }
    },

    async createServer(server) {
        try {
            const data = await adapter.createServer(server);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to create server:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async updateServer(id, server) {
        try {
            const data = await adapter.updateServer(id, server);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to update server:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async deleteServer(id) {
        try {
            await adapter.deleteServer(id);
            return { success: true };
        } catch (error) {
            console.error('Failed to delete server:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async probeServer(id) {
        try {
            const data = await adapter.probeServer(id);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to probe server:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async resetServerHostFingerprint(id) {
        try {
            const data = await adapter.resetServerHostFingerprint(id);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to reset server host fingerprint:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async getAppMonitorSettings() {
        try {
            const data = await adapter.getAppMonitorSettings();
            return { success: true, data };
        } catch (error) {
            console.error('Failed to get monitor settings:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async saveAppMonitorSettings(serverMonitorMinutes) {
        try {
            const data = await adapter.saveAppMonitorSettings(serverMonitorMinutes);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to save monitor settings:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async sshOpenSession(serverId, cols = 100, rows = 30) {
        try {
            const data = await adapter.sshOpenSession(serverId, cols, rows);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to open SSH session:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async sshWriteSession(sessionId, data) {
        try {
            await adapter.sshWriteSession(sessionId, data);
            return { success: true };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async sshResizeSession(sessionId, cols, rows) {
        try {
            await adapter.sshResizeSession(sessionId, cols, rows);
            return { success: true };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async sshCloseSession(sessionId) {
        try {
            await adapter.sshCloseSession(sessionId);
            return { success: true };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async sshListSessions() {
        try {
            const data = await adapter.sshListSessions();
            return { success: true, data };
        } catch (error) {
            return { success: false, data: [], message: getErrorMessage(error) };
        }
    },

    async sftpListDir(serverId, path = '.') {
        try {
            const data = await adapter.sftpListDir(serverId, path);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to list SFTP dir:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async sftpDownloadFile(serverId, remotePath, localPath) {
        try {
            const bytes = await adapter.sftpDownloadFile(serverId, remotePath, localPath);
            return { success: true, data: bytes };
        } catch (error) {
            console.error('Failed to download via SFTP:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async sftpUploadFile(serverId, localPath, remotePath) {
        try {
            const bytes = await adapter.sftpUploadFile(serverId, localPath, remotePath);
            return { success: true, data: bytes };
        } catch (error) {
            console.error('Failed to upload via SFTP:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async sftpMkdir(serverId, remotePath) {
        try {
            await adapter.sftpMkdir(serverId, remotePath);
            return { success: true };
        } catch (error) {
            console.error('Failed to mkdir via SFTP:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async sftpRemove(serverId, remotePath, isDir) {
        try {
            await adapter.sftpRemove(serverId, remotePath, isDir);
            return { success: true };
        } catch (error) {
            console.error('Failed to remove via SFTP:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    // ─── AI 助手 ───────────────────────────────────────────────────

    async getAgentSettings() {
        try {
            const data = await adapter.getAgentSettings();
            return { success: true, data };
        } catch (error) {
            console.error('Failed to get agent settings:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async saveAgentSettings(settings) {
        try {
            const data = await adapter.saveAgentSettings(settings);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to save agent settings:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async testAgentConnection(baseUrl = null, apiKey = null, model = null) {
        try {
            const data = await adapter.testAgentConnection(baseUrl, apiKey, model);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to test agent connection:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async getAgentMessages() {
        try {
            const data = await adapter.getAgentMessages();
            return { success: true, data };
        } catch (error) {
            console.error('Failed to get agent messages:', error);
            return { success: false, data: [], message: getErrorMessage(error) };
        }
    },

    async clearAgentMessages() {
        try {
            await adapter.clearAgentMessages();
            return { success: true };
        } catch (error) {
            console.error('Failed to clear agent messages:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async sendAgentMessage(message) {
        try {
            const data = await adapter.sendAgentMessage(message);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to send agent message:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async applyAgentProposal(messageId, proposalId) {
        try {
            const data = await adapter.applyAgentProposal(messageId, proposalId);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to apply agent proposal:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    },

    async rejectAgentProposal(messageId, proposalId) {
        try {
            const data = await adapter.rejectAgentProposal(messageId, proposalId);
            return { success: true, data };
        } catch (error) {
            console.error('Failed to reject agent proposal:', error);
            return { success: false, message: getErrorMessage(error) };
        }
    }
};

export default api;
