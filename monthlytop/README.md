# Monthly Top

A public leaderboard where anyone can pay to push a link to the top of its category for the month. Profiles (GitHub, LinkedIn, Instagram, YouTube, X, TikTok and more), websites, apps, AI models, repos: if it has a link, it can be listed. Every category has its own ranking. The more you pay, the higher you rank. Rankings reset each calendar month (India time by default) and the winners are archived.

**Stack:** Node 18+, Express, SQLite (pure-JavaScript sql.js, nothing to compile), Stripe Checkout. No build step.

## Run it

- Windows: double-click `start.bat`
- Mac/Linux: `./start.sh`

It installs what it needs, starts on http://localhost:3000 and opens your browser. With no keys set it runs in **demo mode**: checkout is simulated, nothing real is charged, and demo entries are labelled.

## Going live

Copy `.env.example` to `.env` and fill in:

| Setting | What it does |
|---|---|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Turns on real payments. Webhook URL: `https://YOUR-DOMAIN/api/webhook` (event `checkout.session.completed`). |
| `SITE_URL` | Your public address, used for Stripe return links. |
| `ADMIN_PASSWORD` | Enables `/admin` (HTTP Basic auth). Without it, admin is off. |
| `DATAFAST_WEBSITE_ID`, `DATAFAST_API_KEY` | Visitor counts from DataFast. Without them a built-in cookieless counter is used. |
| `CREATOR_*` | Fills the creator section on the About page. Empty shows a placeholder. |
| `SITE_TIMEZONE` | Decides when a month ends (default `Asia/Kolkata`). |
| `DATA_DIR` | Where the database lives. Point it at persistent storage on a host. |

**Switching from demo to live deletes all demo data** (demo boosts, listings and categories) on startup, so fake entries never reach the real chart.

Fill in the `[BRACKETED]` fields in `terms.html`, `privacy.html`, `refunds.html` and `contact.html` (business name, address, contact email, governing law) and have a lawyer review them before taking real money. In Stripe, turn on customer receipt emails.

## How it works

- **Boosting:** paste a link, add a name and a short description, pick a category or create one, choose an amount. Whole rupees only, minimum ₹10, maximum ₹9,99,999 (stored in paise).
- **Listings:** each link is one listing with a canonical key, so `github.com/x`, `www.github.com/x/` and `github.com/x?tab=repos` are the same listing. Paying again adds to it.
- **Details are locked to the first payer.** Later payers add money but cannot rename or recategorise. Admin can edit.
- **Categories:** 33 built in. A newly typed category is created only after the payment completes. Capped at 500 custom categories.
- **Unpaid listings** are hidden and deleted after 3 days.
- **Logos:** websites use Google's favicon service, GitHub uses its avatar, others get a lettered tile (disclosed in the privacy page).
- **Data:** one SQLite file at `data/data.db`. Back it up.
- **Upgrading from the songs version:** the old database is copied to `data.db.songs-backup` and fresh tables are created.

Refused links: chat/invite links, URL shorteners, adult-content patterns, IP addresses, localhost, custom ports, embedded credentials, non-http(s) schemes.

## Admin (`/admin`)

Payments and refunds, listings (edit, recategorise, hide), categories (rename, delete), and contact messages.

## Before you launch

- **Moderation is your job.** Anyone can list any public link, so expect spam, scams and impersonation. Each listing has a Report link that lands in admin messages.
- **Check Stripe's rules** for your country and business type; pay-to-rank sites can get extra review. Keep the Rules and Refunds pages accurate.
- **Not tested here:** real Stripe charges, the DataFast API, the Google favicon service. These need your keys and internet access.
- Rank shows who paid most, not who is best. Don't describe it otherwise.
