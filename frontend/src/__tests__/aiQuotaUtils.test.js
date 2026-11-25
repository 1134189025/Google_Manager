import { describe, it, expect } from 'vitest';
import {
    buildQuotaDisplayModel,
    getQuotaRemainingPercent,
    getQuotaLevel,
} from '../utils/aiQuotaUtils';

describe('aiQuotaUtils 额度展示模型', () => {
    it('空窗口或缺失 usage 时返回空 flat 模型', () => {
        expect(buildQuotaDisplayModel(null, 'gemini')).toEqual({
            mode: 'flat',
            groups: [],
            flatWindows: [],
            credits: [],
        });
        expect(buildQuotaDisplayModel({ windows: [] }, 'openai')).toEqual({
            mode: 'flat',
            groups: [],
            flatWindows: [],
            credits: [],
        });
    });

    it('OpenAI 订阅含 gpt-5-codex 附加限额时保持 flat，不丢弃主限额与余额', () => {
        const usage = {
            source: 'openai-wham',
            windows: [
                { label: 'primary_window', usedPercent: 18, windowSeconds: 18000 },
                { label: 'secondary_window', usedPercent: 42, windowSeconds: 604800 },
                { label: 'code_review', usedPercent: 10, windowSeconds: 604800 },
                { label: 'gpt-5-codex / 5h', model: 'gpt-5-codex', usedPercent: 25, windowSeconds: 18000 },
                { label: 'credits', remaining: 12.5, unit: 'USD' },
            ],
        };

        const model = buildQuotaDisplayModel(usage, 'openai');
        expect(model.mode).toBe('flat');
        expect(model.groups).toEqual([]);
        expect(model.credits).toEqual([]);
        expect(model.flatWindows).toHaveLength(5);
        expect(model.flatWindows.map(w => w.label)).toEqual([
            'primary_window',
            'secondary_window',
            'code_review',
            'gpt-5-codex / 5h',
            'credits',
        ]);
    });

    it('Claude 与 Grok 订阅即便含 five_hour/seven_day 或模型词也不进入 Gemini 分组', () => {
        const claudeUsage = {
            source: 'claude-oauth',
            windows: [
                { label: 'five_hour', usedPercent: 30, windowSeconds: 18000 },
                { label: 'seven_day_opus', model: 'claude-opus', usedPercent: 12, windowSeconds: 604800 },
            ],
        };
        const grokUsage = {
            source: 'grok-api',
            windows: [
                { label: 'grok-3 / 5h', model: 'grok-3', usedPercent: 5, windowSeconds: 18000 },
                { label: 'gpt-compat / weekly', model: 'gpt-4', usedPercent: 8, windowSeconds: 604800 },
            ],
        };

        expect(buildQuotaDisplayModel(claudeUsage, 'claude').mode).toBe('flat');
        expect(buildQuotaDisplayModel(claudeUsage, 'claude').flatWindows).toHaveLength(2);
        expect(buildQuotaDisplayModel(grokUsage, 'grok').mode).toBe('flat');
        expect(buildQuotaDisplayModel(grokUsage, 'grok').flatWindows).toHaveLength(2);
    });

    it('Gemini 聚合双分组、过滤 argon/carbon 次要池并单独保留 credits/* 积分', () => {
        const usage = {
            source: 'gemini-cloudcode',
            windows: [
                { label: 'Gemini 5小时额度', model: 'gemini-5h', usedPercent: 15, windowSeconds: 18000 },
                { label: 'Gemini 周额度', model: 'gemini-weekly', usedPercent: 80, windowSeconds: 604800 },
                { label: 'Claude 5小时额度', model: '3p-5h', usedPercent: 92, windowSeconds: 18000 },
                { label: 'Claude 周额度', model: '3p-weekly', usedPercent: 10, windowSeconds: 604800 },
                { label: 'Gemini Argon Pool', model: 'gemini-argon', usedPercent: 99, windowSeconds: 18000 },
                { label: 'Claude Carbon Pool', model: 'claude-carbon', usedPercent: 99, windowSeconds: 604800 },
                { label: 'credits/GOOGLE_ONE_AI', remaining: 500, unit: 'credits' },
                { label: 'Gemini 2.5 Pro', model: 'gemini-2.5-pro', usedPercent: 15 },
            ],
        };

        const model = buildQuotaDisplayModel(usage, 'gemini');
        expect(model.mode).toBe('grouped');
        expect(model.flatWindows).toEqual([]);
        expect(model.groups).toHaveLength(2);

        expect(model.groups[0].id).toBe('gemini');
        expect(model.groups[0].items.map(i => [i.key, i.remainingPercent, i.level])).toEqual([
            ['gemini-weekly', 20, 'low'],
            ['gemini-5h', 85, 'normal'],
        ]);

        expect(model.groups[1].id).toBe('claude-gpt');
        expect(model.groups[1].items.map(i => [i.key, i.remainingPercent, i.level])).toEqual([
            ['claude-weekly', 90, 'normal'],
            ['claude-5h', 8, 'crit'],
        ]);

        expect(model.credits).toEqual([
            { label: 'credits/GOOGLE_ONE_AI', remaining: 500, unit: 'credits' },
        ]);
    });

    it('Gemini 仅返回分模型明细无周/5h标签时按 pickMostConstrained 回退当前限额', () => {
        const usage = {
            source: 'gemini-cloudcode',
            windows: [
                { label: 'Gemini 2.5 Flash', model: 'gemini-2.5-flash', usedPercent: 12 },
                { label: 'Gemini 2.5 Pro', model: 'gemini-2.5-pro', usedPercent: 64 },
                { label: 'Claude Sonnet', model: 'claude-sonnet', usedPercent: 20 },
                { label: 'Claude Opus', model: 'claude-opus', usedPercent: 55 },
            ],
        };

        const model = buildQuotaDisplayModel(usage, 'gemini');
        expect(model.mode).toBe('grouped');
        expect(model.groups[0].items).toHaveLength(1);
        expect(model.groups[0].items[0]).toMatchObject({
            key: 'gemini-fallback',
            label: '当前限额',
            usedPercent: 64,
            remainingPercent: 36,
        });
        expect(model.groups[1].items).toHaveLength(1);
        expect(model.groups[1].items[0]).toMatchObject({
            key: 'claude-fallback',
            label: '当前限额',
            usedPercent: 55,
            remainingPercent: 45,
        });
    });

    it('Gemini 仅包含未知模型或仅积分窗口时回退 flat 模式，不丢弃数据', () => {
        const usage = {
            source: 'gemini-cloudcode',
            windows: [
                { label: 'custom-vision-v1', model: 'custom-vision-v1', usedPercent: 30 },
                { label: 'credits/default', remaining: 100, unit: 'credits' },
            ],
        };

        const model = buildQuotaDisplayModel(usage, 'gemini');
        expect(model.mode).toBe('flat');
        expect(model.groups).toEqual([]);
        expect(model.flatWindows).toHaveLength(2);
    });

    it('安全处理 NaN / Infinity / 越界百分比，不产出非法数值', () => {
        expect(getQuotaRemainingPercent({ usedPercent: Number.NaN })).toBeNull();
        expect(getQuotaRemainingPercent({ usedPercent: Number.POSITIVE_INFINITY })).toBeNull();
        expect(getQuotaRemainingPercent({ usedPercent: -20 })).toBe(100);
        expect(getQuotaRemainingPercent({ usedPercent: 145 })).toBe(0);
        expect(getQuotaLevel(null)).toBe('normal');
        expect(getQuotaLevel(10)).toBe('crit');
        expect(getQuotaLevel(25)).toBe('low');
        expect(getQuotaLevel(25.1)).toBe('normal');

        const model = buildQuotaDisplayModel(
            {
                source: 'gemini-cloudcode',
                windows: [
                    { label: 'Gemini 周额度', model: 'gemini-weekly', usedPercent: Number.NaN, windowSeconds: 604800 },
                    { label: 'Gemini 5小时额度', model: 'gemini-5h', usedPercent: Number.POSITIVE_INFINITY, windowSeconds: 18000 },
                    { label: 'Claude 周额度', model: '3p-weekly', usedPercent: 130, windowSeconds: 604800 },
                    { label: 'Claude 5小时额度', model: '3p-5h', usedPercent: -15, windowSeconds: 18000 },
                ],
            },
            'gemini',
        );

        expect(model.mode).toBe('grouped');
        const [gemWeekly, gem5h] = model.groups[0].items;
        expect(gemWeekly.usedPercent).toBeNull();
        expect(gemWeekly.remainingPercent).toBeNull();
        expect(gem5h.usedPercent).toBeNull();
        expect(gem5h.remainingPercent).toBeNull();

        const [clWeekly, cl5h] = model.groups[1].items;
        expect(clWeekly.remainingPercent).toBe(0);
        expect(clWeekly.level).toBe('crit');
        expect(cl5h.remainingPercent).toBe(100);
        expect(cl5h.level).toBe('normal');
    });
});
