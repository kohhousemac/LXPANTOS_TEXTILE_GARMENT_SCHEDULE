# Booking Vessel Alerts (LX Pantos staff only)

Operations staff register a new booking (customer → route → vessel → booking no.). If another sailing on the same route (POL→POD) will **arrive earlier than the booked vessel** (for example because the booked vessel is delayed), the people on the booking get a "review vessel change" e-mail.

Recipients: the booker who registered it + that customer's HQ PIC (set once per customer in the HQ PIC section at the bottom of the page, auto-copied on every alert). All must be `@lxpantos.com`.

- Opening screen: the booker picks their country (Vietnam, Indonesia, China, Hong Kong, Taiwan, Korea), then their e-mail from that country's list (editable on the same screen). The chosen e-mail is the booker who gets the alerts. Only that country's POLs are offered. For **Korea** (HQ, oversees everything) the list is Korean staff plus every HQ PIC, and every POL is offered. Remembered in the browser, changeable from the header.
- Customers: SAE-A, HANSOLL, YAKJIN, SHINWON, HANSAE, SSTS, NOBRAND (`CUSTOMERS` in `src/worker.js`)
- Schedules: the homepage's own data, `build/data/<route>.json` (lxpantosfashion.co.kr)
- Access: the opening screen is one box, the **employee number** (secret `STAFF_PASSWORDS`, JSON `{"e-mail": "employee no."}`). No flags or names are shown. Overseas staff have no numbers yet, so for now they use "Overseas office? Sign in with name": their name (the e-mail ID, e.g. the part before @) must be on an overseas booker list, plus the shared `STAFF_PASSWORD`. Each person's office country comes from those lists (anyone else is Korea). A signed cookie tied to the e-mail keeps the browser in for a year. 5 wrong tries from one IP lock it for an hour.
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
npx wrangler deploy                         # Worker (PAGE_URL = https://vessel-alert.pages.dev/)
(cd proxy && npx wrangler pages deploy --branch main)   # front door on our own domain
```

### 2. Staff password
```bash
npx wrangler secret put STAFF_PASSWORD    # the shared password
openssl rand -base64 48 | npx wrangler secret put SESSION_SECRET
```
To change the password later, run the first line again; everyone has to enter the new one.

Korea employee numbers (replaces the whole list each time, so include everyone):
```bash
printf '%s' '{"name@lxpantos.com":"1234"}' | npx wrangler secret put STAFF_PASSWORDS
```

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

## Address: vessel-alert.pages.dev

Company networks block `*.workers.dev`, and the user wanted no company name in the
address, so staff use https://vessel-alert.pages.dev/. `proxy/` is a Cloudflare Pages
project (`vessel-alert`) that forwards every request to the Worker over a service binding.
Deploy it with `cd proxy && npx wrangler pages deploy --branch main`.

The older front door, Pages project `lxpantosstaff` on staff.lxpantosfashion.co.kr
(Gabia `staff CNAME lxpantosstaff.pages.dev.`), still works but is no longer linked.

## MBL arrival tracking (homepage footer)

The footer of lxpantosfashion.co.kr has a form: **MBL No. + carrier + @lxpantos.com e-mail + optional CC (up to 5 @lxpantos.com addresses)**. CC people get every mail too (real Cc header); registering the same MBL + e-mail again adds the new CC addresses. The person gets a confirmation mail, then a report mail every morning until the carrier shows the cargo arrived at POD (then a final mail and tracking ends). Every mail has a "Stop tracking" link.

- Code: `src/mbl.js` (wired into `src/worker.js`). Requests live in KV under `t:<id>`, never in this public repo.
- Carriers offered: every carrier the schedule pages collect (`CARRIERS` in `src/mbl.js`, `MBL_CARRIERS` in `build/build.py` — keep both lists the same).
- Limits: 30 active per e-mail, 20 new per IP per day, 300 active in total; stops after 5 days in a row "not found" or 90 days.
- Who reads the carrier sites: a Claude scheduled task on the Mac mini ("MBL 도착 추적 데일리"), every morning. It opens https://vessel-alert.pages.dev/ in the browser, reads `GET /api/mbl/queue` (header `x-tracker-token`), looks each MBL up on the carrier's own tracking page with the site-safety rules, and posts `POST /api/mbl/<id>/report` `{status: in_transit|not_departed|arrived|not_found|blocked, vessel, voyage, pol, pod, etd, atd, eta, ata, transshipment, events[{date,location,event,vessel,voyage}], summary, sourceUrl}`. The Worker sends the mail (once per day per MBL; a repeated "blocked" is not re-mailed).
- One-time setup: `./deploy-mbl.sh <TRACKER_TOKEN>` (sets the `TRACKER_TOKEN` secret and deploys). The same token is in the scheduled task's prompt.
