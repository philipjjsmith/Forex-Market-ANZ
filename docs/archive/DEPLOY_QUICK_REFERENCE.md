# Quick Deployment Reference
## Split Architecture: Cloudflare (Frontend) + Vercel (Backend)

---

## 🚀 Deploy Backend to Vercel

```bash
# 1. Login
vercel login

# 2. Deploy
vercel --prod

# 3. Copy your Vercel URL (you'll need it for Cloudflare)
# Example: https://forex-market-anz.vercel.app
```

**Set these environment variables in Vercel Dashboard**:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`
- `SESSION_SECRET`
- `FOREX_API_KEY`
- `FOREX_API_PROVIDER`
- `FOREX_API_BASE_URL`
- `NODE_ENV=production`

---

## 🌐 Deploy Frontend to Cloudflare Pages

```bash
# 1. Login
wrangler login

# 2. Build
npm run build

# 3. Deploy
wrangler pages deploy dist/public --project-name=marketwatchpro-frontend
```

**Set this environment variable in Cloudflare Dashboard**:
- `VITE_API_URL` = Your Vercel URL from above

---

## ✅ Verification

1. Visit your Cloudflare Pages URL
2. Try to login/register
3. Check browser Network tab - API calls should go to Vercel
4. Start auto-trader and verify trades save to Supabase

---

## 📝 Files Changed for Split Deployment

- ✅ `vercel.json` - Backend-only configuration
- ✅ `wrangler.toml` - Frontend-only configuration
- ✅ `api/index.js` - Vercel serverless function wrapper
- ✅ `client/public/_headers` - CORS headers for Cloudflare
- ✅ `client/src/config/api.ts` - Uses `VITE_API_URL` env var
- ✅ `client/src/lib/auth.ts` - Uses `VITE_API_URL` env var

---

## 🔄 To Switch from Render to Vercel

1. Deploy to Vercel (see above)
2. Update `VITE_API_URL` in Cloudflare to point to Vercel
3. Done! No code changes needed.

---

**Full docs**: See `DEPLOYMENT_SPLIT.md`
