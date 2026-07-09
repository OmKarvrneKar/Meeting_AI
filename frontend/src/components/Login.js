import React, { useState } from 'react';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setLoading(true);
    // Mock login since Firebase isn't fully configured by user yet
    setTimeout(() => {
      onLogin({ email });
    }, 1000);
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', 
      height: '100vh', background: '#0a0b0d', color: '#e8eaf0', fontFamily: 'var(--font-mono)'
    }}>
      <div style={{
        background: 'rgba(30, 30, 30, 0.4)', backdropFilter: 'blur(12px)',
        padding: '3rem', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)', width: '400px', textAlign: 'center'
      }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: '#3b82f6', animation: 'logo-spin 8s linear infinite' }}>◉</div>
        <h2 style={{ margin: '0 0 1.5rem', fontWeight: 600, fontFamily: 'var(--font-display)' }}>Sign in to MeetMind</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <input 
            type="email" placeholder="Email address" required
            value={email} onChange={e => setEmail(e.target.value)}
            style={{ padding: '12px', borderRadius: '8px', border: '1px solid #333', background: '#111318', color: 'white', outline: 'none' }}
          />
          <input 
            type="password" placeholder="Password" required
            value={password} onChange={e => setPassword(e.target.value)}
            style={{ padding: '12px', borderRadius: '8px', border: '1px solid #333', background: '#111318', color: 'white', outline: 'none' }}
          />
          <button 
            type="submit" 
            style={{ padding: '12px', borderRadius: '8px', border: '1px solid rgba(59,130,246,0.3)', background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)', fontWeight: 600, cursor: 'pointer', marginTop: '1rem' }}
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>
        <p style={{ marginTop: '1.5rem', fontSize: '0.85rem', color: '#7a8199' }}>
          By signing in, your meeting history and RAG documents will be securely synced.
        </p>
      </div>
    </div>
  );
}
