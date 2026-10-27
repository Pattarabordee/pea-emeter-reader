import { expect, test } from 'vitest';
import { version } from './main';

test('smoke', () => {
  expect(1 + 1).toBe(2);
  expect(typeof version).toBe('string');
});
