# Chess Elite Backend

Node.js / TypeScript backend for Chess Elite online multiplayer V1.

## Local commands

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm run migrate
npm run smoke
```

## Environment

Copy `.env.example` to `.env` for local development.

`DATABASE_URL` is required for migrations and player endpoints. The server can still start without it, but `/health` will report `database: "not_configured"` and database-backed endpoints will return `DATABASE_NOT_CONFIGURED`.

`JWT_SECRET` is required before calling anonymous authentication endpoints. Generate a local secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`npm run migrate` requires `DATABASE_URL`. It creates a `schema_migrations` table and applies each SQL file in `src/db/migrations` once, inside a transaction.

Example local `.env`:

```bash
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/chess_elite
JWT_SECRET=replace-this-with-a-generated-secret
```

## Local PostgreSQL test flow

Create a local PostgreSQL database named `chess_elite`, then run:

```bash
npm install
npm run migrate
npm run smoke
npm run dev
```

`npm run smoke` starts the API on a temporary local port, checks the current REST flow against PostgreSQL, then deletes the test data it created.

`npm test` runs unit tests, an HTTP integration scenario, and a WebSocket integration scenario against PostgreSQL. Integration tests require `DATABASE_URL` and `JWT_SECRET`; they start the server on temporary local ports and delete only the rows they create.

With the server running on port `3000`, these PowerShell commands exercise the auth flow manually:

```powershell
Invoke-RestMethod -Method Get -Uri http://localhost:3000/health

$created = Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/api/players/anonymous

$created

Invoke-RestMethod `
  -Method Patch `
  -Uri http://localhost:3000/api/players/me `
  -Headers @{ Authorization = "Bearer $($created.token)" } `
  -ContentType "application/json" `
  -Body '{"nickname":"Antoine"}'
```

Manual game flow:

```powershell
$white = Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/players/anonymous
$black = Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/players/anonymous

$game = Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/api/games `
  -Headers @{ Authorization = "Bearer $($white.token)" }

$game

Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/api/games/join `
  -Headers @{ Authorization = "Bearer $($black.token)" } `
  -ContentType "application/json" `
  -Body "{`"joinCode`":`"$($game.game.joinCode)`"}"

Invoke-RestMethod `
  -Method Get `
  -Uri "http://localhost:3000/api/games/$($game.game.id)" `
  -Headers @{ Authorization = "Bearer $($white.token)" }

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:3000/api/games/$($game.game.id)/moves" `
  -Headers @{ Authorization = "Bearer $($white.token)" } `
  -ContentType "application/json" `
  -Body "{`"moveId`":`"$(New-Guid)`",`"from`":`"e2`",`"to`":`"e4`"}"

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:3000/api/games/$($game.game.id)/resign" `
  -Headers @{ Authorization = "Bearer $($black.token)" }
```

## Current endpoints

```http
GET /health
GET /api
POST /api/players/anonymous
PATCH /api/players/me
POST /api/games
POST /api/games/join
GET /api/games/:gameId
POST /api/games/:gameId/moves
POST /api/games/:gameId/resign
WS /ws
```

## WebSocket protocol

Connect with the anonymous token in the query string:

```text
ws://localhost:3000/ws?token=<token>
```

Current client messages:

```json
{ "type": "PING" }
{ "type": "JOIN_GAME", "gameId": "..." }
{ "type": "MOVE", "gameId": "...", "moveId": "...", "from": "e2", "to": "e4" }
{ "type": "RESIGN", "gameId": "..." }
```

Current server messages:

```text
PONG
PLAYER_JOINED
GAME_STATE
MOVE_ACCEPTED
MOVE_REJECTED
GAME_FINISHED
ERROR
```

The multiplayer REST and WebSocket protocol will be implemented incrementally from `MULTIPLAYER_ONLINE_V1_SPEC.md`.
