#!/bin/bash
# One-time: turn on MBL arrival tracking (homepage footer form).
# Usage (on the Mac, in this folder):  ./deploy-mbl.sh <TRACKER_TOKEN>
set -e
cd "$(dirname "$0")"
git pull -q
[ -n "$1" ] || { echo "usage: ./deploy-mbl.sh <TRACKER_TOKEN>"; exit 1; }
npm install --silent --no-audit --no-fund
printf '%s' "$1" | npx wrangler secret put TRACKER_TOKEN
npx wrangler deploy
curl -s https://staff.lxpantosfashion.co.kr/api/mbl/carriers | head -c 120; echo
echo "OK — MBL tracking is live."
