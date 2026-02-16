# Splits PWA

This is a static PWA MVP with the receipt → allocate → send flow.

## Run locally
From `pwa/`:

```bash
python3 -m http.server 5173
```

Then open `http://localhost:5173`.

You can also use:

```bash
npx serve .
```

## Notes
- OCR is mocked on image upload (it loads the sample receipt data).
- Add real OCR by calling the Supabase `ocr-receipt` Edge Function and replacing the mock load in `app.js`.
- The UI is intentionally a single-screen flow to hit the 30-second goal.
