import { randomInt } from 'node:crypto';

const joinCodeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const joinCodeLength = 6;
const joinCodePattern = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5,6}$/;

export function createJoinCode() {
  let code = '';

  for (let index = 0; index < joinCodeLength; index += 1) {
    code += joinCodeAlphabet[randomInt(joinCodeAlphabet.length)];
  }

  return code;
}

export function normalizeJoinCode(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function isValidJoinCode(value: string) {
  return joinCodePattern.test(value);
}

