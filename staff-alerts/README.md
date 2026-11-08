# Booking Vessel Alerts (LX Pantos staff only)

Operations staff register a new booking (customer → route → vessel → booking no.). If another sailing on the same route (POL→POD) will **arrive earlier than the booked vessel** (for example because the booked vessel is delayed), the people on the booking get a "review vessel change" e-mail.

Recipients: the booker who registered it + that customer's HQ PIC (set once per customer in the HQ PIC section at the bottom of the page, auto-copied on every alert). All must be `@lxpantos.com`.

- Opening screen: the booker picks their country (Vietnam, Indonesia, China, Hong Kong, Taiwan, Korea), then their e-mail from that country's list (editable on the same screen). The chosen e-mail is the booker who gets the alerts. Only that country's POLs are offered. For **Korea** the list is Korean staff plus every HQ PIC. Remembered in the browser, changeable from the header.
- Customers: SAE-A, HANSOLL, YAKJIN, SHINWON, HANSAE, SSTS, NOBRAND (`CUSTOMERS` in `src/worker.js`)
- Schedules: the homepage's own data, `build/data/<route>.json` (lxpantosfashion.co.kr)
- Access: opening screen is country → booker e-mail → **shared staff password** (secret `STAFF_PASSWORD`). A signed cookie keeps the browser in for a year; changing the password signs everyone out. 5 wrong tries from one IP lock it for an hour. The country/e-mail lists are visible before the password; bookings are not.
- Storage: bookings live only in Cloudflare KV. This GitHub repo is public, so booking numbers never go into it.
- Mail: sent from Gmail (kohhousemac@gmail.com, shown as "LX Pantos Vessel Alerts") over SMTP with an app password

## Alert rule

Every day at 09:00 KST each active booking is checked. A mail is sent when the same route has a sailing that

- arrives before the booked vessel's current ETA,
- departs on or after the booked ETD (an earlier ship may leave before the cargo is ready), and
- is not ⛔ booking-closed and has not sailed.

This applies whether or not the booked vessel itself has been delayed; the mail says so when it has.

The same situation is mailed only once. A new mail goes out when the ETA slips further or the list of faster sailings changes. Once the booked vessel sails, the booking is deleted and no more alerts go out. HQ PICs and Korea bookers get the mail in Korean; overseas bookers in English.

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

### 2. Staff password
```bash
npx wrangler secret put STAFF_PASSWORD    # the shared password
openssl rand -base64 48 | npx wrangler secret put SESSION_SECRET
```
To change the password later, run the first line again; everyone has to enter the new one.

### 3. Sending mail (Gmail)
1. On the Google account (2-Step Verification on), create an **app password**: https://myaccount.google.com/apppasswords
2. Cloudflare dashboard → Workers & Pages → lxpantosfashionstaff → Settings → Variables and Secrets → Add → type **Secret**, name `SMTP_PASS`, value = the 16-letter app password.
3. Set `MAIL_MODE = "gmail"` in `wrangler.toml` and `npx wrangler deploy`. Use **Send test mail** on the page to confirm.

Gmail allows about 500 recipients a day, far more than this needs.

## Local testing
```bash
npm test                       # comparison logic tests (includes every real lane file)
printf 'STAFF_PASSWORD=test\nSESSION_SECRET=dev\n' > .dev.vars
npx wrangler dev --test-scheduled
# browser: http://localhost:8787   run a check: curl "http://localhost:8787/__scheduled?cron=15+*/3+*+*+*"
```
`.dev.vars` is not committed.
