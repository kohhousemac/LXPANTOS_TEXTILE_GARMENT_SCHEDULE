#!/bin/sh
# Staff login: employee no. + password, approved people only.
# Run on the Mac:  cd ~/lxpantos_textile_garment_schedule/staff-alerts && sh deploy-access.sh
# Employee numbers are typed here, never committed (this repo is public).
set -e
cd "$(dirname "$0")"
git pull --ff-only
npm install --silent

# Pre-approved employee numbers: initial password 0000, each sets their own at first sign-in.
printf 'Approved employee numbers, comma-separated: '
read SEEDS
printf '%s' "$SEEDS" | npx wrangler secret put SEED_EMPNOS

# Admin employee number(s): they see the "Staff access" panel (approve / reset / remove).
printf 'Admin employee number(s), comma-separated: '
read ADMINS
printf '%s' "$ADMINS" | npx wrangler secret put ADMIN_EMPNOS

npx wrangler deploy
echo "Done: https://vessel-alert.pages.dev/"
