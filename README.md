# ÉLUE website (v1)

Landing page, four product pages, a cart, and a checkout that:

1. sends a 6-digit code to the customer's WhatsApp (OTPIQ),
2. checks the code,
3. posts the order to your Telegram group.

No database, no login, no accounts. Nothing about the customer is stored on
the server. The cart is kept in the customer's own browser until the order
goes through.

Built with Next.js 16 (App Router). Pages are pre-rendered static HTML;
only the two small API routes run on the server.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no `.env.local` the site runs in dev mode:

- the WhatsApp code is shown on the page and printed in the terminal,
- the order is printed in the terminal instead of going to Telegram.

## Where things are

| What | File |
| --- | --- |
| Flavors, kcal, prices, descriptions, photos | `lib/products.ts` |
| WhatsApp number, Instagram, payment note | `lib/site.ts` |
| Landing page text | `app/page.tsx` |
| Product page | `app/products/[slug]/page.tsx` |
| Cart + checkout screens | `components/OrderFlow.tsx` |
| Colours and type | `app/globals.css` (tokens at the top) |
| Send the code | `app/api/send-code/route.ts` |
| Check the code, send to Telegram | `app/api/place-order/route.ts` |

### Adding product photos

Put the files in `public/products/` (e.g. `carrot.jpg`, roughly 1200×1500,
portrait), then set `image: "/products/carrot.jpg"` on that product in
`lib/products.ts`. Until a photo is set, the site draws the jar label.

## Links for Instagram stories

Each flavor has a short link that opens its product page:

- `/dark-chocolate`, `/carrot`, `/hazelnut`, `/peanut-butter`

Add `?ref=` to see where an order came from in Telegram, e.g.
`/hazelnut?ref=story-oct` or `/carrot?ref=creatorname`.

## Fonts and SEO

- Fonts are self-hosted from npm (`@fontsource/tajawal`, `@fontsource-variable/bodoni-moda`),
  so the site makes no request to Google Fonts.
- Pages are pre-rendered to HTML at build time, so search engines see the full
  content without running JavaScript.
- `app/sitemap.ts` and `app/robots.ts` generate `/sitemap.xml` and `/robots.txt`.
  Product pages include Google product data (price in IQD, photo, availability).
- The public address comes from Vercel's production domain automatically.
  Set `NEXT_PUBLIC_SITE_URL` only if you need to override it.

## How the code check works without a database

`/api/send-code` creates a random code and sends it on WhatsApp. It returns a
token holding the phone number, an expiry time (5 minutes), and
`HMAC(OTP_SECRET, phone:code:expiry)`. The code itself is not in the token.

`/api/place-order` recomputes that HMAC from what the customer typed. If it
matches and hasn't expired, the order is sent. Changing the phone or the
expiry inside the token breaks the match.

## If Telegram fails

`place-order` tries Telegram up to 3 times (about 3 seconds in total). If it
still fails, or the customer's connection drops, the page shows
"أرسل الطلب بالواتساب": it opens WhatsApp to your number with the whole order
already written. The cart is not cleared, so nothing is lost.

## Setup for production

### 1. Telegram

1. Message @BotFather, send `/newbot`, copy the token.
2. Create a group for orders and add the bot.
3. Send any message in the group, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id`
   (a negative number, usually starting with `-100`).
   If nothing shows up, send `/start@YourBotName` in the group and reload.

### 2. OTPIQ

Create a project at https://app.otpiq.com, top up the balance, copy the API
key. Set a spending limit on the project so bots can't drain the balance.
Codes come from OTPIQ's own WhatsApp sender. If you later connect ELUE's own
WhatsApp number in OTPIQ, change `codeSenderNote` in `lib/site.ts`.

### 3. Deploy (Vercel)

1. Push this folder to GitHub and import it on vercel.com.
2. Add the four variables from `.env.example` in Project → Settings →
   Environment Variables.
3. Deploy. Commercial sites need the Pro plan on Vercel.

## Known limits of v1 (on purpose)

- No order history: if the Telegram message is lost, the order exists only on
  the customer's phone (WhatsApp fallback).
- A code is checked without a database, so there's no "3 wrong tries" lock.
  The 5-minute expiry and OTPIQ's own per-number limits are the protection.
- Returning customers enter their number and get a new code every time.
