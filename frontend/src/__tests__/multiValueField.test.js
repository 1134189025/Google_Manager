import { describe, it, expect } from 'vitest';
import {
  appendUniqueLine,
  normalizeMultiValueValue,
  splitGroupNameValues,
  splitRemarkValues,
} from '../utils/multiValueField';

describe('multiValueField utils', () => {
  it('groupName 同时兼容换行、逗号和旧空白分隔', () => {
    expect(splitGroupNameValues('工作,重点\n备用')).toEqual(['工作', '重点', '备用']);
    expect(splitGroupNameValues('主号 成员1 成员2')).toEqual(['主号', '成员1', '成员2']);
  });

  it('remark 按行拆分并去空去重', () => {
    expect(splitRemarkValues('第一条\n\n第二条\n第一条')).toEqual(['第一条', '第二条']);
    expect(normalizeMultiValueValue('remark', ' 第一条 \n第二条\n')).toBe('第一条\n第二条');
  });

  it('追加建议时不会重复追加已有值', () => {
    expect(appendUniqueLine('groupName', '工作', '工作')).toBe('工作');
    expect(appendUniqueLine('groupName', '工作', '重点')).toBe('工作\n重点');
  });
});
