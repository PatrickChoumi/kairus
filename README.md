# Kairus — Minimal Messenger

## Stack
- **Client**: React + Vite + Tailwind + Socket.IO (Vercel)
- **Server**: Express + Socket.IO + sql.js (Railway)

## Dev

```bash
npm install
cd server && npm install && cd ../client && npm install && cd ..
npm run dev
```

## Deploy

### Frontend → Vercel
```bash
cd client
npm install
npm run build
vercel --prod
```
Set `VITE_API_URL` env var to your Railway URL.

### Backend → Railway
```bash
railway login
railway init
railway up
```
Set env vars: `JWT_SECRET`, `CORS_ORIGIN`.
