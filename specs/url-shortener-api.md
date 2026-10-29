# shortly — a URL shortener HTTP API

Build a small HTTP API in TypeScript that shortens URLs and redirects to them. State is kept in memory; it is lost when the process stops.

## Running

- The server listens on the port given by the environment variable `PORT`; default `3000`.
- Start it with `npm start` after `npm run build`.

## Endpoints

### `POST /links`

Request body is JSON: `{ "url": "<absolute http or https URL>" }`.

- On success respond `201` with JSON `{ "code": "<code>", "url": "<original url>", "shortUrl": "http://localhost:<port>/<code>" }`.
- `code` is 6 characters from `[a-zA-Z0-9]`, unique among existing links.
- Shortening the same URL twice returns the same code with status `200` instead of `201`.
- A missing or invalid `url` (not absolute, not http/https) responds `400` with JSON `{ "error": "invalid_url" }`.
- A body that is not JSON responds `400` with `{ "error": "invalid_json" }`.

### `GET /:code`

- Known code: respond `302` with the `Location` header set to the original URL and increment the hit counter.
- Unknown code: respond `404` with `{ "error": "not_found" }`.

### `GET /links/:code`

- Known code: respond `200` with `{ "code", "url", "hits": <number of redirects so far>, "createdAt": "<ISO-8601>" }`.
- Unknown code: `404` with `{ "error": "not_found" }`.

### `DELETE /links/:code`

- Known code: respond `204` and forget the link; later `GET /:code` is `404`.
- Unknown code: `404` with `{ "error": "not_found" }`.

## General rules

- Every error response is JSON with a single `error` field holding a stable snake_case code.
- Responses carry `Content-Type: application/json` except the `302` redirect and the `204`.
- Unknown routes respond `404` with `{ "error": "not_found" }`.

## Non-goals

- No persistence, authentication, rate limiting or custom codes.

## Acceptance

`npm run build` compiles, `npm test` passes. Tests may start the server on an ephemeral port.
