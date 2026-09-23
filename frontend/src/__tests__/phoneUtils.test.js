import { describe, it, expect } from 'vitest';
import { normalizePhoneNumber, splitPhoneParts, formatCountryDisplay } from '../utils/phoneUtils';

describe('phoneUtils', () => {
    describe('normalizePhoneNumber', () => {
        it('支持常见输入格式并归一化到 E.164 风格', () => {
            expect(normalizePhoneNumber('138 1234 5678')).toBe('+8613812345678');
            expect(normalizePhoneNumber('138-1234-5678')).toBe('+8613812345678');
            expect(normalizePhoneNumber('+86 138 1234 5678')).toBe('+8613812345678');
            expect(normalizePhoneNumber('0086 13812345678')).toBe('+8613812345678');
            expect(normalizePhoneNumber('011442070313000')).toBe('+442070313000');
            expect(normalizePhoneNumber('US 2192731268')).toBe('+12192731268');
            expect(normalizePhoneNumber('CN 中国 (+86) 13812345678')).toBe('+8613812345678');
        });

        it('中国 1[3-9] 号段默认视为 +86，避免误判为 +1', () => {
            expect(normalizePhoneNumber('19876543210')).toBe('+8619876543210');
            expect(normalizePhoneNumber('+1 987 654 3210')).toBe('+19876543210');
        });
    });

    describe('splitPhoneParts', () => {
        it('拆分国家码与本地号码', () => {
            expect(splitPhoneParts('+8613812345678')).toEqual({
                countryCode: '+86',
                localNumber: '13812345678',
                normalized: '+8613812345678',
            });

            expect(splitPhoneParts('+12192731268')).toEqual({
                countryCode: '+1',
                localNumber: '2192731268',
                normalized: '+12192731268',
            });
        });
    });

    describe('formatCountryDisplay', () => {
        it('输出标准国别展示文案', () => {
            expect(formatCountryDisplay('+86')).toBe('CN 中国 (+86)');
            expect(formatCountryDisplay('+1')).toBe('US 美国 (+1)');
            expect(formatCountryDisplay('+999')).toBe('INTL 国际 (+999)');
        });
    });
});
