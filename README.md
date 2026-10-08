# vrsus

Every event is two coins. Pair a real event (Polymarket, ESPN or Coinbase) to a YES coin and a NO coin on pump.fun. Both coins share one creator wallet, so both coins' fees fill one pot. When the source settles the event, the pot is paid in SOL to the winning coin's holders, pro rata, with every snapshot and payout published and verifiable.

Static pages + Vercel functions (`api/`), Neon Postgres (`DATABASE_URL`), the engine runs on Vercel Cron every minute (`/api/tick`).
