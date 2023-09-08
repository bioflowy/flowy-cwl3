import { describe, expect, test } from 'vitest';
import { evaluator, get_js_engine } from './expression.js';
describe('expression', () => {
  test('regex_eval', async () => {
    const js_engine = get_js_engine();
    const r1 = await evaluator(js_engine, '$(test)', { test: 123 }, '', false);
    expect(r1).toBe(123);
    const r2 = await evaluator(js_engine, '$(test.prop1)', { test: { prop1: 123 } }, '', false);
    expect(r2).toBe(123);
    const r3 = await evaluator(js_engine, '$(test[2])', { test: [1, 2, 3, 4] }, '', false);
    expect(r3).toBe(3);
    const r4 = await evaluator(js_engine, "$(test['prop1'])", { test: { prop1: 123 } }, '', false);
    expect(r4).toBe(123);
    const r5 = await evaluator(js_engine, '$(test["prop1"])', { test: { prop1: 123 } }, '', false);
    expect(r5).toBe(123);
    const r6 = await evaluator(js_engine, '$(test.length)', { test: [1, 2, 3, 4] }, '', false);
    expect(r6).toBe(4);
  });
});
