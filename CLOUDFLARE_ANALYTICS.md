# Cloudflare Web Analytics Setup

## Overview
DrawRace PWA includes Cloudflare Web Analytics integration for basic usage telemetry. This uses the free tier which is:
- **Cookie-less** - No cookies or local storage
- **No PII** - No personally identifiable information collected
- **Lightweight** - Minimal performance impact (~1KB script loaded from CDN)
- **Privacy-first** - GDPR, CCPA compliant

## Current Status
✅ Analytics script added to `apps/web/index.html`  
⚠️ **Requires activation** - Replace placeholder token with your Cloudflare Analytics token

## Activation Options

### Option 1: Cloudflare Pages Dashboard (Recommended)
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Pages** → **drawrace** project
3. Click on **Analytics** tab
4. Enable **Cloudflare Web Analytics**
5. The script token will be automatically configured

### Option 2: Manual Token Setup
1. Go to [Cloudflare Web Analytics](https://dash.cloudflare.com/sign-up)
2. Add your site: `drawrace.pages.dev`
3. Copy your **Tracking Token**
4. Replace `YOUR_CLOUDFLARE_ANALYTICS_TOKEN` in `apps/web/index.html`:
   ```html
   <script defer src='https://static.cloudflareinsights.com/beacon.min.js' 
           data-cf-beacon='{"token": "YOUR_ACTUAL_TOKEN"}'></script>
   ```

## Bundle Impact
The analytics script is loaded separately from the main bundle:
- **Script size**: ~1KB (gzipped, loaded from Cloudflare CDN)
- **Bundle impact**: 0KB (not included in `dist/assets/index-*.js`)
- **Load method**: Async/defer, non-blocking

## Data Collected
Basic page view metrics only:
- Page views
- Unique visitors
- Geographic data (country/city level)
- Browser/device type
- Referrer information

## Compliance
- **GDPR compliant** - No consent needed (no cookies/PII)
- **CCPA compliant** - No personal data sale
- **COPPA compliant** - No data collection from children

## Testing
After activation, verify analytics are working:
1. Visit `https://drawrace.pages.dev`
2. Check Cloudflare Analytics dashboard
3. Should see page view appear within ~1 minute

## Future Enhancements
Consider adding:
- Custom event tracking (race completion, wheel drawing, etc.)
- Funnel analysis (draw → race → result flow)
- Performance metrics (Core Web Vitals)
- A/B testing framework

## Resources
- [Cloudflare Web Analytics Docs](https://developers.cloudflare.com/analytics/web-analytics/)
- [Privacy Policy](https://www.cloudflare.com/privacypolicy/)
- [GDPR Compliance](https://developers.cloudflare.com/analytics/web-analytics/reference-guide/gdpr/)
