#!/bin/bash
set -e

npm install
npx drizzle-kit push --force
node scripts/seed-id-sequences.cjs
