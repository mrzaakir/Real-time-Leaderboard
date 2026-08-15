Leaderboard — Frontend-only Small Demo

This is a simplified, frontend-only leaderboard demo built with React + Vite + Tailwind CSS. It stores users and scores in the browser's localStorage so you can run the whole project without a backend or Redis.

Features (small and client-only):
- Register / Login (stored in localStorage; insecure but fine for demo)
- Submit score (stored in localStorage)
- Global leaderboard (best score per user)
- User rank
- Top players report for last N days (aggregated from stored scores)
- No backend required — runs fully in the browser

Quick start (Windows PowerShell)

1) Start frontend

  cd "C:\Users\mrzaa\Desktop\Real-time Leaderboard\client"
  npm install
  npm run dev



Notes
- Data is stored in localStorage keys: "rtlb_users" and "rtlb_scores". Clearing browser storage removes data.
- This is intentionally small and meant for local experimentation. Do not use localStorage for sensitive or production data.

