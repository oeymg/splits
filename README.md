# Splits

Receipt-first bill splitting. No finance dashboards.

## What’s in here
- Expo React Native (TypeScript) app with a single flow: group → receipt → items → allocation → summary → send.
- Supabase schema scaffold for users, groups, receipts, line items, and allocations.
- OCR stub that returns structured data so you can ship UI before wiring Vision/LLM.

## Quick start
1. Install deps

```bash
npm install
```

2. Add Supabase keys

```bash
cp .env.example .env
```

Optional (for push tokens on EAS builds): add `EXPO_PUBLIC_EAS_PROJECT_ID` to `.env`.

3. Run

```bash
npm run start
```

## Notes
- This is intentionally a single-screen flow to keep “photo → send” under 30 seconds.
- OCR runs via Supabase Edge Function (`ocr-receipt`) and falls back to mock data if not configured.
- Push notifications use Expo Push + Supabase Edge Functions. Each recipient must enable push to register their device token, and phone numbers must match.

## Supabase
- Apply `supabase/schema.sql` to your project.
- Storage bucket: create `receipts` (public or signed URLs).
- Deploy functions:
  - `ocr-receipt` (Google Vision OCR)
  - `register-device` (store Expo push tokens)
  - `send-push` (send push to registered phones)

### Function secrets (Supabase)
- `SUPABASE_SERVICE_ROLE_KEY` (required for `ocr-receipt`, `register-device`, `send-push`)
- `VISION_API_KEY` (Google Cloud Vision)
- `VISION_FEATURE_TYPE` (optional, `TEXT_DETECTION` or `DOCUMENT_TEXT_DETECTION`)
- `RECEIPTS_BUCKET` (optional, defaults to `receipts`)

Copy `supabase/.env.example` to `supabase/.env` if you use the Supabase CLI locally.
# splits
