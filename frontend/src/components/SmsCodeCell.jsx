import { RefreshCw, Loader2, AlertCircle, Link2 } from 'lucide-react';

/**
 * 手机验证码单元格
 *
 * 视觉沿用 2FA 单元格的紧凑布局（等宽字体 + 高亮验证码 + 单击复制），
 * 但语义上更保守：
 * - 短信验证码没有固定有效期，右侧显示的是「下次刷新倒计时」，不是过期时间；
 * - 请求失败时保留的上一次结果会明确标注「上次」，不会冒充当前有效验证码；
 * - 不展示接码地址中的 token，只展示来源域名。
 */

const STATUS_TEXT = {
    loading: '获取中',
    empty: '等待短信',
    invalid_link: '链接失效',
    unparsable: '无法识别',
    no_config: '未配置',
    error: '获取失败',
};

const formatTime = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const ts = Date.parse(raw);
    if (Number.isNaN(ts)) return '';
    const date = new Date(ts);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
};

const SmsCodeCell = ({
    account,
    entry,
    host,
    hasUrl,
    onCopy,
    onEdit,
    onRefresh,
}) => {
    const safeHost = String(host || '');
    const status = entry?.status;
    const code = entry?.code ? String(entry.code) : '';
    const isStale = Boolean(entry?.stale);
    const isLoading = Boolean(entry?.loading) || status === 'loading';
    const secondsLeft = Number(entry?.secondsLeft || 0);

    // 未配置接码地址
    if (!hasUrl) {
        return (
            <button
                type="button"
                onDoubleClick={(e) => onEdit?.(e, account)}
                onMouseDown={(e) => e.stopPropagation()}
                className="gm-cell h-7 italic gm-text-3"
                title="双击配置接码地址"
            >
                未配置
            </button>
        );
    }

    const detail = entry?.error || entry?.message || '';
    const statusText = STATUS_TEXT[status] || (code ? '' : '等待结果');

    const titleParts = [safeHost ? `来源：${safeHost}` : '已配置接码地址'];
    if (statusText) titleParts.push(`状态：${statusText}`);
    if (code) titleParts.push(isStale ? '单击复制（上次获取的验证码）' : '单击复制验证码');
    if (detail) titleParts.push(detail.slice(0, 120));
    if (!isLoading && !entry?.autoPaused && secondsLeft > 0) titleParts.push(`${secondsLeft}s 后自动刷新`);
    if (entry?.autoPaused) titleParts.push('自动刷新已暂停，点击刷新按钮重试');
    titleParts.push('双击配置接码地址');

    return (
        <div className="flex flex-col gap-1">
            <button
                type="button"
                onClick={() => onCopy?.(code, '手机验证码', { stale: isStale })}
                onDoubleClick={(e) => onEdit?.(e, account)}
                onMouseDown={(e) => e.stopPropagation()}
                disabled={!code}
                className={`gm-cell h-7 text-sm font-mono font-semibold select-none flex items-center gap-1.5 ${code ? '' : 'gm-text-3'}`}
                style={code ? { color: 'var(--success)' } : undefined}
                title={titleParts.join('\n')}
            >
                {code ? (
                    <>
                        <span>{code}</span>
                        {isStale && <span className="text-[10px] font-normal opacity-70">上次</span>}
                    </>
                ) : (
                    <span className="text-xs font-normal truncate">{isLoading ? '获取中…' : statusText}</span>
                )}
            </button>

            <div className="flex items-center gap-1 min-h-[18px]">
                <button
                    type="button"
                    onClick={() => onRefresh?.(account?.id)}
                    onMouseDown={(e) => e.stopPropagation()}
                    disabled={isLoading}
                    className="gm-icon-btn flex-shrink-0"
                    style={{ width: 20, height: 20 }}
                    title={isLoading ? '正在获取验证码' : '立即刷新验证码'}
                    aria-label={`刷新账号 ${account?.email || account?.id} 的手机验证码`}
                >
                    {isLoading
                        ? <Loader2 size={12} className="animate-spin" />
                        : <RefreshCw size={12} />}
                </button>

                {/* 第二行只补充「来源 / 倒计时 / 提示」，状态文案统一由上一行承担，避免重复 */}
                {entry?.autoPaused ? (
                    <span className="text-[10px] truncate gm-text-3" title="自动刷新已暂停，点击左侧按钮重试">
                        已暂停
                    </span>
                ) : entry?.error ? (
                    <span className="text-[10px] flex items-center gap-0.5 truncate" style={{ color: 'var(--danger)' }} title={detail}>
                        <AlertCircle size={10} />
                        重试中
                    </span>
                ) : status === 'unparsable' ? (
                    <span className="text-[10px] truncate gm-text-3" title={detail}>
                        识别失败
                    </span>
                ) : (
                    <span className="text-[10px] gm-text-3 flex items-center gap-0.5 truncate" title={safeHost}>
                        <Link2 size={10} />
                        {isLoading
                            ? '获取中'
                            : (secondsLeft > 0 ? `${secondsLeft}s` : (code ? '已就绪' : '等待'))}
                    </span>
                )}
            </div>
        </div>
    );
};

export default SmsCodeCell;
