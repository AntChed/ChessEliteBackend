CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY,
  nickname VARCHAR(20) NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY,
  join_code VARCHAR(8) NOT NULL UNIQUE,
  white_player_id UUID NOT NULL REFERENCES players(id),
  black_player_id UUID NULL REFERENCES players(id),
  status VARCHAR(16) NOT NULL,
  fen TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  winner_player_id UUID NULL REFERENCES players(id),
  result VARCHAR(24) NULL,
  white_piece_skin VARCHAR(64) NULL,
  black_piece_skin VARCHAR(64) NULL,
  board_skin VARCHAR(64) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT games_status_check CHECK (status IN ('WAITING', 'ACTIVE', 'FINISHED', 'CANCELLED')),
  CONSTRAINT games_result_check CHECK (
    result IS NULL OR result IN (
      'WHITE_WIN',
      'BLACK_WIN',
      'DRAW',
      'RESIGNATION',
      'STALEMATE',
      'CHECKMATE'
    )
  )
);

CREATE TABLE IF NOT EXISTS moves (
  id UUID PRIMARY KEY,
  move_id UUID NOT NULL UNIQUE,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id),
  move_number INTEGER NOT NULL,
  from_square VARCHAR(2) NOT NULL,
  to_square VARCHAR(2) NOT NULL,
  promotion VARCHAR(1) NULL,
  san VARCHAR(32) NULL,
  fen_after TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT moves_from_square_check CHECK (from_square ~ '^[a-h][1-8]$'),
  CONSTRAINT moves_to_square_check CHECK (to_square ~ '^[a-h][1-8]$'),
  CONSTRAINT moves_promotion_check CHECK (promotion IS NULL OR promotion IN ('q', 'r', 'b', 'n'))
);

CREATE INDEX IF NOT EXISTS games_join_code_idx ON games(join_code);
CREATE INDEX IF NOT EXISTS games_white_player_id_idx ON games(white_player_id);
CREATE INDEX IF NOT EXISTS games_black_player_id_idx ON games(black_player_id);
CREATE INDEX IF NOT EXISTS games_status_idx ON games(status);
CREATE INDEX IF NOT EXISTS moves_game_id_idx ON moves(game_id);
CREATE INDEX IF NOT EXISTS moves_player_id_idx ON moves(player_id);
