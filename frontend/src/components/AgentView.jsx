import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Bot,
    Send,
    Square,
    Trash2,
    SlidersHorizontal,
    ShieldCheck,
    Check,
    X,
    Sparkles,
    AlertTriangle,
    ChevronDown,
    ChevronRight,
    Copy,
    RefreshCw,
    Terminal,
    Cpu,
} from 'lucide-react';
import api from '../services/api';
import { confirmDialog } from '../utils/dialogs';
import { isTauriRuntime } from '../utils/tauriRuntime';

const STARTER_PROMPTS = [
    '盘点未来 90 天内到期的服务器、域名和 AI 订阅，并按人民币汇总月度与年度支出。',
    '检查当前所有服务器在线状态和 CPU/内存/磁盘指标，指出需要关注的节点。',
    '帮我新建一条提醒：下个月 1 号检查主力服务器和域名续费情况。',
    '总结目前工作区已录入的谷歌账号、密钥库、支付卡与 AI 订阅分布。',
];

const SLASH_SHORTCUTS = [
    {
        cmd: '/summary',
        label: '资产盘点',
        prompt: '盘点当前工作区所有资产统计，并按人民币汇总月度与年度总支出。',
    },
    {
        cmd: '/renewals',
        label: '续费账单',
        prompt: '列出未来 90 天内即将到期的所有资产续费清单（按人民币折算），按紧急程度排序。',
    },
    {
        cmd: '/servers',
        label: '服务器巡检',
        prompt: '检查全部服务器的在线状态、系统负载、CPU/内存/磁盘使用率与容器状态，输出简明巡检表。',
    },
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

/**
 * 拆分内联 <think>...</think> 标签（兼容直接把思考写在 content 中的推理网关）
 */
function splitInlineThink(rawText = '') {
    const text = String(rawText ?? '');
    const openIdx = text.indexOf('<think>');
    if (openIdx === -1) {
        return { thinking: '', answer: text };
    }
    const closeIdx = text.indexOf('</think>', openIdx + 7);
    if (closeIdx === -1) {
        return {
            thinking: text.slice(openIdx + 7).trim(),
            answer: text.slice(0, openIdx).trim(),
        };
    }
    const thinking = text.slice(openIdx + 7, closeIdx).trim();
    const answer = `${text.slice(0, openIdx)}${text.slice(closeIdx + 8)}`.trim();
    return { thinking, answer };
}

/**
 * 轻量内联 Markdown 渲染（支持粗斜体、粗体、斜体、删除线、等宽代码，以及流式尾端残缺星号平滑清理）
 */
function renderInlineMarkdown(text, streaming = false) {
    let source = String(text ?? '');
    // 流式输出中若行尾出现尚未闭合的孤立 **，临时隐去避免闪烁原始星号
    if (streaming) {
        const starPairs = (source.match(/\*\*/g) || []).length;
        if (starPairs % 2 === 1 && source.endsWith('**')) {
            source = source.slice(0, -2);
        }
    }
    const tokens = [];
    const pattern = /(`[^`]+`|\*\*\*[^*\n]+\*\*\*|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*)/g;
    let last = 0;
    let match;
    let key = 0;
    while ((match = pattern.exec(source)) !== null) {
        if (match.index > last) {
            tokens.push(source.slice(last, match.index));
        }
        const raw = match[0];
        if (raw.startsWith('`') && raw.endsWith('`')) {
            tokens.push(
                <code key={`ic-${key++}`} className="gm-md-inline-code">
                    {raw.slice(1, -1)}
                </code>,
            );
        } else if (raw.startsWith('***') && raw.endsWith('***')) {
            tokens.push(
                <strong key={`bi-${key++}`} className="font-semibold italic text-[var(--text-primary)]">
                    {raw.slice(3, -3)}
                </strong>,
            );
        } else if (raw.startsWith('**') && raw.endsWith('**')) {
            tokens.push(
                <strong key={`b-${key++}`} className="font-semibold text-[var(--text-primary)]">
                    {raw.slice(2, -2)}
                </strong>,
            );
        } else if (raw.startsWith('~~') && raw.endsWith('~~')) {
            tokens.push(
                <del key={`d-${key++}`} className="opacity-65 line-through">
                    {raw.slice(2, -2)}
                </del>,
            );
        } else if (raw.startsWith('*') && raw.endsWith('*')) {
            tokens.push(
                <em key={`i-${key++}`} className="italic text-[var(--text-secondary)]">
                    {raw.slice(1, -1)}
                </em>,
            );
        }
        last = pattern.lastIndex;
    }
    if (last < source.length) {
        tokens.push(source.slice(last));
    }
    return tokens;
}

const isDividerLine = (line) => /^[\s]*([-*_=~•·─━—]{3,})[\s]*$/.test(line);

/**
 * 桌面客户端原生风格 Markdown 渲染器（自动清洗 ***** 分隔符、卡片化标题/引用/数据表/代码块/像素列表）
 */
const AgentMarkdown = ({ content, streaming = false, onCopyCode }) => {
    const blocks = useMemo(() => {
        const lines = String(content ?? '').replace(/\r\n/g, '\n').split('\n');
        const out = [];
        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            if (!line.trim()) {
                i += 1;
                continue;
            }
            // 代码块
            if (line.trim().startsWith('```')) {
                const lang = line.trim().slice(3).trim();
                const codeLines = [];
                i += 1;
                while (i < lines.length && !lines[i].trim().startsWith('```')) {
                    codeLines.push(lines[i]);
                    i += 1;
                }
                if (i < lines.length) i += 1;
                out.push({ type: 'code', lang, text: codeLines.join('\n') });
                continue;
            }
            // 标题（# / ## / ### / ####）
            const heading = line.match(/^(#{1,4})\s+(.+)$/);
            if (heading) {
                out.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
                i += 1;
                continue;
            }
            // 识别并美化各种分割线（--- / *** / ***** / ===== / ───），合并连续重复分割线
            if (isDividerLine(line)) {
                if (out.length > 0 && out[out.length - 1].type !== 'hr') {
                    out.push({ type: 'hr' });
                }
                i += 1;
                continue;
            }
            // 表格
            if (
                line.includes('|') &&
                i + 1 < lines.length &&
                /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])
            ) {
                const parseRow = (row) =>
                    row
                        .trim()
                        .replace(/^\|/, '')
                        .replace(/\|$/, '')
                        .split('|')
                        .map(c => c.trim());
                const headers = parseRow(line);
                const rows = [];
                i += 2;
                while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
                    rows.push(parseRow(lines[i]));
                    i += 1;
                }
                out.push({ type: 'table', headers, rows });
                continue;
            }
            // 无序列表
            if (/^\s*[-*•]\s+/.test(line)) {
                const items = [];
                while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
                    items.push(lines[i].replace(/^\s*[-*•]\s+/, ''));
                    i += 1;
                }
                out.push({ type: 'ul', items });
                continue;
            }
            // 有序列表
            if (/^\s*\d+[.)、]\s+/.test(line)) {
                const items = [];
                while (i < lines.length && /^\s*\d+[.)、]\s+/.test(lines[i])) {
                    items.push(lines[i].replace(/^\s*\d+[.)、]\s+/, ''));
                    i += 1;
                }
                out.push({ type: 'ol', items });
                continue;
            }
            // 引用总结块
            if (line.trim().startsWith('>')) {
                const quoteLines = [];
                while (i < lines.length && lines[i].trim().startsWith('>')) {
                    quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
                    i += 1;
                }
                out.push({ type: 'quote', text: quoteLines.join('\n') });
                continue;
            }
            // 普通段落
            const paraLines = [];
            while (
                i < lines.length &&
                lines[i].trim() &&
                !isDividerLine(lines[i]) &&
                !lines[i].trim().startsWith('```') &&
                !/^(#{1,4})\s+/.test(lines[i]) &&
                !/^\s*[-*•]\s+/.test(lines[i]) &&
                !/^\s*\d+[.)、]\s+/.test(lines[i]) &&
                !lines[i].trim().startsWith('>')
            ) {
                paraLines.push(lines[i]);
                i += 1;
            }
            if (paraLines.length > 0) {
                out.push({ type: 'p', text: paraLines.join('\n') });
            }
        }
        // 移除末尾多余分割线
        while (out.length > 0 && out[out.length - 1].type === 'hr') {
            out.pop();
        }
        return out;
    }, [content]);

    if (blocks.length === 0 && streaming) {
        return <span className="gm-stream-cursor" aria-hidden="true" />;
    }

    return (
        <div className="gm-md-body">
            {blocks.map((block, idx) => {
                const isLast = idx === blocks.length - 1;
                if (block.type === 'heading') {
                    return (
                        <div key={idx} className={`gm-md-heading is-l${block.level}`}>
                            <span className="gm-md-heading-bar" aria-hidden="true" />
                            <span>{renderInlineMarkdown(block.text, streaming && isLast)}</span>
                            {streaming && isLast && <span className="gm-stream-cursor" aria-hidden="true" />}
                        </div>
                    );
                }
                if (block.type === 'hr') {
                    return <div key={idx} className="gm-md-hr" role="separator" />;
                }
                if (block.type === 'code') {
                    return (
                        <div key={idx} className="gm-md-codeblock">
                            <div className="gm-md-codehead">
                                <span>{block.lang || 'text'}</span>
                                <button
                                    type="button"
                                    onClick={() => onCopyCode?.(block.text)}
                                    className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] cursor-pointer"
                                >
                                    <Copy size={11} />
                                    <span>复制</span>
                                </button>
                            </div>
                            <pre className="p-3 overflow-x-auto text-[12px] font-mono leading-relaxed text-[var(--text-primary)] m-0">
                                <code>{block.text}</code>
                            </pre>
                        </div>
                    );
                }
                if (block.type === 'table') {
                    return (
                        <div key={idx} className="gm-md-table-wrap">
                            <table className="gm-md-table">
                                <thead>
                                    <tr>
                                        {block.headers.map((h, hi) => (
                                            <th key={hi}>{renderInlineMarkdown(h)}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {block.rows.map((r, ri) => (
                                        <tr key={ri}>
                                            {r.map((cell, ci) => (
                                                <td key={ci}>{renderInlineMarkdown(cell)}</td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    );
                }
                if (block.type === 'ul') {
                    return (
                        <ul key={idx} className="gm-md-ul">
                            {block.items.map((item, ii) => (
                                <li key={ii}>
                                    <span className="gm-md-bullet" aria-hidden="true" />
                                    <span className="min-w-0 flex-1">
                                        {renderInlineMarkdown(item, streaming && isLast && ii === block.items.length - 1)}
                                        {streaming && isLast && ii === block.items.length - 1 && (
                                            <span className="gm-stream-cursor" aria-hidden="true" />
                                        )}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    );
                }
                if (block.type === 'ol') {
                    return (
                        <ol key={idx} className="gm-md-ol">
                            {block.items.map((item, ii) => (
                                <li key={ii}>
                                    <span className="gm-md-num" aria-hidden="true">{ii + 1}</span>
                                    <span className="min-w-0 flex-1">
                                        {renderInlineMarkdown(item, streaming && isLast && ii === block.items.length - 1)}
                                        {streaming && isLast && ii === block.items.length - 1 && (
                                            <span className="gm-stream-cursor" aria-hidden="true" />
                                        )}
                                    </span>
                                </li>
                            ))}
                        </ol>
                    );
                }
                if (block.type === 'quote') {
                    return (
                        <blockquote key={idx} className="gm-md-callout">
                            {renderInlineMarkdown(block.text, streaming && isLast)}
                        </blockquote>
                    );
                }
                return (
                    <p key={idx} className="gm-md-p">
                        {renderInlineMarkdown(block.text, streaming && isLast)}
                        {streaming && isLast && <span className="gm-stream-cursor" aria-hidden="true" />}
                    </p>
                );
            })}
        </div>
    );
};

/**
 * Pi-Agent 风格可折叠思考块
 */
const ThinkingBlock = ({ text, isLive = false, elapsedMs = 0 }) => {
    const [open, setOpen] = useState(isLive);

    useEffect(() => {
        if (!isLive) setOpen(false);
    }, [isLive]);

    if (!text) return null;

    return (
        <div className="gm-thinking-block">
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
                <span className="inline-flex items-center gap-1.5">
                    {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <Cpu size={12} style={{ color: 'var(--primary)' }} />
                    <span>{isLive ? '正在推理思考…' : '思考过程'}</span>
                    <span className="gm-text-3">({text.length} 字)</span>
                </span>
                {elapsedMs > 0 && (
                    <span className="gm-text-3 tabular-nums">{(elapsedMs / 1000).toFixed(1)}s</span>
                )}
            </button>
            {open && (
                <div className="px-3 pb-2.5 pt-1 text-[11.5px] font-mono leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap border-t border-[var(--border-light)] max-h-56 overflow-y-auto">
                    {text}
                    {isLive && <span className="gm-stream-cursor" aria-hidden="true" />}
                </div>
            )}
        </div>
    );
};

const AgentView = ({ onNotify, onOpenSystemSettings, onOverviewChanged }) => {
    const [settings, setSettings] = useState(null);
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [input, setInput] = useState('');
    const [actingProposalKey, setActingProposalKey] = useState(null);

    // 实时流式状态（Pi Agent 风格：即时思考流 + 工具执行态 + Token 增量输出）
    const [liveStream, setLiveStream] = useState(null);
    const [elapsedMs, setElapsedMs] = useState(0);
    // 保留本会话每条助手消息对应的思考过程与工具调用轨迹
    const [traceByMsgId, setTraceByMsgId] = useState({});

    const liveStreamRef = useRef(null);
    const scrollBottomRef = useRef(null);

    useEffect(() => {
        liveStreamRef.current = liveStream;
    }, [liveStream]);

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

    // 监听 Tauri 后端发出的实时流式事件
    useEffect(() => {
        if (!isTauriRuntime()) return undefined;
        let unlisten = null;
        let active = true;

        (async () => {
            try {
                const mod = await import('@tauri-apps/api/event');
                if (!active || typeof mod?.listen !== 'function') return;
                unlisten = await mod.listen('agent-stream', (event) => {
                    const p = event?.payload;
                    if (!p || typeof p !== 'object') return;
                    setLiveStream(prev => {
                        if (!prev) return prev;
                        if (prev.streamId && p.stream_id && prev.streamId !== p.stream_id) {
                            return prev;
                        }
                        const streamId = prev.streamId || p.stream_id || null;
                        if (p.type === 'start') {
                            return { ...prev, streamId };
                        }
                        if (p.type === 'reasoning') {
                            return {
                                ...prev,
                                streamId,
                                phase: 'thinking',
                                reasoning: prev.reasoning + String(p.text || ''),
                            };
                        }
                        if (p.type === 'delta') {
                            return {
                                ...prev,
                                streamId,
                                phase: 'streaming',
                                content: prev.content + String(p.text || ''),
                            };
                        }
                        if (p.type === 'tool_start') {
                            return {
                                ...prev,
                                streamId,
                                phase: 'tool',
                                tools: [
                                    ...prev.tools,
                                    {
                                        id: `${p.tool}-${Date.now()}-${prev.tools.length}`,
                                        tool: p.tool,
                                        label: p.label || p.tool,
                                        status: 'running',
                                    },
                                ],
                            };
                        }
                        if (p.type === 'tool_done') {
                            const updated = [...prev.tools];
                            for (let idx = updated.length - 1; idx >= 0; idx -= 1) {
                                if (updated[idx].tool === p.tool && updated[idx].status === 'running') {
                                    updated[idx] = {
                                        ...updated[idx],
                                        status: p.ok === false ? 'error' : 'done',
                                    };
                                    break;
                                }
                            }
                            return { ...prev, streamId, tools: updated };
                        }
                        return prev;
                    });
                });
            } catch {
                // 非 Tauri 环境静默降级
            }
        })();

        return () => {
            active = false;
            if (typeof unlisten === 'function') unlisten();
        };
    }, []);

    // 流式输出计时器
    useEffect(() => {
        if (!sending || !liveStream?.startedAt) {
            setElapsedMs(0);
            return undefined;
        }
        const timer = setInterval(() => {
            setElapsedMs(Date.now() - liveStream.startedAt);
        }, 120);
        return () => clearInterval(timer);
    }, [sending, liveStream?.startedAt]);

    // 消息增加或流式更新时自动滚到底部
    useEffect(() => {
        scrollBottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
    }, [messages.length, liveStream?.content, liveStream?.reasoning, liveStream?.tools?.length]);

    const isConfigured = Boolean(settings?.baseUrl && settings?.model);

    const copyText = async (text, label = '内容') => {
        try {
            await navigator.clipboard.writeText(text);
            onNotify?.(`已复制${label}`);
        } catch {
            onNotify?.('复制失败', 'error');
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
            setTraceByMsgId({});
            onNotify?.('对话历史已清空');
        } else {
            onNotify?.(res.message || '清空失败', 'error');
        }
    };

    const handleStop = async () => {
        if (!sending || stopping) return;
        setStopping(true);
        try {
            if (typeof api?.cancelAgentStream === 'function') {
                await api.cancelAgentStream(liveStreamRef.current?.streamId || null);
            }
        } finally {
            setStopping(false);
        }
    };

    const handleSend = async (customText = null) => {
        let text = String(customText ?? input).trim();
        if (!text || sending) return;

        // 支持 Pi 风格斜杠快捷指令
        if (text === '/clear') {
            if (customText === null) setInput('');
            await handleClear();
            return;
        }
        const matchedSlash = SLASH_SHORTCUTS.find(item => item.cmd === text.toLowerCase());
        if (matchedSlash) {
            text = matchedSlash.prompt;
        }

        if (!isConfigured) {
            onNotify?.('请先配置 AI 模型接口地址与模型名称', 'error');
            onOpenSystemSettings?.('ai');
            return;
        }

        if (customText === null) setInput('');

        // 乐观立即上屏用户消息 + 立即展示流式占位区（不再等回答返回才看到自己发了什么）
        const optimisticId = `optimistic-user-${Date.now()}`;
        const optimisticUserMsg = {
            id: optimisticId,
            sessionId: 'default',
            role: 'user',
            content: text,
            proposals: [],
            createdAt: '',
        };
        const startedAt = Date.now();
        setMessages(prev => [...prev, optimisticUserMsg]);
        setLiveStream({
            streamId: null,
            phase: 'connecting',
            reasoning: '',
            content: '',
            tools: [],
            startedAt,
        });
        setSending(true);
        setStopping(false);

        try {
            const res = await api.sendAgentMessage(text);
            const finalTrace = liveStreamRef.current;
            const totalElapsed = Date.now() - startedAt;
            if (res.success && Array.isArray(res.data)) {
                setMessages(res.data);
                const lastMsg = res.data[res.data.length - 1];
                if (
                    lastMsg &&
                    lastMsg.role === 'assistant' &&
                    (finalTrace?.reasoning || (finalTrace?.tools && finalTrace.tools.length > 0))
                ) {
                    setTraceByMsgId(prev => ({
                        ...prev,
                        [lastMsg.id]: {
                            reasoning: finalTrace.reasoning || '',
                            tools: finalTrace.tools || [],
                            elapsedMs: totalElapsed,
                        },
                    }));
                }
            } else {
                // 请求前参数校验失败时撤回乐观气泡并恢复输入，防止消息丢失
                setMessages(prev => prev.filter(m => m.id !== optimisticId));
                if (customText === null) setInput(text);
                onNotify?.(res.message || '发送消息失败', 'error');
            }
        } finally {
            setLiveStream(null);
            setSending(false);
            setStopping(false);
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

    const maxTokensBadge = settings
        ? settings.maxTokens === 0
            ? 'AUTO'
            : settings.maxTokens >= 1000
                ? `${Math.round(settings.maxTokens / 1000)}K`
                : String(settings.maxTokens)
        : '';

    return (
        <div className="max-w-5xl mx-auto flex flex-col gap-3.5 h-[calc(100vh-106px)] gm-view-enter">
            {/* 头部 */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="gm-title flex items-center gap-2">
                        <Bot size={20} className="text-[var(--primary)]" />
                        <span>AI 数字资产助手</span>
                        <span className="gm-pixel-tag is-accent">PI-STREAM</span>
                    </h1>
                    <p className="gm-subtitle">
                        极简流式代理：基于本地严格脱敏元数据实时工具检索与推理；写操作生成可确认 Diff 提案。
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className="gm-btn gm-btn-ghost text-xs"
                        onClick={() => onOpenSystemSettings?.('ai')}
                    >
                        <SlidersHorizontal size={14} />
                        <span>
                            {isConfigured ? `${settings.model}${maxTokensBadge ? ` · ${maxTokensBadge}` : ''}` : '配置 AI 模型'}
                        </span>
                    </button>
                    {messages.length > 0 && (
                        <button
                            type="button"
                            className="gm-btn gm-btn-ghost text-xs text-[var(--danger)]"
                            onClick={handleClear}
                            disabled={sending}
                        >
                            <Trash2 size={14} />
                            清空对话
                        </button>
                    )}
                </div>
            </div>

            {/* 隐私隔离声明横幅 */}
            <div
                className="rounded-lg px-3.5 py-2 text-xs flex items-center gap-2.5 border border-[var(--border)]"
                style={{ background: 'var(--primary-light)', color: 'var(--text-primary)' }}
            >
                <ShieldCheck size={15} className="text-[var(--primary)] shrink-0" />
                <span>
                    隐私保护已启用：密码、2FA 密钥、短信接码地址、银行卡号/CVV、OAuth 令牌、SSH 私钥/口令及 Cloudflare Token
                    绝不会发送给外部模型；写操作均需人工确认。
                </span>
            </div>

            {!loading && !isConfigured && (
                <div className="gm-card gm-pixel-card p-5 flex flex-wrap items-center justify-between gap-4 border border-[var(--warning)]">
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
            <div className="gm-card gm-pixel-card flex-1 overflow-y-auto p-4 space-y-4">
                {loading ? (
                    <div className="py-12 text-center text-xs text-[var(--text-secondary)]">
                        正在加载历史对话...
                    </div>
                ) : messages.length === 0 && !liveStream ? (
                    <div className="py-8 space-y-5 text-center">
                        <Sparkles size={28} className="mx-auto text-[var(--primary)]" />
                        <div className="space-y-1">
                            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                                直接提问资产、费用、服务器巡检，或让代理生成续费提醒提案
                            </h2>
                            <p className="text-xs text-[var(--text-secondary)]">
                                支持流式推理输出、工具调用可视化与 <span className="font-mono">/summary</span> / <span className="font-mono">/renewals</span> / <span className="font-mono">/servers</span> 快捷指令：
                            </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-2xl mx-auto text-left">
                            {STARTER_PROMPTS.map(prompt => (
                                <button
                                    key={prompt}
                                    type="button"
                                    className="gm-card p-3 text-xs text-[var(--text-primary)] hover:border-[var(--primary)] transition-colors text-left cursor-pointer"
                                    onClick={() => handleSend(prompt)}
                                    disabled={sending}
                                >
                                    {prompt}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <>
                        {messages.map(msg => {
                            const isUser = msg.role === 'user';
                            const trace = traceByMsgId[msg.id];
                            const inlineSplit = isUser
                                ? { thinking: '', answer: msg.content }
                                : splitInlineThink(msg.content);
                            const combinedThinking = [trace?.reasoning, inlineSplit.thinking]
                                .filter(Boolean)
                                .join('\n\n');
                            const answerText = inlineSplit.answer || msg.content;

                            return (
                                <div
                                    key={msg.id}
                                    className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} gap-2`}
                                >
                                    {isUser ? (
                                        <div className="max-w-[85%] rounded-xl px-4 py-2.5 text-xs leading-relaxed whitespace-pre-wrap bg-[var(--primary)] text-white shadow-sm">
                                            {msg.content}
                                        </div>
                                    ) : (
                                        <div className="w-full max-w-[92%] space-y-2">
                                            {/* 工具执行轨迹胶囊 */}
                                            {trace?.tools?.length > 0 && (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {trace.tools.map(t => (
                                                        <span key={t.id} className="gm-tool-pill is-done">
                                                            <Check size={11} />
                                                            <span>{t.label}</span>
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            {/* 可折叠思考过程 */}
                                            {combinedThinking && (
                                                <ThinkingBlock
                                                    text={combinedThinking}
                                                    isLive={false}
                                                    elapsedMs={trace?.elapsedMs || 0}
                                                />
                                            )}

                                            {/* 助手回复正文（桌面原生 Markdown 排版） */}
                                            <div className="gm-agent-reply-card">
                                                <AgentMarkdown
                                                    content={answerText}
                                                    onCopyCode={(code) => copyText(code, '代码')}
                                                />
                                                <div className="mt-3 pt-2 border-t border-[var(--border-light)] flex items-center justify-between text-[10.5px] font-mono gm-text-3">
                                                    <span>
                                                        {settings?.model || 'assistant'}
                                                        {trace?.elapsedMs ? ` · ${(trace.elapsedMs / 1000).toFixed(1)}s` : ''}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => copyText(answerText, '回复内容')}
                                                        className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] cursor-pointer"
                                                    >
                                                        <Copy size={11} />
                                                        <span>复制</span>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}

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
                                                    className="w-full max-w-xl rounded-xl border border-[var(--border-strong)] bg-[var(--bg-panel)] p-4 space-y-3 text-xs"
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
                                                        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
                                                            <table className="w-full text-[11px]">
                                                                <thead>
                                                                    <tr className="bg-[var(--bg-elevated)] text-left text-[var(--text-secondary)]">
                                                                        <th className="px-2.5 py-1.5">字段</th>
                                                                        <th className="px-2.5 py-1.5">变更前</th>
                                                                        <th className="px-2.5 py-1.5">变更后</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="divide-y divide-[var(--border-light)]">
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
                        })}

                        {/* 实时流式输出气泡（立即呈现：连接状态 / 思考过程 / 工具调用 / 逐字回复） */}
                        {liveStream && (() => {
                            const liveSplit = splitInlineThink(liveStream.content);
                            const liveThinking = [liveStream.reasoning, liveSplit.thinking]
                                .filter(Boolean)
                                .join('\n\n');
                            const liveAnswer = liveSplit.answer;
                            const statusText =
                                liveStream.phase === 'tool'
                                    ? '正在调用本地脱敏工具…'
                                    : liveStream.phase === 'thinking' || (liveThinking && !liveAnswer)
                                        ? '模型正在深度推理…'
                                        : liveAnswer
                                            ? '正在流式输出…'
                                            : '等待模型首字响应…';

                            return (
                                <div className="flex flex-col items-start gap-2" aria-live="polite">
                                    <div className="w-full max-w-[92%] space-y-2">
                                        {/* 状态头 */}
                                        <div className="flex items-center gap-2 text-[11px] font-mono gm-text-2">
                                            <span className="gm-pixel-led is-primary gm-pixel-status-pulse" aria-hidden="true" />
                                            <span>{statusText}</span>
                                            <span className="gm-text-3 tabular-nums">
                                                {(elapsedMs / 1000).toFixed(1)}s
                                            </span>
                                        </div>

                                        {/* 实时工具调用胶囊 */}
                                        {liveStream.tools.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5">
                                                {liveStream.tools.map(t => (
                                                    <span
                                                        key={t.id}
                                                        className={`gm-tool-pill ${
                                                            t.status === 'running'
                                                                ? 'is-running'
                                                                : t.status === 'error'
                                                                    ? 'is-error'
                                                                    : 'is-done'
                                                        }`}
                                                    >
                                                        {t.status === 'running' ? (
                                                            <RefreshCw size={11} className="animate-spin" />
                                                        ) : (
                                                            <Check size={11} />
                                                        )}
                                                        <span>{t.label}</span>
                                                    </span>
                                                ))}
                                            </div>
                                        )}

                                        {/* 实时思考过程流 */}
                                        {liveThinking && (
                                            <ThinkingBlock
                                                text={liveThinking}
                                                isLive={!liveAnswer}
                                                elapsedMs={elapsedMs}
                                            />
                                        )}

                                        {/* 实时流式回复正文 */}
                                        <div className="gm-agent-reply-card is-streaming">
                                            <AgentMarkdown
                                                content={liveAnswer}
                                                streaming={true}
                                                onCopyCode={(code) => copyText(code, '代码')}
                                            />
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}
                    </>
                )}
                <div ref={scrollBottomRef} />
            </div>

            {/* 底部 Pi 风格快捷指令条 + 输入框 */}
            <div className="gm-card p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="inline-flex items-center gap-1 font-mono gm-text-3 mr-1">
                        <Terminal size={11} />
                        <span>快捷指令</span>
                    </span>
                    {SLASH_SHORTCUTS.map(item => (
                        <button
                            key={item.cmd}
                            type="button"
                            disabled={sending}
                            onClick={() => handleSend(item.prompt)}
                            className="px-2 py-0.5 rounded bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-mono transition-colors cursor-pointer"
                            title={item.prompt}
                        >
                            {item.cmd} · {item.label}
                        </button>
                    ))}
                </div>

                <form
                    className="flex items-end gap-2"
                    onSubmit={e => {
                        e.preventDefault();
                        handleSend();
                    }}
                >
                    <textarea
                        rows={2}
                        className="gm-input flex-1 text-xs resize-none"
                        placeholder="输入问题或让助手生成提醒/费用修改提案（Enter 发送，Shift+Enter 换行，支持 /summary /renewals /servers）..."
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
                    {sending ? (
                        <button
                            type="button"
                            onClick={handleStop}
                            disabled={stopping}
                            className="gm-btn gm-btn-danger text-xs px-4 py-2.5 shrink-0"
                            aria-label="停止生成"
                        >
                            <Square size={13} />
                            <span>{stopping ? '停止中...' : '停止'}</span>
                        </button>
                    ) : (
                        <button
                            type="submit"
                            className="gm-btn gm-btn-primary text-xs px-4 py-2.5 shrink-0"
                            disabled={!input.trim()}
                        >
                            <Send size={14} />
                            <span>发送</span>
                        </button>
                    )}
                </form>
            </div>
        </div>
    );
};

export default AgentView;
