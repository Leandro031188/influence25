import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { openDb } from './db/db.js';
import { encryptToken, decryptToken } from './lib/crypto.js';
import { buildAuthUrl, exchangeCodeForToken, fetchMe } from './lib/meta.js';
import { classifyNiche, buildBrandTargets, computeErScore, computeConsistencyScore, computeNicheScore, computeReachScore, computeFraudPenalty, computeTotalScore, grade } from './lib/scoring.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const db = openDb();

app.use(helmet({
  contentSecurityPolicy: false // MVP para permitir Tailwind CDN
}));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Serve frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// Helpers
function nowIso() { return new Date().toISOString(); }
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  next();
}
function logAudit({ actor_type, actor_id, action, target_type, target_id, metadata }) {
  const stmt = db.prepare(`INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, metadata, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  stmt.run(nanoid(), actor_type, actor_id, action, target_type, target_id, metadata ? JSON.stringify(metadata) : null, nowIso());
}

// Consent text versioning
const CONSENT_VERSION = 'v1.0-2026-01-31';
const CONSENT_TEXT = `Ao conectar seu Instagram por login oficial, você autoriza a coleta e análise de métricas e informações do seu perfil, apenas na medida necessária, para: (1) validar autenticidade, (2) gerar o Creator Fit Score, (3) criar seu Media Kit e (4) recomendar categorias de marcas compatíveis. Não acessamos mensagens privadas. Você pode desconectar a conta e revogar esta autorização a qualquer momento.`;
import crypto from 'crypto';
const CONSENT_HASH = crypto.createHash('sha256').update(CONSENT_TEXT).digest('hex');

// ---- API

// 1) Create lead + consents
const LeadSchema = z.object({
  full_name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  country: z.enum(['ES','PT']),
  city: z.string().optional().nullable(),
  declared_category: z.string().optional().nullable(),
  consents: z.object({
    metrics_check: z.boolean(),
    share_with_brands: z.boolean().optional().default(false),
    marketing_contact: z.boolean().optional().default(false)
  })
});

app.post('/api/lead', (req, res) => {
  const parsed = LeadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const data = parsed.data;
  if (!data.consents.metrics_check) return res.status(400).json({ error: 'metrics_check is required' });

  const id = nanoid();
  const ts = nowIso();

  try {
    db.prepare(`INSERT INTO creators (id, full_name, email, phone, country, city, declared_category, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, data.full_name, data.email.toLowerCase(), data.phone || null, data.country, data.city || null, data.declared_category || null, 'lead', ts, ts);

    const ua = req.headers['user-agent'] || null;
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();

    const insertConsent = db.prepare(`INSERT INTO consent_records
      (id, creator_id, consent_type, granted, text_version, text_hash, ip_address, user_agent, granted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    for (const [k, v] of Object.entries(data.consents)) {
      insertConsent.run(nanoid(), id, k, v ? 1 : 0, CONSENT_VERSION, CONSENT_HASH, ip, ua, ts);
    }

    logAudit({ actor_type:'system', actor_id:'api', action:'LEAD_CREATED', target_type:'creator', target_id:id, metadata:{ email:data.email, country:data.country }});
    return res.json({ creator_id: id, next: `/connect.html?creator_id=${encodeURIComponent(id)}` });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'email already exists' });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Consent text (for UI)
app.get('/api/consent-text', (req, res) => {
  res.json({ version: CONSENT_VERSION, hash: CONSENT_HASH, text: CONSENT_TEXT });
});

// 2) OAuth start
app.get('/api/oauth/meta/start', (req, res) => {
  const creator_id = req.query.creator_id?.toString();
  if (!creator_id) return res.status(400).send('missing creator_id');

  const creator = db.prepare('SELECT id, status FROM creators WHERE id = ?').get(creator_id);
  if (!creator) return res.status(404).send('creator not found');

  const state = JSON.stringify({ creator_id, nonce: nanoid() });

  // Scopes: você ajusta conforme seu app Meta aprovar
  const scopes = [
    'public_profile'
    // Adicione permissões IG conforme sua configuração na plataforma Meta
  ];

  const url = buildAuthUrl({ state, scopes });
  logAudit({ actor_type:'creator', actor_id:creator_id, action:'OAUTH_START', target_type:'creator', target_id:creator_id, metadata:{}});
  res.redirect(url);
});

// 3) OAuth callback
app.get('/api/oauth/meta/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) return res.status(400).send(`OAuth error: ${error} ${error_description || ''}`);

  if (!code || !state) return res.status(400).send('Missing code/state');

  let st;
  try { st = JSON.parse(state.toString()); } catch { return res.status(400).send('Bad state'); }
  const creator_id = st.creator_id;

  try {
    const token = await exchangeCodeForToken(code.toString());
    const me = await fetchMe(token.access_token);

    // Upsert connected account
    const account_id = nanoid();
    const ts = nowIso();
    const enc = encryptToken(token.access_token);

    db.prepare(`INSERT INTO connected_accounts (id, creator_id, platform, ig_user_id, username, account_type, scopes, access_token_enc, token_expires_at, connected_at, status)
                VALUES (?, ?, 'instagram', ?, ?, ?, ?, ?, ?, ?, 'active')`)
      .run(account_id, creator_id, me.id?.toString() || null, null, 'unknown', null, enc, token.expires_in ? new Date(Date.now()+token.expires_in*1000).toISOString() : null, ts);

    db.prepare(`UPDATE creators SET status='connected', updated_at=? WHERE id=?`).run(ts, creator_id);

    logAudit({ actor_type:'creator', actor_id:creator_id, action:'OAUTH_CONNECTED', target_type:'account', target_id:account_id, metadata:{ me }});

    // MVP: roda qualificação imediatamente
    await runQualification({ creator_id, account_id });

    return res.redirect(`/dashboard.html?creator_id=${encodeURIComponent(creator_id)}`);
  } catch (e) {
    console.error(e);
    return res.status(500).send('OAuth callback failed. Check server logs.');
  }
});

// Qualification pipeline (MVP)
// NOTA: Sem scraping. Se métricas avançadas não estiverem disponíveis via API, mantém score com proxies/limitado.
async function runQualification({ creator_id, account_id }) {
  const ts = nowIso();

  // snapshot mínimo (sem IG insights neste starter)
  const creator = db.prepare('SELECT declared_category FROM creators WHERE id=?').get(creator_id);

  db.prepare(`INSERT INTO profile_snapshots (id, account_id, snapshot_date, created_at)
              VALUES (?, ?, ?, ?)`)
    .run(nanoid(), account_id, new Date().toISOString().slice(0,10), ts);

  // Aggregates dummy (0). Você pluga os seus collectors aqui quando tiver permissões IG.
  const day = new Date().toISOString().slice(0,10);
  db.prepare(`INSERT INTO content_metrics_daily (id, account_id, day, posts_count, reels_count, likes_total, comments_total, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(nanoid(), account_id, day, 0, 0, 0, 0, ts);

  // Classify niche (bio não disponível no starter; usa declared_category)
  const niche = classifyNiche({ bio: "", declared: creator?.declared_category || "" });
  db.prepare(`INSERT INTO niche_classification (id, creator_id, primary_niche, secondary_niches, confidence, evidence_keywords, model_version, computed_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(nanoid(), creator_id, niche.primary_niche, JSON.stringify(niche.secondary_niches), niche.confidence, JSON.stringify(niche.evidence_keywords), 'dict-v1', ts);

  // Score (limited)
  const followers = 1000; // placeholder — quando tiver endpoint, substitua
  const likes = 50;
  const comments = 5;
  const contentCount30d = 8;

  const er = (likes + comments) / followers;
  const erScore = computeErScore(er);
  const consistencyScore = computeConsistencyScore(contentCount30d / 4);
  const nicheScore = computeNicheScore(niche.confidence);
  const reachAvailable = false;
  const reachScore = computeReachScore({ reachAvailable, ratio: 0 }) ?? 0;
  const fraudPenalty = computeFraudPenalty({ er, followers, contentCount30d });
  const total = computeTotalScore({ erScore, reachScore, consistencyScore, nicheScore, fraudPenalty, reachAvailable });
  const g = grade(total);

  db.prepare(`INSERT INTO creator_scores (id, creator_id, score_total, grade, er_score, reach_score, consistency_score, niche_score, fraud_penalty, scoring_version, computed_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(nanoid(), creator_id, total, g, erScore, reachScore, consistencyScore, nicheScore, fraudPenalty, 'score-v1', ts);

  // Brand targets
  const targets = buildBrandTargets(niche.primary_niche);
  db.prepare(`INSERT INTO brand_targets (id, creator_id, target_type, segment, suggested_brands, generated_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(nanoid(), creator_id, 'local', niche.primary_niche, JSON.stringify(targets.local), ts);
  db.prepare(`INSERT INTO brand_targets (id, creator_id, target_type, segment, suggested_brands, generated_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(nanoid(), creator_id, 'ecommerce', niche.primary_niche, JSON.stringify(targets.ecommerce), ts);

  db.prepare(`UPDATE creators SET status='qualified', updated_at=? WHERE id=?`).run(ts, creator_id);

  logAudit({ actor_type:'system', actor_id:'pipeline', action:'QUALIFIED', target_type:'creator', target_id:creator_id, metadata:{ grade:g, score:total, niche:niche.primary_niche }});
}

// Creator overview
app.get('/api/creator/:id/overview', (req, res) => {
  const creator_id = req.params.id;
  const creator = db.prepare('SELECT * FROM creators WHERE id=?').get(creator_id);
  if (!creator) return res.status(404).json({ error: 'not_found' });

  const score = db.prepare('SELECT * FROM creator_scores WHERE creator_id=? ORDER BY computed_at DESC LIMIT 1').get(creator_id);
  const niche = db.prepare('SELECT * FROM niche_classification WHERE creator_id=? ORDER BY computed_at DESC LIMIT 1').get(creator_id);
  const brands = db.prepare('SELECT * FROM brand_targets WHERE creator_id=? ORDER BY generated_at DESC').all(creator_id);
  const consents = db.prepare('SELECT consent_type, granted, revoked_at FROM consent_records WHERE creator_id=?').all(creator_id);

  res.json({ creator, score, niche, brands, consents });
});

// Share enable
app.post('/api/creator/:id/share-enable', (req, res) => {
  const creator_id = req.params.id;
  const ts = nowIso();
  db.prepare("UPDATE creators SET status='share_enabled', updated_at=? WHERE id=?").run(ts, creator_id);
  logAudit({ actor_type:'creator', actor_id:creator_id, action:'SHARE_ENABLED', target_type:'creator', target_id:creator_id });
  res.json({ ok: true });
});

// Disconnect
app.post('/api/creator/:id/disconnect', (req, res) => {
  const creator_id = req.params.id;
  const ts = nowIso();
  db.prepare("UPDATE connected_accounts SET status='revoked', disconnected_at=? WHERE creator_id=? AND status='active'").run(ts, creator_id);
  db.prepare("UPDATE creators SET status='revoked', updated_at=? WHERE id=?").run(ts, creator_id);
  logAudit({ actor_type:'creator', actor_id:creator_id, action:'DISCONNECT', target_type:'creator', target_id:creator_id });
  res.json({ ok: true });
});

// Deletion request
app.post('/api/creator/:id/delete', (req, res) => {
  const creator_id = req.params.id;
  const ts = nowIso();
  db.prepare("INSERT INTO deletion_requests (id, creator_id, requested_at, status) VALUES (?, ?, ?, ?)")
    .run(nanoid(), creator_id, ts, 'requested');
  logAudit({ actor_type:'creator', actor_id:creator_id, action:'DELETE_REQUESTED', target_type:'creator', target_id:creator_id });
  res.json({ ok: true });
});

// ---- Admin
app.get('/api/admin/creators', adminAuth, (req, res) => {
  const grade = req.query.grade?.toString();
  const city = req.query.city?.toString();
  let q = `SELECT c.*, s.score_total, s.grade, n.primary_niche
           FROM creators c
           LEFT JOIN (SELECT creator_id, score_total, grade, MAX(computed_at) AS computed_at FROM creator_scores GROUP BY creator_id) s
           ON c.id = s.creator_id
           LEFT JOIN (SELECT creator_id, primary_niche, MAX(computed_at) AS computed_at FROM niche_classification GROUP BY creator_id) n
           ON c.id = n.creator_id
           WHERE 1=1`;
  const params = [];
  if (city) { q += " AND c.city = ?"; params.push(city); }
  if (grade) { q += " AND s.grade = ?"; params.push(grade); }
  q += " ORDER BY c.created_at DESC LIMIT 500";
  const rows = db.prepare(q).all(...params);
  logAudit({ actor_type:'admin', actor_id:'admin', action:'ADMIN_LIST', target_type:'creator', target_id:'*' });
  res.json({ rows });
});

app.get('/api/admin/export.csv', adminAuth, (req, res) => {
  const rows = db.prepare(`SELECT c.id, c.full_name, c.email, c.phone, c.country, c.city, c.declared_category, c.status,
                                  s.score_total, s.grade
                           FROM creators c
                           LEFT JOIN (SELECT creator_id, score_total, grade, MAX(computed_at) AS computed_at FROM creator_scores GROUP BY creator_id) s
                           ON c.id = s.creator_id
                           ORDER BY c.created_at DESC`).all();
  const header = Object.keys(rows[0] || {id:''}).join(',');
  const csv = [header, ...rows.map(r => Object.values(r).map(v => JSON.stringify(v ?? '')).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});

// Admin page route fallback
app.get('/admin', (req,res)=>res.redirect('/admin.html'));

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => {
  console.log(`Server running on ${process.env.BASE_URL || 'http://localhost:'+PORT}`);
});
