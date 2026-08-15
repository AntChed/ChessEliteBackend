import assert from 'node:assert/strict';
import test from 'node:test';

import { validateNickname } from './nickname.js';

test('validateNickname trims a valid nickname', () => {
  const result = validateNickname('  Antoine  ');

  assert.equal(result.success, true);

  if (result.success) {
    assert.equal(result.nickname, 'Antoine');
  }
});

test('validateNickname rejects invalid values', () => {
  assert.equal(validateNickname(null).success, false);
  assert.equal(validateNickname('ab').success, false);
  assert.equal(validateNickname('a'.repeat(21)).success, false);
  assert.equal(validateNickname('Eva\u0000Ma').success, false);
});
