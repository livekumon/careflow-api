# Careflow API

Express + MongoDB hospital queue API.

## Local

```bash
npm install
cp .env.example .env
npm run seed
npm run dev
```

## Vercel

Set environment variables:

- `MONGODB_URI` — MongoDB Atlas connection string
- `CORS_ORIGIN` — `*` or comma-separated frontend origins
- `PATIENT_APP_URL` — patient app production URL
