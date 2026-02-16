#!/bin/bash

# Deploy OCR Function to Supabase
# This script deploys the enhanced OCR system with all improvements

set -e  # Exit on error

echo "🚀 Deploying Enhanced OCR System..."
echo ""

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found!"
    echo "Install it with: npm install -g supabase"
    exit 1
fi

# Check if logged in
if ! supabase projects list &> /dev/null; then
    echo "❌ Not logged in to Supabase!"
    echo "Run: supabase login"
    exit 1
fi

echo "📦 Deploying ocr-receipt function..."
supabase functions deploy ocr-receipt --no-verify-jwt

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📊 To view logs, run:"
echo "   supabase functions logs ocr-receipt"
echo ""
echo "🔑 Don't forget to set your API keys if you haven't already:"
echo "   supabase secrets set GEMINI_API_KEY=your_key_here"
echo "   supabase secrets set VISION_API_KEY=your_key_here"
