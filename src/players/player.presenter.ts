import type { Player } from './player.types.js';

export function presentPlayer(player: Player) {
  return {
    id: player.id,
    nickname: player.nickname,
  };
}

