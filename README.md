# Chess Elite Backend

Node.js / TypeScript backend for Chess Elite online multiplayer V1.

## Local commands

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

## Environment

Copy `.env.example` to `.env` for local development.

`DATABASE_URL` and `JWT_SECRET` are included now so Railway configuration has a stable target, but the initial skeleton can start without a database connection.

## Current endpoints

```http
GET /health
GET /api
WS /ws
```

The multiplayer REST and WebSocket protocol will be implemented incrementally from `MULTIPLAYER_ONLINE_V1_SPEC.md`.

