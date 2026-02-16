# Splits - Development & Deployment Guide

## 🚀 Quick Start

### Frontend Development (React Native/Expo)

To see **frontend code changes** in real-time:

```bash
npm run dev
# OR
npm start
```

This clears the cache and starts Expo with auto-reload enabled.

**Platforms:**
- `npm run ios` - iOS Simulator
- `npm run android` - Android Emulator
- `npm run web` - Web Browser

---

## ▲ Vercel Deployment (Expo Web)

This repo is now wired for Vercel from the project root:
- Build command: `npm run build:web`
- Output directory: `dist`
- Config file: `vercel.json`

### Vercel Dashboard

1. Import this Git repo in Vercel.
2. Keep **Root Directory** as `.` (project root).
3. Add environment variables:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_EAS_PROJECT_ID` (optional)
4. Deploy.

### Vercel CLI

```bash
npm i -g vercel
vercel
vercel --prod
```

### Local parity check (same as Vercel build)

```bash
npm run build:web
```

---

## 🔧 Backend Development (Supabase Functions)

### First-Time Setup

1. **Install Supabase CLI:**
   ```bash
   npm install -g supabase
   ```

2. **Login to Supabase:**
   ```bash
   supabase login
   ```

3. **Link Your Project:**
   ```bash
   supabase link --project-ref nztqbqybfeyvrwmjjndp
   ```

4. **Set Environment Variables:**
   ```bash
   # Required: Gemini API key for OCR
   supabase secrets set GEMINI_API_KEY=your_key_here

   # Optional: Vision API as fallback
   supabase secrets set VISION_API_KEY=your_key_here
   ```

### Deploying Code Changes

After modifying Supabase functions (like the OCR improvements), deploy them:

```bash
# Deploy just the OCR function
npm run deploy:ocr

# OR deploy all functions
npm run deploy:all
```

**⚠️ Important:** Supabase functions must be deployed to production. Local file changes won't take effect until deployed!

---

## 📦 OCR System Architecture

The enhanced OCR system uses a multi-layer approach:

1. **Client-side preprocessing** ([imagePreprocessing.ts](src/lib/imagePreprocessing.ts))
   - Image enhancement (2000px resolution)
   - Quality optimization

2. **Server-side processing** ([ocr-receipt/index.ts](supabase/functions/ocr-receipt/index.ts))
   - **Layer 1:** Gemini Vision (95% confidence) - Sees image layout
   - **Layer 2:** Google Vision API → Gemini Text (75% confidence)
   - **Layer 3:** Regex fallback (50% confidence)
   - Retry logic with exponential backoff
   - Comprehensive validation (6 checks)

---

## 🐛 Troubleshooting

### "Changes not showing up"
- **Frontend:** Metro bundler auto-reloads. Try `npm run dev` (clears cache)
- **Backend:** You must deploy functions with `npm run deploy:ocr`

### "OCR not working"
1. Check Supabase secrets are set: `supabase secrets list`
2. Check function logs: `supabase functions logs ocr-receipt`
3. Verify API keys are valid

### "Module not found" errors
```bash
npm install
cd ios && pod install  # iOS only
```

---

## 📊 Monitoring OCR Performance

Check console logs for:
- **Method used:** `gemini-vision`, `gemini-text`, or `regex-fallback`
- **Confidence score:** 0.5 - 1.0
- **Validation warnings:** Alerts for suspicious data

View in Supabase Dashboard:
- Functions → ocr-receipt → Logs
