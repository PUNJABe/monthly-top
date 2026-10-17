# Monthly Top

Monthly Top is a pay-to-rank community directory and leaderboard where people can submit a website, profile, tool, app, or project and pay to move it higher in its category. It is designed for lists like “Best AI tools,” “Top dev tools,” or “Best startup products,” where the ranking is driven by paid boosts rather than editorial selection.

This project is a working Node.js + Express website with SQLite for local development, optional managed PostgreSQL for durable deployments, demo checkout, Stripe checkout, optional YOUPI PG hosted UPI checkout, an admin interface, and public listing pages.

## What the site does

- Lets anyone submit a website or profile link
- Groups submissions into categories
- Shows a leaderboard for each category
- Lets users pay to boost a listing higher in the ranking
- Resets rankings each month
- Stores listings, boosts, and categories locally in SQLite
- Includes admin tools to review and manage listings, refunds, and contact messages
- Supports demo mode, Stripe, and YOUPI PG hosted UPI payments

## Example use cases

- Best AI tools list
- Top SaaS apps
- Startup discovery board
- Developer tool leaderboard
- Creator and product directory
- Monthly curated ranking website

## Features

- Public category pages with ranking tables
- Individual listing pages with metadata and boost history
- Monthly reset logic with timezone support
- Built-in category creation and custom categories
- Demo mode with simulated checkout when Stripe is not configured
- Admin area for moderation, payment handling, and category management
- Contact form and static legal pages
- No front-end build step required

## Tech stack

- Node.js
- Express
- SQLite via sql.js
- Stripe Checkout support
- Vanilla HTML/CSS/JS front-end
- No separate build pipeline required

## Project structure

- `server.js` – main backend and app logic
- `public/` – front-end pages and assets
- `admin/` – admin dashboard HTML
- `data/` – SQLite data directory
- `.env.example` – example environment variables
- `package.json` – scripts and dependencies

## Local development

### Install dependencies

```bash
npm install
```

### Start the app

Windows:

```bash
start.bat
```

Mac/Linux:

```bash
./start.sh
```

Or manually:

```bash
npm start
```

The app runs by default at:

```text
http://localhost:3000
```

## Environment variables

Copy `.env.example` to `.env` and configure values before going live.

Key settings include:

- `PAYMENT_PROVIDER` selects `demo`, `stripe`, or `youpi`. Locally it defaults to demo when Stripe is absent; on Vercel it defaults to unconfigured so missing credentials never create fake paid boosts.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` for Stripe payments
- `YOUPI_API_URL`, `YOUPI_MERCHANT_ID`, and `YOUPI_WEBHOOK_SECRET` for YOUPI PG payments
- `BASE_URL` for public links and payment return redirects
- `DATABASE_URL` for a pooled managed PostgreSQL connection. If unset, the app uses its local SQLite fallback.
- `ADMIN_PASSWORD` to enable the admin dashboard
- `DATAFAST_API_KEY` and `DATAFAST_WEBSITE_ID` for visitor analytics
- `CREATOR_NAME`, `CREATOR_HANDLE`, `CREATOR_URL`, `CREATOR_BIO`
- `SITE_TIMEZONE` for month-reset timing
- `DATA_DIR` for the local SQLite fallback

When no provider is configured, local development uses demo checkout. Vercel keeps demo listings visible but disables checkout and returns a setup error until a real payment provider and managed Postgres are configured.

### YOUPI PG setup

YOUPI PG is an external hosted gateway. Run it separately on a persistent Node.js host, then set `PAYMENT_PROVIDER=youpi`, `YOUPI_API_URL` to its HTTPS base URL, and `YOUPI_MERCHANT_ID` in this app's environment. Set `YOUPI_WEBHOOK_SECRET` only as a server-side secret and configure the gateway's webhook URL to `https://your-domain.example/api/youpi/webhook`. The app marks a boost paid only after a valid HMAC-signed webhook matches its payment ID, amount, and currency. Browser redirects do not confirm payment.

The YOUPI gateway's API, SQLite database, and banking observer services are not hosted by this Vercel app; deploy them on infrastructure that supports its persistent processes and observer connections.

On Vercel, connect managed PostgreSQL and set `DATABASE_URL` before accepting real payments. Vercel's `/tmp` SQLite fallback is only for development/demo use; it is neither durable nor shared across function instances. To preserve an existing SQLite dataset, import it once with `node scripts/import-sqlite.js path/to/data.db` after setting `DATABASE_URL`.

## Deployment

This project is a Node-based web app, so it should be deployed to a host that supports Express servers, not a static-only host.

Recommended options:

- Azure App Service
- Render
- Railway
- VPS with Node

For a custom domain:

1. Push the repo to GitHub
2. Deploy the app to a Node hosting service
3. Add your environment variables in the hosting dashboard
4. Point your domain DNS to the host
5. Enable HTTPS/SSL
6. Set `SITE_URL` to the live domain

## Admin panel

The admin area enables moderation and management of:

- listings
- boosts and refunds
- categories
- contact messages

Access is protected by `ADMIN_PASSWORD` when configured.

## Important notes

- This project is intended for public link submissions, so moderation is important.
- Real Stripe usage requires legal review of your rules, privacy policy, and refund policy.
- Demo mode is safe for testing, but real payments should only be enabled after configuration and review.
- Ranking is based on payment amount, not quality or merit.

## License

This project does not include a formal license file. If you plan to publish or redistribute it, check the repository owner and legal requirements before doing so.

## Summary

Monthly Top is a full-featured pay-to-rank listing website for showcasing and boosting products, profiles, tools, and links. It is designed to run locally, be deployed live, and be customized for your own category leaderboard or startup directory.
