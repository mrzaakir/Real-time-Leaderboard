const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createClient } = require('redis');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

(async () => {
  // Attempt to connect to Redis, but fall back to an in-memory implementation if Redis is unavailable.
  let redis;

  class InMemoryRedis {
    constructor() {
      this.hash = new Map();
      this.sets = new Map();
      this.zsets = new Map(); // key -> Map(value -> score)
      this.lists = new Map();
    }
    on() {}
    async connect() {}
    async hSet(key, obj) {
      const cur = this.hash.get(key) || {};
      Object.assign(cur, obj);
      this.hash.set(key, cur);
    }
    async hGet(key, field) {
      const cur = this.hash.get(key) || {};
      return cur[field] ?? null;
    }
    async sAdd(key, member) {
      const s = this.sets.get(key) || new Set();
      s.add(member);
      this.sets.set(key, s);
      return 1;
    }
    async exists(key) {
      return (this.hash.has(key) || this.sets.has(key) || this.zsets.has(key) || this.lists.has(key)) ? 1 : 0;
    }
    async zAdd(key, entries) {
      const map = this.zsets.get(key) || new Map();
      for (const e of entries) {
        map.set(e.value, Number(e.score));
      }
      this.zsets.set(key, map);
      return entries.length;
    }
    async zRangeWithScores(key, start, end) {
      const map = this.zsets.get(key) || new Map();
      const arr = Array.from(map.entries()).map(([value, score]) => ({ value, score: Number(score) }));
      arr.sort((a, b) => a.score - b.score || a.value.localeCompare(b.value));
      const len = arr.length;
      const s = start < 0 ? Math.max(len + start, 0) : start;
      const e = end < 0 ? len + end : end;
      if (s > e || s >= len) return [];
      return arr.slice(s, Math.min(e + 1, len));
    }
    async zRevRank(key, value) {
      const map = this.zsets.get(key) || new Map();
      const arr = Array.from(map.entries()).map(([v, score]) => ({ v, score: Number(score) }));
      arr.sort((a, b) => b.score - a.score || a.v.localeCompare(b.v));
      const idx = arr.findIndex((x) => x.v === value);
      return idx === -1 ? null : idx;
    }
    async zScore(key, value) {
      const map = this.zsets.get(key) || new Map();
      const s = map.get(value);
      return s === undefined ? null : s;
    }
    async zUnionStore(dest, keys) {
      const out = new Map();
      for (const k of keys) {
        const map = this.zsets.get(k);
        if (!map) continue;
        for (const [v, score] of map.entries()) {
          out.set(v, (out.get(v) || 0) + Number(score));
        }
      }
      this.zsets.set(dest, out);
      return out.size;
    }
    async expire() { return 1; }
    async lPush(key, value) {
      const l = this.lists.get(key) || [];
      l.unshift(value);
      this.lists.set(key, l);
      return l.length;
    }
  }

  try {
    redis = createClient({ url: REDIS_URL });
    redis.on('error', (err) => console.error('Redis Client Error', err));
    // try to connect with a short timeout
    const connectPromise = redis.connect();
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Redis connect timeout')), 2000));
    await Promise.race([connectPromise, timeout]);
    console.log('Connected to Redis at', REDIS_URL);
  } catch (e) {
    console.warn('Redis unavailable, using in-memory fallback. Details:', e.message || e);
    redis = new InMemoryRedis();
  }

  // keep connected SSE clients for real-time updates
  const sseClients = new Set();

  // Helpers
  async function addUser(username, password) {
    const passwordHash = await bcrypt.hash(password, 10);
    await redis.hSet(`user:${username}`, { passwordHash, createdAt: Date.now().toString() });
    await redis.sAdd('users', username);
  }

  async function verifyUser(username, password) {
    const hash = await redis.hGet(`user:${username}`, 'passwordHash');
    if (!hash) return false;
    return bcrypt.compare(password, hash);
  }

  function sendSseEvent(data) {
    const payload = `event: update\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(payload);
      } catch (e) {
        // ignore
      }
    }
  }

  app.post('/api/register', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const exists = await redis.exists(`user:${username}`);
    if (exists) return res.status(400).json({ error: 'user exists' });
    await addUser(username, password);
    res.json({ ok: true });
  });

  app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const ok = await verifyUser(username, password);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token });
  });

  function authMiddleware(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'missing auth' });
    const parts = auth.split(' ');
    if (parts[0] !== 'Bearer' || !parts[1]) return res.status(401).json({ error: 'invalid auth' });
    try {
      const payload = jwt.verify(parts[1], JWT_SECRET);
      req.user = payload;
      next();
    } catch (e) {
      return res.status(401).json({ error: 'invalid token' });
    }
  }

  // Submit score
  app.post('/api/score', authMiddleware, async (req, res) => {
    const username = req.user.username;
    const { game = 'global', score } = req.body || {};
    if (typeof score !== 'number') return res.status(400).json({ error: 'score (number) required' });
    // store in global leaderboard
    await redis.zAdd('leaderboard:global', [{ score, value: username }]);
    // per-game leaderboard
    await redis.zAdd(`leaderboard:game:${game}`, [{ score, value: username }]);
    // daily leaderboard
    const day = new Date().toISOString().slice(0, 10);
    await redis.zAdd(`leaderboard:day:${day}`, [{ score, value: username }]);
    // score history list
    const entry = JSON.stringify({ score, game, ts: Date.now() });
    await redis.lPush(`scores:${username}`, entry);
    // notify SSE clients
    sendSseEvent({ type: 'score', username, game, score });
    res.json({ ok: true });
  });

  // Leaderboard (top N)
  app.get('/api/leaderboard', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const rows = await redis.zRangeWithScores('leaderboard:global', -limit, -1);
    // zRangeWithScores returns ascending; transform to descending
    const desc = rows.reverse().map((r, i) => ({ rank: i + 1, username: r.value, score: r.score }));
    res.json({ leaderboard: desc });
  });

  // User rank
  app.get('/api/me/rank', authMiddleware, async (req, res) => {
    const username = req.user.username;
    const rankIndex = await redis.zRevRank('leaderboard:global', username);
    const score = await redis.zScore('leaderboard:global', username);
    if (rankIndex === null) return res.json({ rank: null, score: null });
    res.json({ rank: rankIndex + 1, score: Number(score) });
  });

  // Top players report over last N days (default 7)
  app.get('/api/report/top', async (req, res) => {
    const days = Math.max(1, Math.min(parseInt(req.query.days) || 7, 30));
    const dayKeys = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
      dayKeys.push(`leaderboard:day:${d}`);
    }
    // zUnionStore into a temporary key (sum scores)
    const tempKey = `report:temp:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    try {
      await redis.zUnionStore(tempKey, dayKeys);
      await redis.expire(tempKey, 10); // short-lived
      const rows = await redis.zRangeWithScores(tempKey, -20, -1);
      const desc = rows.reverse().map((r, i) => ({ rank: i + 1, username: r.value, score: r.score }));
      res.json({ days, report: desc });
    } catch (e) {
      // if zUnionStore failed (e.g., no keys), return empty
      res.json({ days, report: [] });
    }
  });

  // SSE endpoint for real-time updates
  app.get('/api/stream', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(': connected\n\n');
    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  // Basic status
  app.get('/api/ping', (req, res) => res.json({ ok: true }));

  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
})();
