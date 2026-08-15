import type { Game } from './game.types.js';

export type GameEvent =
  | {
      game: Game;
      type: 'GAME_FINISHED';
    }
  | {
      game: Game;
      type: 'GAME_STATE_UPDATED';
    };

type GameEventListener = (event: GameEvent) => void;

const listeners = new Set<GameEventListener>();

export function subscribeGameEvents(listener: GameEventListener) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function publishGameEvent(event: GameEvent) {
  for (const listener of listeners) {
    listener(event);
  }
}

export function publishGameFinished(game: Game) {
  publishGameEvent({
    game,
    type: 'GAME_FINISHED',
  });
}

export function publishGameStateUpdated(game: Game) {
  publishGameEvent({
    game,
    type: 'GAME_STATE_UPDATED',
  });
}

