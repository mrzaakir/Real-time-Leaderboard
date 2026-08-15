import React, { useEffect, useState } from 'react';

// Client-only leaderboard demo. All data stored in localStorage so no backend is required.

const LS_USERS = 'rtlb_users';
const LS_SCORES = 'rtlb_scores';

function readUsers() {
  try {
    return JSON.parse(localStorage.getItem(LS_USERS) || '{}');
  } catch (e) { return {}; }
}
function writeUsers(u) { localStorage.setItem(LS_USERS, JSON.stringify(u)); }

function readScores() {
  try {
    return JSON.parse(localStorage.getItem(LS_SCORES) || '[]');
  } catch (e) { return []; }
}
function writeScores(s) { localStorage.setItem(LS_SCORES, JSON.stringify(s)); }

function Login({ onLogged }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('login');

  function submit(e) {
    e.preventDefault();
    const users = readUsers();
    if (!username || !password) return alert('username and password required');
    if (mode === 'register') {
      if (users[username]) return alert('user exists');
      // NOTE: storing password in localStorage is insecure but fine for a small demo
      users[username] = { password };
      writeUsers(users);
      alert('Registered. Please login.');
      setMode('login');
      setUsername(''); setPassword('');
      return;
    }
    // login
    const u = users[username];
    if (!u || u.password !== password) return alert('invalid credentials');
    // Simulate token by storing username in localStorage
    onLogged(`token-${username}-${Date.now()}`, username);
  }

  return (
    <div className="p-4 border rounded bg-white max-w-md">
      <h3 className="font-semibold">{mode === 'login' ? 'Login' : 'Register'}</h3>
      <form onSubmit={submit} className="space-y-2 mt-2">
        <input className="w-full p-2 border rounded" placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input type="password" className="w-full p-2 border rounded" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="flex gap-2">
          <button className="px-3 py-1 bg-blue-500 text-white rounded">{mode === 'login' ? 'Login' : 'Register'}</button>
          <button type="button" className="px-3 py-1 bg-gray-200 rounded" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Switch to Register' : 'Switch to Login'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Leaderboard({ username, onLogout, onChange }) {
  const [list, setList] = useState([]);
  const [myRank, setMyRank] = useState(null);
  const [score, setScore] = useState('');

  function computeLeaderboard() {
    const scores = readScores();
    // best score per user
    const best = new Map();
    for (const s of scores) {
      const who = s.username;
      const val = Number(s.score) || 0;
      if (!best.has(who) || best.get(who) < val) best.set(who, val);
    }
    const arr = Array.from(best.entries()).map(([u, score]) => ({ username: u, score }));
    arr.sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));
    setList(arr.map((r, i) => ({ ...r, rank: i + 1 })));
    const myIndex = arr.findIndex((r) => r.username === username);
    setMyRank(myIndex === -1 ? null : { rank: myIndex + 1, score: arr[myIndex].score });
  }

  useEffect(() => { computeLeaderboard(); }, []);

  function submitScore(e) {
    e.preventDefault();
    const num = Number(score);
    if (Number.isNaN(num)) return alert('enter a valid number');
    const scores = readScores();
    scores.push({ username, score: num, game: 'global', ts: Date.now() });
    writeScores(scores);
    setScore('');
    computeLeaderboard();
    if (onChange) onChange();
  }

  function clearData() {
    if (!confirm('Clear all local leaderboard data?')) return;
    localStorage.removeItem(LS_SCORES);
    computeLeaderboard();
  }

  function topPlayers(days = 7) {
    const since = Date.now() - days * 24 * 3600 * 1000;
    const scores = readScores().filter(s => s.ts >= since);
    const agg = new Map();
    for (const s of scores) {
      agg.set(s.username, (agg.get(s.username) || 0) + Number(s.score));
    }
    const arr = Array.from(agg.entries()).map(([u, score]) => ({ username: u, score }));
    arr.sort((a, b) => b.score - a.score);
    return arr.slice(0, 10).map((r, i) => ({ ...r, rank: i + 1 }));
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Global Leaderboard</h2>
        <div className="flex gap-2 items-center">
          <div>{myRank ? `Your rank: ${myRank.rank} (score: ${myRank.score})` : 'No rank yet'}</div>
          <button className="px-2 py-1 bg-red-500 text-white rounded" onClick={onLogout}>Logout</button>
        </div>
      </div>

      <div className="bg-white rounded shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-left">#</th>
              <th className="p-2 text-left">User</th>
              <th className="p-2 text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.username} className="border-t">
                <td className="p-2">{r.rank}</td>
                <td className="p-2">{r.username}</td>
                <td className="p-2 text-right">{r.score}</td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td className="p-2" colSpan={3}>No scores yet. Submit one!</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <form onSubmit={submitScore} className="p-4 bg-white rounded shadow">
        <div className="flex gap-2">
          <input type="number" value={score} onChange={(e) => setScore(e.target.value)} className="p-2 border rounded flex-1" placeholder="Enter score" />
          <button className="px-4 py-2 bg-green-500 text-white rounded">Submit Score</button>
        </div>
      </form>

      <div className="bg-white p-4 rounded shadow space-y-2">
        <div className="font-semibold">Top players (last 7 days)</div>
        <div>
          {topPlayers(7).map(p => (
            <div key={p.username} className="flex justify-between border-b py-1">
              <div>{p.rank}. {p.username}</div>
              <div>{p.score}</div>
            </div>
          ))}
          {topPlayers(7).length === 0 && <div className="text-sm text-gray-500">No recent scores</div>}
        </div>
        <div className="flex gap-2 mt-2">
          <button className="px-3 py-1 bg-yellow-400 rounded" onClick={() => alert(JSON.stringify(readScores(), null, 2))}>Show Raw Scores</button>
          <button className="px-3 py-1 bg-gray-200 rounded" onClick={clearData}>Clear Scores</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [username, setUsername] = useState(localStorage.getItem('username'));

  function onLogged(tok, user) {
    localStorage.setItem('token', tok);
    localStorage.setItem('username', user);
    setToken(tok);
    setUsername(user);
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    setToken(null);
    setUsername(null);
  }

  return (
    <div className="container">
      <h1 className="text-2xl font-bold mb-4">Leaderboard — Frontend-only Demo</h1>
      {!token ? <Login onLogged={onLogged} /> : <Leaderboard username={username} onLogout={logout} />}
      <div className="mt-6 text-sm text-gray-500">This project runs entirely in the browser using localStorage. No backend required.</div>
    </div>
  );
}
