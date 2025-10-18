# Credential Reference Guide

This file documents where credentials and access information are stored for the Forex Market ANZ project.

## Database

**Supabase PostgreSQL**
- **Project URL**: https://supabase.com/dashboard/project/bgfucdqnncvanznvcste
- **Connection String**: Stored in `.env` as `DATABASE_URL`
- **Supabase URL**: Stored in `.env` as `SUPABASE_URL`
- **Service Role Key**: Stored in `.env` as `SUPABASE_SERVICE_ROLE_KEY`
- **Dashboard Login**: GitHub OAuth (philipsmith33105@gmail.com)
- **Project ID**: bgfucdqnncvanznvcste

## API Keys

**ExchangeRate-API** (Forex Data Provider)
- **Dashboard**: https://app.exchangerate-api.com/dashboard
- **API Key**: Stored in `.env` as `FOREX_API_KEY`
- **Account Email**: philipsmith33105@gmail.com
- **Free Tier**: 1,500 requests/month

**Google OAuth** (Optional - For Social Login)
- **Console**: https://console.cloud.google.com/apis/credentials
- **Client ID**: Stored in `.env` as `GOOGLE_CLIENT_ID`
- **Client Secret**: Stored in `.env` as `GOOGLE_CLIENT_SECRET`
- **Account**: philipsmith33105@gmail.com
- **Status**: Currently not configured (optional feature)

## Deployment Platforms

**GitHub**
- **Repository**: https://github.com/philipjjsmith/Forex-Market-ANZ
- **Account Email**: philipsmith33105@gmail.com
- **Username**: philipjjsmith
- **CLI Auth**: Use `gh auth login` for terminal access

**Vercel** (Frontend Hosting Option)
- **Dashboard**: https://vercel.com/dashboard
- **Login Method**: GitHub OAuth (philipsmith33105@gmail.com)
- **Project Name**: forex-market-anz
- **Domain**: [Set in Vercel dashboard]

**Cloudflare Pages** (Frontend Hosting - ACTIVE)
- **Dashboard**: https://dash.cloudflare.com
- **Login Method**: GitHub OAuth (philipsmith33105@gmail.com)
- **Project Name**: forex-market-anz
- **Domain**: https://forex-market-anz.pages.dev
- **Auto-Deploy**: Connected to GitHub main branch

**Render** (Backend Hosting - ACTIVE)
- **Dashboard**: https://dashboard.render.com
- **Login Method**: GitHub OAuth (philipsmith33105@gmail.com)
- **Service Name**: forex-market-anz
- **Service URL**: https://forex-market-anz.onrender.com
- **Environment Variables**: Set in Render dashboard → Environment tab
- **Auto-Deploy**: Connected to GitHub main branch

## Email Service (Password Reset Feature)

**Gmail SMTP**
- **Provider**: Gmail
- **Host**: smtp.gmail.com
- **Port**: 587
- **Email Address**: Stored in `.env` as `EMAIL_USER` (philipsmith33105@gmail.com)
- **App Password**: Stored in `.env` as `EMAIL_PASS`
- **Generate App Password**: https://myaccount.google.com/apppasswords
- **Note**: Requires 2FA enabled on Google account

## Environment Variables

### Local Development (`.env` file)
All sensitive credentials stored locally in `.env` (never committed to git).

### Production Deployments
Environment variables set in respective platform dashboards:
- **Render**: Dashboard → Environment tab
- **Cloudflare Pages**: Settings → Environment Variables
- **Vercel**: Project Settings → Environment Variables (if used)

## Security Best Practices

- ✅ `.env` file is in `.gitignore` (never commit secrets)
- ✅ Use different `SESSION_SECRET` for each environment
- ✅ Rotate database credentials periodically
- ✅ Use environment-specific API keys when possible
- ✅ Enable Row Level Security (RLS) in Supabase for production
- ⚠️ Never hardcode credentials in documentation files
- ⚠️ Never share `.env` file publicly

## Quick Reference Commands

```bash
# Login to GitHub CLI (for git operations)
gh auth login

# Login to Render CLI (for deployments)
npm i -g render-cli && render login

# Login to Cloudflare Wrangler (for deployments)
npx wrangler login

# Login to Vercel CLI (if using for frontend)
npx vercel login
```

## Contact Information

**Primary Contact**: philipsmith33105@gmail.com
**GitHub**: @philipjjsmith
