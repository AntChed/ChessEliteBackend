export type NicknameValidationResult =
  | { nickname: string; success: true }
  | { code: 'INVALID_NICKNAME'; message: string; success: false };

const minNicknameLength = 3;
const maxNicknameLength = 20;

export function validateNickname(value: unknown): NicknameValidationResult {
  if (typeof value !== 'string') {
    return {
      code: 'INVALID_NICKNAME',
      message: 'Nickname must be a string',
      success: false,
    };
  }

  const nickname = value.trim();

  if (nickname.length < minNicknameLength || nickname.length > maxNicknameLength) {
    return {
      code: 'INVALID_NICKNAME',
      message: `Nickname must be between ${minNicknameLength} and ${maxNicknameLength} characters`,
      success: false,
    };
  }

  if (/[\p{Cc}\p{Cf}]/u.test(nickname)) {
    return {
      code: 'INVALID_NICKNAME',
      message: 'Nickname cannot contain control characters',
      success: false,
    };
  }

  return {
    nickname,
    success: true,
  };
}

export function createDefaultNickname() {
  return `Player${Math.floor(1000 + Math.random() * 9000)}`;
}

