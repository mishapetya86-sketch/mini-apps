# SavdoAI Barber Mini App

Mobile-first React + TypeScript shell for the SavdoAI barbershop Telegram Mini App.

## Local development

```sh
pnpm install
pnpm dev
```

Copy `.env.example` to `.env.local`. Set `VITE_MOCK=true` to run the browser demo; mock mode is guarded by `import.meta.env.DEV` and is disabled in production builds. The demo includes block, unblock, and cancel flows without contacting the backend.

Set `VITE_API_BASE_URL` to the Railway API base (including `/api/v1`) when integrating the backend. `VITE_DEV_ADMIN_KEY` is read only by development API code and must never be set for production.

## Backend contract

Request and response DTOs in `src/api/types.ts` were checked against the read-only backend repository at `Desktop/system-ai2`. Services and barbers use the exact API projections; slots and day-overview share the same `{ date, timezone, slots }` payload. A barber is resolved by looking up the validated Telegram user ID in the Barber table; an allowed Telegram user without a Barber row is treated as an owner. There is no `/me` endpoint or returned role field. Omitting `barberId` returns aggregate availability with `freeBarberIds`, `barberStatuses`, and a single representative busy booking at most; an individual barber query is used for full booking details. A booking is repeated on each 30-minute slot it overlaps.

The backend `main.ts` explicitly permits `x-telegram-init-data` in `allowedHeaders`. Production CORS still requires the deployed Mini App origin to be listed in `CORS_ORIGINS`.

## Schedule and actions

For a live app, set `VITE_API_BASE_URL` to the backend URL ending in `/api/v1`; the Mini App sends Telegram `initData` as `x-telegram-init-data`. The schedule polls every 5 seconds while visible and refreshes when the app regains focus. Owner polling requests the aggregate day plus each barber's day so summaries and booking cards include every master.

Run `pnpm test` for money/time formatting, repeated-slot merging, and new-booking diff coverage. Run `pnpm build` to typecheck and create the production bundle in `dist`.

### Manual verification

In mock mode, block a free slot with each duration, then unblock it; open a confirmed card, check its phone link, and cancel it through the confirmation step. To verify polling and haptics, open the live Mini App in Telegram and create a client booking in the bot; it should appear on the next poll, highlight briefly, and show a toast.

## Telegram preview and deployment

Telegram Mini Apps require HTTPS. Preview through a Vercel preview deployment or an HTTPS tunnel such as cloudflared/ngrok. Deploy this Vite app to Vercel with build command `pnpm build` and output directory `dist`; `vercel.json` includes the SPA rewrite.

After deploy:

1. Set the Vercel URL in the backend Railway variables `CORS_ORIGINS` and `MINI_APP_URL`, then redeploy the backend. Its `main.ts` already permits `x-telegram-init-data` in CORS `allowedHeaders`.
2. The bot shows its **Open Barber Mini App** button when `MINI_APP_URL` is set.
3. Optionally set the BotFather menu button with `/setmenubutton` to the same URL.
