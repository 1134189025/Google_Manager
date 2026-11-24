import { useCallback, useEffect, useRef, useState } from 'react';
import {
    Bot,
    Send,
    Trash2,
    SlidersHorizontal,
    ShieldCheck,
    Check,
    X,
    Sparkles,
    AlertTriangle,
} from 'lucide-react';
import api from '../services/api';
import { confirmDialog } from '../utils/dialogs';

const STARTER_PROMPTS = [
    '总结未来 30 天内到期的服务器、域名和 AI 订阅，以及每月固定支出。',
    '检查当前所有服务器在线状态和资源使用率，有没有需要关注的节点？',
    '帮我新建一条提醒：下个月 1 号检查主力服务器和域名续费情况。',
    '盘点一下目前已录入的账号、银行卡与 AI 订阅统计情况。',
];

const PROPOSAL_STATUS_STYLE = {
    pending: {
        label: '待确认写入',
        background: 'var(--warning-soft)',
        color: 'var(--warning)',
    },
    applied: {
        label: '已写入本地数据库',
        background: 'var(--success-soft)',
        color: 'var(--success)',
    },
    rejected: {
        label: '已忽略',
        background: 'var(--bg-elevated)',
        color: 'var(--text-secondary)',
    },
};

function formatDiffValue(val) {
    if (val === null || val === undefined || val === '') return '（空）';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
}

const AgentView = ({ onNotify, onOpenSystemSettings, onOverviewChanged }) => {
    const [settings, setSettings] = useState(null);
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [input, setInput] = useState('');
    const [actingProposalKey, setActingProposalKey] = useState(null);
    const scrollBottomRef = useRef(null);

    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const [sRes, mRes] = await Promise.all([
                api.getAgentSettings(),
                api.getAgentMessages(),
            ]);
            if (sRes.success && sRes.data) setSettings(sRes.data);
            if (mRes.success && Array.isArray(mRes.data)) setMessages(mRes.data);
        } catch (err) {
            onNotify?.(`加载 AI 助手失败: ${err?.message || err}`, 'error');
        } finally {
            setLoading(false);
        }
    }, [onNotify]);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    useEffect(() => {
        scrollBottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
    }, [messages.length]);

    const isConfigured = Boolean(settings?.baseUrl && settings?.model);

    const handleSend = async (customText = null) => {
        const text = String(customText ?? input).trim();
        if (!text || sending) return;
        if (!isConfigured) {
            onNotify?.('请先配置 AI 模型接口地址与模型名称', 'error');
            onOpenSystemSettings?.('ai');
            return;
        }
        if (customText === null) setInput('');
        setSending(true);
        try {
            const res = await api.sendAgentMessage(text);
            if (res.success && Array.isArray(res.data)) {
                setMessages(res.data);
            } else {
                onNotify?.(res.message || '发送消息失败', 'error');
            }
        } finally {
            setSending(false);
        }
    };

    const handleClear = async () => {
        if (messages.length === 0) return;
        const ok = await confirmDialog('确定要清空当前 AI 助手全部对话记录吗？', {
            title: '清空对话',
            okLabel: '清空',
            cancelLabel: '取消',
            kind: 'warning',
        });
        if (!ok) return;
        const res = await api.clearAgentMessages();
        if (res.success) {
            setMessages([]);
            onNotify?.('对话历史已清空');
        } else {
            onNotify?.(res.message || '清空失败', 'error');
        }
    };

    const handleProposalAction = async (messageId, proposalId, action) => {
        const key = `${messageId}:${proposalId}`;
        setActingProposalKey(key);
        try {
            const res =
                action === 'apply'
                    ? await api.applyAgentProposal(messageId, proposalId)
                    : await api.rejectAgentProposal(messageId, proposalId);
            if (!res.success || !res.data) {
                onNotify?.(res.message || '处理提案失败', 'error');
                return;
            }
            setMessages(prev => prev.map(m => (m.id === messageId ? res.data : m)));
            if (action === 'apply') {
                onOverviewChanged?.();
                onNotify?.('变更提案已确认写入本地数据库');
            } else {
                onNotify?.('已忽略该提案');
            }
        } finally {
            setActingProposalKey(null);
        }
    };

    return (
        <div className="max-w-5xl mx-auto flex flex-col gap-4 h-[calc(100vh-110px)] gm-view-enter">
            {/* 头部 */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="gm-title flex items-center gap-2">
                        <Bot size={20} className="text-[var(--primary)]" />
                        AI 数字资产助手
                    </h1>
                    <p className="gm-subtitle">
                        基于本地严格脱敏元数据回答资产、续费、支出与服务器状态问题；写操作一律生成预览提案，确认后才落盘。
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className="gm-btn gm-btn-ghost text-xs"
                        onClick={() => onOpenSystemSettings?.('ai')}
                    >
                        <SlidersHorizontal size={14} />
                        {isConfigured ? `模型：${settings.model}` : '配置 AI 模型'}
                    </button>
                    {messages.length > 0 && (
                        <button
                            type="button"
                            className="gm-btn gm-btn-ghost text-xs text-[var(--danger)]"
                            onClick={handleClear}
                        >
                            <Trash2 size={14} />
                            清空对话
                        </button>
                    )}
                </div>
            </div>

            {/* 隐私隔离声明横幅 */}
            <div
                className="rounded-xl px-4 py-2.5 text-xs flex items-center gap-2.5 border border-[var(--border-subtle)]"
                style={{ background: 'var(--primary-light)', color: 'var(--text-primary)' }}
            >
                <ShieldCheck size={16} className="text-[var(--primary)] shrink-0" />
                <span>
                    隐私保护已启用：密码、2FA 密钥、短信接码地址、银行卡号/CVV、OAuth 令牌、SSH 私钥/口令及 Cloudflare Token
                    绝不会随请求发送给任何模型；所有数据修改均需您逐条确认。
                </span>
            </div>

            {!loading && !isConfigured && (
                <div className="gm-card p-6 flex flex-wrap items-center justify-between gap-4 border border-[var(--warning)]">
                    <div className="flex items-start gap-3">
                        <AlertTriangle size={20} className="text-[var(--warning)] shrink-0 mt-0.5" />
                        <div className="space-y-1">
                            <div className="text-sm font-semibold text-[var(--text-primary)]">
                                尚未配置 OpenAI 兼容模型接口
                            </div>
                            <p className="text-xs text-[var(--text-secondary)]">
                                请先前往「系统设置 → AI 模型配置」填写接口地址（支持 HTTPS 或本机 Ollama / vLLM HTTP）、API Key 与模型名称。
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="gm-btn gm-btn-primary text-xs"
                        onClick={() => onOpenSystemSettings?.('ai')}
                    >
                        前往配置 AI 模型
                    </button>
                </div>
            )}

            {/* 对话消息流 */}
            <div className="gm-card flex-1 overflow-y-auto p-4 space-y-4">
                {loading ? (
                    <div className="py-12 text-center text-xs text-[var(--text-secondary)]">
                        正在加载历史对话...
                    </div>
                ) : messages.length === 0 ? (
                    <div className="py-8 space-y-5 text-center">
                        <Sparkles size={28} className="mx-auto text-[var(--primary)]" />
                        <div className="space-y-1">
                            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                                您可以直接询问工作区资产、续费计划或让助手生成变更提案
                            </h2>
                            <p className="text-xs text-[var(--text-secondary)]">
                                点击下方快捷问题快速开始：
                            </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl mx-auto text-left">
                            {STARTER_PROMPTS.map(prompt => (
                                <button
                                    key={prompt}
                                    type="button"
                                    className="gm-card p-3 text-xs text-[var(--text-primary)] hover:border-[var(--primary)] transition-colors text-left"
                                    onClick={() => handleSend(prompt)}
                                    disabled={sending}
                                >
                                    {prompt}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    messages.map(msg => {
                        const isUser = msg.role === 'user';
                        return (
                            <div
                                key={msg.id}
                                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} gap-2`}
                            >
                                <div
                                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                                        isUser
                                            ? 'bg-[var(--primary)] text-white'
                                            : 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-subtle)]'
                                    }`}
                                >
                                    {msg.content}
                                </div>

                                {Array.isArray(msg.proposals) &&
                                    msg.proposals.map(prop => {
                                        const st =
                                            PROPOSAL_STATUS_STYLE[prop.status] ||
                                            PROPOSAL_STATUS_STYLE.pending;
                                        const busy = actingProposalKey === `${msg.id}:${prop.id}`;
                                        const diffs = Array.isArray(prop.diffs) ? prop.diffs : [];
                                        return (
                                            <div
                                                key={prop.id}
                                                className="w-full max-w-xl rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-3 text-xs"
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="font-semibold text-[var(--text-primary)]">
                                                        {prop.targetLabel}
                                                    </div>
                                                    <span
                                                        className="gm-badge text-[11px]"
                                                        style={{
                                                            background: st.background,
                                                            color: st.color,
                                                        }}
                                                    >
                                                        {st.label}
                                                    </span>
                                                </div>
                                                {prop.reason && (
                                                    <p className="text-[var(--text-secondary)]">
                                                        原因：{prop.reason}
                                                    </p>
                                                )}
                                                {diffs.length > 0 && (
                                                    <div className="rounded-lg border border-[var(--border-subtle)] overflow-hidden">
                                                        <table className="w-full text-[11px]">
                                                            <thead>
                                                                <tr className="bg-[var(--bg-elevated)] text-left text-[var(--text-secondary)]">
                                                                    <th className="px-2.5 py-1.5">字段</th>
                                                                    <th className="px-2.5 py-1.5">变更前</th>
                                                                    <th className="px-2.5 py-1.5">变更后</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-[var(--border-subtle)]">
                                                                {diffs.map((d, i) => (
                                                                    <tr key={`${d.field}-${i}`}>
                                                                        <td className="px-2.5 py-1.5 font-medium">
                                                                            {d.label || d.field}
                                                                        </td>
                                                                        <td className="px-2.5 py-1.5 font-mono text-[var(--text-muted)]">
                                                                            {formatDiffValue(d.before)}
                                                                        </td>
                                                                        <td className="px-2.5 py-1.5 font-mono text-[var(--primary)]">
                                                                            {formatDiffValue(d.after)}
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                                {prop.status === 'pending' && (
                                                    <div className="flex justify-end gap-2">
                                                        <button
                                                            type="button"
                                                            className="gm-btn gm-btn-ghost text-xs py-1 px-2.5"
                                                            disabled={busy}
                                                            onClick={() =>
                                                                handleProposalAction(
                                                                    msg.id,
                                                                    prop.id,
                                                                    'reject',
                                                                )
                                                            }
                                                        >
                                                            <X size={13} />
                                                            忽略
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="gm-btn gm-btn-primary text-xs py-1 px-2.5"
                                                            disabled={busy}
                                                            onClick={() =>
                                                                handleProposalAction(
                                                                    msg.id,
                                                                    prop.id,
                                                                    'apply',
                                                                )
                                                            }
                                                        >
                                                            <Check size={13} />
                                                            确认写入
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                            </div>
                        );
                    })
                )}
                <div ref={scrollBottomRef} />
            </div>

            {/* 底部输入框 */}
            <form
                className="gm-card p-3 flex items-end gap-2"
                onSubmit={e => {
                    e.preventDefault();
                    handleSend();
                }}
            >
                <textarea
                    rows={2}
                    className="gm-input flex-1 text-xs resize-none"
                    placeholder="输入问题或让助手生成提醒/费用修改提案（Enter 发送，Shift+Enter 换行）..."
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                    disabled={sending}
                />
                <button
                    type="submit"
                    className="gm-btn gm-btn-primary text-xs px-4 py-2.5 shrink-0"
                    disabled={sending || !input.trim()}
                >
                    <Send size={14} />
                    {sending ? '思考中...' : '发送'}
                </button>
            </form>
        </div>
    );
};

export default AgentView;
