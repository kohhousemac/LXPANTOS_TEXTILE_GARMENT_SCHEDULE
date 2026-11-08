# Booking Vessel Alerts (LX Pantos staff only)

Operations staff register a new booking (customer → route → vessel → booking no.). If another sailing on the same route (POL→POD) will **arrive earlier than the booked vessel** (for example because the booked vessel is delayed), the people on the booking get a "review vessel change" e-mail.

Recipients: the booker who registered it + that customer's HQ PIC (set once per customer in the HQ PIC section at the bottom of the page, auto-copied on every alert). All must be `@lxpantos.com`.

- Opening screen: the booker picks their country (Vietnam, Indonesia, China, Hong Kong, Taiwan, Korea), then their e-mail from that country's list (editable on the same screen). The chosen e-mail is the booker who gets the alerts. Only that country's POLs are offered. For **Korea** the list is Korean staff plus every HQ PIC. Remembered in the browser, changeable from the header.
- Customers: SAE-A, HANSOLL, YAKJIN, SHINWON, HANSAE, SSTS, NOBRAND (`CUSTOMERS` in `src/worker.js`)
- Schedules: the homepage's own data, `build/data/<route>.json` (lxpantosfashion.co.kr)
- Access: Cloudflare Access — only people who verify an `@lxpantos.com` address with a one-time code can open the page
- Storage: bookings live only in Cloudflare KV. This GitHub repo is public, so booking numbers never go into it.
- Mail: sent from the company shared mailbox through Microsoft Graph

## Alert rule

Every 3 hours each active booking is checked. A mail is sent when the same route has a sailing that

- arrives before the booked vessel's current ETA,
- departs on or after the booked ETD (an earlier ship may leave before the cargo is ready), and
- is not ⛔ booking-closed and has not sailed.

This applies whether or not the booked vessel itself has been delayed; the mail says so when it has.

The same situation is mailed only once. A new mail goes out when the ETA slips further or the list of faster sailings changes. Once the booked vessel sails, checks stop and the booking disappears from the list after 30 days.

**Find booking** (top of the page): search by booking number to see everything registered, then
- **Change vessel** — rebook onto another sailing on the same route; alerts restart from the new vessel's ETA, and the change is kept in the booking's history.
- **Cancel booking** — stops alerts; the booking stays visible as Cancelled for 30 days.

## One-time setup

### 1. Deploy to Cloudflare
```bash
cd staff-alerts
npm install
npx wrangler login
npx wrangler kv namespace create BOOKINGS   # put the printed id in wrangler.toml (REPLACE_WITH_KV_ID)
npx wrangler deploy                         # put the printed https://....workers.dev URL in PAGE_URL
```

### 2. Company e-mail login (Cloudflare Zero Trust, free up to 50 users)
1. Cloudflare dashboard → Zero Trust → create a team name (e.g. `lxpantos` → `lxpantos.cloudflareaccess.com`)
2. Settings → Authentication → enable **One-time PIN**
3. Access → Applications → Add → Self-hosted
   - Domain: the workers.dev URL above
   - Policy: Allow, Include → **Emails ending in** `@lxpantos.com`
4. Put the application's **Application Audience (AUD) Tag** in `ACCESS_AUD` and the team domain in `ACCESS_TEAM_DOMAIN`, then `npx wrangler deploy` again

### 3. Sending mail (request to IT)
Microsoft disables password-based SMTP by default from the end of December 2026, so this uses the Graph API. Ask IT for:

> Register an app in Entra ID → API permission: Microsoft Graph **Mail.Send (Application)** + admin consent → create a client secret.
> Please limit the app to sending from one shared mailbox only (Exchange RBAC for Applications or ApplicationAccessPolicy).
> Please send me: tenant ID, client ID, client secret, sender address.

Then:
```bash
npx wrangler secret put MS_CLIENT_SECRET    # enter the secret here only, never in a file
```
Fill `MS_TENANT_ID`, `MS_CLIENT_ID`, `MAIL_SENDER` in `wrangler.toml`, set `MAIL_MODE = "graph"`, and `npx wrangler deploy`. Use the **Send test mail** button at the top right of the page to confirm.

## Local testing
```bash
npm test                       # comparison logic tests (includes every real lane file)
printf 'DEV_USER_EMAIL=me@lxpantos.com\n' > .dev.vars
npx wrangler dev --test-scheduled
# browser: http://localhost:8787   run a check: curl "http://localhost:8787/__scheduled?cron=15+*/3+*+*+*"
```
`DEV_USER_EMAIL` skips login on localhost only. `.dev.vars` is not committed.
