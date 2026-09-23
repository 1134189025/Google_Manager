// frontend/src/__tests__/utils.test.ts

import { describe, it, expect } from 'vitest';
import { snakeToCamel, camelToSnake } from '../services/utils';

describe('snakeToCamel', () => {
  it('应该转换基本对象的 snake_case 键为 camelCase', () => {
    const input = {
      user_name: 'test',
      email_address: 'test@example.com',
      is_active: true,
    };
    const expected = {
      userName: 'test',
      emailAddress: 'test@example.com',
      isActive: true,
    };
    expect(snakeToCamel(input)).toEqual(expected);
  });

  it('应该转换嵌套对象', () => {
    const input = {
      user_info: {
        first_name: 'John',
        last_name: 'Doe',
        contact_info: {
          phone_number: '123456',
        },
      },
    };
    const expected = {
      userInfo: {
        firstName: 'John',
        lastName: 'Doe',
        contactInfo: {
          phoneNumber: '123456',
        },
      },
    };
    expect(snakeToCamel(input)).toEqual(expected);
  });

  it('应该转换数组中的对象', () => {
    const input = {
      user_list: [
        { user_name: 'Alice', user_id: 1 },
        { user_name: 'Bob', user_id: 2 },
      ],
    };
    const expected = {
      userList: [
        { userName: 'Alice', userId: 1 },
        { userName: 'Bob', userId: 2 },
      ],
    };
    expect(snakeToCamel(input)).toEqual(expected);
  });

  it('应该处理 null 值', () => {
    expect(snakeToCamel(null as any)).toBeNull();
  });

  it('应该处理 undefined 值', () => {
    expect(snakeToCamel(undefined as any)).toBeUndefined();
  });

  it('应该处理原始类型', () => {
    expect(snakeToCamel('string' as any)).toBe('string');
    expect(snakeToCamel(123 as any)).toBe(123);
    expect(snakeToCamel(true as any)).toBe(true);
  });

  it('应该处理空对象', () => {
    expect(snakeToCamel({})).toEqual({});
  });

  it('应该处理空数组', () => {
    expect(snakeToCamel([] as any)).toEqual([]);
  });

  it('应该处理混合数组（对象和原始类型）', () => {
    const input = [
      { user_name: 'Alice' },
      'plain string',
      123,
      { item_id: 456 },
    ];
    const expected = [
      { userName: 'Alice' },
      'plain string',
      123,
      { itemId: 456 },
    ];
    expect(snakeToCamel(input as any)).toEqual(expected);
  });

  it('应该保留没有下划线的键', () => {
    const input = {
      name: 'test',
      age: 25,
      email: 'test@example.com',
    };
    expect(snakeToCamel(input)).toEqual(input);
  });

  it('应该处理多个下划线的键', () => {
    const input = {
      very_long_variable_name: 'value',
    };
    const expected = {
      veryLongVariableName: 'value',
    };
    expect(snakeToCamel(input)).toEqual(expected);
  });
});

describe('camelToSnake', () => {
  it('应该转换基本对象的 camelCase 键为 snake_case', () => {
    const input = {
      userName: 'test',
      emailAddress: 'test@example.com',
      isActive: true,
    };
    const expected = {
      user_name: 'test',
      email_address: 'test@example.com',
      is_active: true,
    };
    expect(camelToSnake(input)).toEqual(expected);
  });

  it('应该转换嵌套对象', () => {
    const input = {
      userInfo: {
        firstName: 'John',
        lastName: 'Doe',
        contactInfo: {
          phoneNumber: '123456',
        },
      },
    };
    const expected = {
      user_info: {
        first_name: 'John',
        last_name: 'Doe',
        contact_info: {
          phone_number: '123456',
        },
      },
    };
    expect(camelToSnake(input)).toEqual(expected);
  });

  it('应该转换数组中的对象', () => {
    const input = {
      userList: [
        { userName: 'Alice', userId: 1 },
        { userName: 'Bob', userId: 2 },
      ],
    };
    const expected = {
      user_list: [
        { user_name: 'Alice', user_id: 1 },
        { user_name: 'Bob', user_id: 2 },
      ],
    };
    expect(camelToSnake(input)).toEqual(expected);
  });

  it('应该处理 null 值', () => {
    expect(camelToSnake(null as any)).toBeNull();
  });

  it('应该处理 undefined 值', () => {
    expect(camelToSnake(undefined as any)).toBeUndefined();
  });

  it('应该处理原始类型', () => {
    expect(camelToSnake('string' as any)).toBe('string');
    expect(camelToSnake(123 as any)).toBe(123);
    expect(camelToSnake(true as any)).toBe(true);
  });

  it('应该处理空对象', () => {
    expect(camelToSnake({})).toEqual({});
  });

  it('应该处理空数组', () => {
    expect(camelToSnake([] as any)).toEqual([]);
  });

  it('应该处理混合数组（对象和原始类型）', () => {
    const input = [
      { userName: 'Alice' },
      'plain string',
      123,
      { itemId: 456 },
    ];
    const expected = [
      { user_name: 'Alice' },
      'plain string',
      123,
      { item_id: 456 },
    ];
    expect(camelToSnake(input as any)).toEqual(expected);
  });

  it('应该保留全小写的键', () => {
    const input = {
      name: 'test',
      age: 25,
      email: 'test@example.com',
    };
    expect(camelToSnake(input)).toEqual(input);
  });

  it('应该处理多个大写字母的键', () => {
    const input = {
      veryLongVariableName: 'value',
    };
    const expected = {
      very_long_variable_name: 'value',
    };
    expect(camelToSnake(input)).toEqual(expected);
  });

  it('应该处理连续大写字母', () => {
    const input = {
      HTTPSConnection: 'secure',
      XMLParser: 'fast',
    };
    const expected = {
      _h_t_t_p_s_connection: 'secure',
      _x_m_l_parser: 'fast',
    };
    expect(camelToSnake(input)).toEqual(expected);
  });
});

describe('snakeToCamel 和 camelToSnake 互逆性', () => {
  it('camelToSnake(snakeToCamel(obj)) 应该等于 obj', () => {
    const original = {
      user_name: 'test',
      email_address: 'test@example.com',
      user_info: {
        first_name: 'John',
        phone_number: '123',
      },
    };
    const result = camelToSnake(snakeToCamel(original));
    expect(result).toEqual(original);
  });

  it('snakeToCamel(camelToSnake(obj)) 应该等于 obj', () => {
    const original = {
      userName: 'test',
      emailAddress: 'test@example.com',
      userInfo: {
        firstName: 'John',
        phoneNumber: '123',
      },
    };
    const result = snakeToCamel(camelToSnake(original));
    expect(result).toEqual(original);
  });
});
