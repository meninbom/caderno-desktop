import { describe, it, expect } from 'vitest';
import { mergeAttributes } from '@tiptap/core';

describe('Tiptap mergeAttributes prototype-safety regression', () => {
  it('keeps attacker __proto__ as inert own data and never inherits executable DOM attrs', () => {
    const attacker = JSON.parse('{"__proto__":{"data-canary":"present","src":"x-invalid://canary","onerror":"globalThis.__tiptapXss += 1"}}');
    const merged = mergeAttributes(attacker, { class: 'safe' });

    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(merged, '__proto__')).toBe(true);
    expect(Object.keys(merged)).toEqual(['__proto__', 'class']);
    expect(({} as Record<string, unknown>).onerror).toBeUndefined();
    expect(({} as Record<string, unknown>)['data-canary']).toBeUndefined();
    expect(merged.class).toBe('safe');
  });
});
