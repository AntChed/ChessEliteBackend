import assert from 'node:assert/strict';
import test from 'node:test';

import { createJoinCode, isValidJoinCode, normalizeJoinCode } from './joinCode.js';

test('createJoinCode returns a safe six-character code', () => {
  for (let index = 0; index < 100; index += 1) {
    assert.match(createJoinCode(), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  }
});

test('normalizeJoinCode accepts lowercase and trims spaces', () => {
  const code = createJoinCode();

  assert.equal(normalizeJoinCode(` ${code.toLowerCase()} `), code);
  assert.equal(isValidJoinCode(code), true);
});

test('isValidJoinCode rejects ambiguous characters', () => {
  assert.equal(isValidJoinCode('OOO111'), false);
  assert.equal(isValidJoinCode('ABCDEF'), true);
});
