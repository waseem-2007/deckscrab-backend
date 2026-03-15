// ═══════════════════════════════════════════════════
//  Deckscrab Backend — Node.js + SQLite
//  Deploy to Railway.app for free hosting
// ═══════════════════════════════════════════════════
const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const { v4: uuid } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ──
app.use(cors({ origin: '*' })); // allow all origins (any device/browser can connect)
app.use(express.json({ limit: '10mb' }));

// ── DATABASE SETUP ──
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'deckscrab.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── CREATE TABLES ──
db.exec(`
  CREATE TABLE IF NOT EXISTS businesses (
    id          TEXT PRIMARY KEY,
    biz_id      TEXT UNIQUE NOT NULL,
    sector      TEXT NOT NULL,
    sector_name TEXT,
    sector_emoji TEXT,
    name        TEXT NOT NULL,
    owner_name  TEXT,
    description TEXT,
    price_level INTEGER DEFAULT 2,
    keywords    TEXT,
    address     TEXT,
    city        TEXT,
    pincode     TEXT,
    district    TEXT,
    state       TEXT DEFAULT 'Tamil Nadu',
    lat         REAL,
    lng         REAL,
    phone       TEXT,
    phone2      TEXT,
    email       TEXT,
    website     TEXT,
    whatsapp    TEXT,
    upi         TEXT,
    instagram   TEXT,
    facebook    TEXT,
    youtube     TEXT,
    delivery    INTEGER DEFAULT 1,
    online_orders INTEGER DEFAULT 1,
    show_phone  INTEGER DEFAULT 1,
    hours_note  TEXT,
    hours_json  TEXT,
    products_json TEXT,
    registered_at INTEGER NOT NULL,
    updated_at  INTEGER,
    is_active   INTEGER DEFAULT 1,
    views       INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS favourites (
    id          TEXT PRIMARY KEY,
    device_id   TEXT NOT NULL,
    biz_id      TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    UNIQUE(device_id, biz_id)
  );

  CREATE TABLE IF NOT EXISTS offers (
    id          TEXT PRIMARY KEY,
    biz_id      TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    discount    TEXT,
    valid_until INTEGER,
    created_at  INTEGER NOT NULL,
    is_active   INTEGER DEFAULT 1,
    FOREIGN KEY(biz_id) REFERENCES businesses(biz_id)
  );

  CREATE TABLE IF NOT EXISTS searches (
    id          TEXT PRIMARY KEY,
    query       TEXT,
    city        TEXT,
    sector      TEXT,
    lat         REAL,
    lng         REAL,
    result_count INTEGER DEFAULT 0,
    searched_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_biz_city    ON businesses(city);
  CREATE INDEX IF NOT EXISTS idx_biz_sector  ON businesses(sector);
  CREATE INDEX IF NOT EXISTS idx_biz_active  ON businesses(is_active);
  CREATE INDEX IF NOT EXISTS idx_biz_latlon  ON businesses(lat, lng);
  CREATE INDEX IF NOT EXISTS idx_offers_biz  ON offers(biz_id);
  CREATE INDEX IF NOT EXISTS idx_fav_device  ON favourites(device_id);
  CREATE INDEX IF NOT EXISTS idx_searches_at ON searches(searched_at);
`);

console.log('Database ready:', DB_PATH);

// ══════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════
function now() { return Date.now(); }

// Haversine distance in km
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
    Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatBiz(row) {
  if (!row) return null;
  return {
    id: row.id,
    bizId: row.biz_id,
    sector: row.sector,
    sectorName: row.sector_name,
    sectorEmoji: row.sector_emoji,
    name: row.name,
    ownerName: row.owner_name,
    description: row.description,
    priceLevel: row.price_level,
    keywords: row.keywords,
    address: row.address,
    city: row.city,
    pincode: row.pincode,
    district: row.district,
    state: row.state,
    lat: row.lat,
    lng: row.lng,
    phone: row.show_phone ? row.phone : null,
    phone2: row.phone2,
    email: row.email,
    website: row.website,
    whatsapp: row.whatsapp,
    upi: row.upi,
    instagram: row.instagram,
    facebook: row.facebook,
    youtube: row.youtube,
    delivery: !!row.delivery,
    onlineOrders: !!row.online_orders,
    showPhone: !!row.show_phone,
    hoursNote: row.hours_note,
    hours: row.hours_json ? JSON.parse(row.hours_json) : {},
    products: row.products_json ? JSON.parse(row.products_json) : [],
    registeredAt: row.registered_at,
    views: row.views || 0,
  };
}

// ══════════════════════════════════════
//  ROUTES — BUSINESSES
// ══════════════════════════════════════

// GET /api/businesses — list all active businesses
// Query params: city, sector, q (search), lat, lng, radius (km), limit, offset
app.get('/api/businesses', (req, res) => {
  const { city, sector, q, lat, lng, radius = 10, limit = 50, offset = 0 } = req.query;

  let sql = 'SELECT * FROM businesses WHERE is_active = 1';
  const params = [];

  if (city) {
    sql += ' AND (city LIKE ? OR district LIKE ?)';
    params.push(`%${city}%`, `%${city}%`);
  }
  if (sector) {
    sql += ' AND sector = ?';
    params.push(sector);
  }
  if (q) {
    sql += ' AND (name LIKE ? OR description LIKE ? OR keywords LIKE ? OR sector_name LIKE ? OR address LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }

  sql += ' ORDER BY registered_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  try {
    let rows = db.prepare(sql).all(...params);

    // If lat/lng provided, add distance and filter by radius
    if (lat && lng) {
      const uLat = parseFloat(lat), uLng = parseFloat(lng), rad = parseFloat(radius);
      rows = rows
        .map(r => ({ ...r, _dist: r.lat && r.lng ? haversine(uLat, uLng, r.lat, r.lng) : 9999 }))
        .filter(r => r._dist <= rad)
        .sort((a, b) => a._dist - b._dist);
    }

    const total = db.prepare('SELECT COUNT(*) as c FROM businesses WHERE is_active = 1').get().c;

    res.json({
      ok: true,
      total,
      count: rows.length,
      businesses: rows.map(r => ({ ...formatBiz(r), distance: r._dist }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/businesses/:bizId — single business detail + increment view
app.get('/api/businesses/:bizId', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM businesses WHERE biz_id = ? AND is_active = 1').get(req.params.bizId);
    if (!row) return res.status(404).json({ ok: false, error: 'Business not found' });

    // increment view count
    db.prepare('UPDATE businesses SET views = views + 1 WHERE biz_id = ?').run(req.params.bizId);

    // get active offers
    const offers = db.prepare('SELECT * FROM offers WHERE biz_id = ? AND is_active = 1 ORDER BY created_at DESC').all(req.params.bizId);

    res.json({ ok: true, business: formatBiz(row), offers });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/businesses — register a new business
app.post('/api/businesses', (req, res) => {
  const d = req.body;
  if (!d.name || !d.sector || !d.phone) {
    return res.status(400).json({ ok: false, error: 'name, sector, and phone are required' });
  }

  const id = uuid();
  const bizId = 'NB-' + Date.now().toString().slice(-6);

  try {
    db.prepare(`
      INSERT INTO businesses (
        id, biz_id, sector, sector_name, sector_emoji,
        name, owner_name, description, price_level, keywords,
        address, city, pincode, district, state, lat, lng,
        phone, phone2, email, website, whatsapp, upi,
        instagram, facebook, youtube,
        delivery, online_orders, show_phone,
        hours_note, hours_json, products_json,
        registered_at, updated_at, is_active
      ) VALUES (
        ?,?,?,?,?,
        ?,?,?,?,?,
        ?,?,?,?,?,?,?,
        ?,?,?,?,?,?,
        ?,?,?,
        ?,?,?,
        ?,?,?,
        ?,?,1
      )
    `).run(
      id, bizId, d.sector, d.sectorName || '', d.sectorEmoji || '🏪',
      d.name, d.ownerName || '', d.description || '', parseInt(d.priceLevel) || 2, d.keywords || '',
      d.address || '', d.city || '', d.pincode || '', d.district || '', d.state || 'Tamil Nadu',
      parseFloat(d.lat) || null, parseFloat(d.lng) || null,
      d.phone, d.phone2 || '', d.email || '', d.website || '', d.whatsapp || '', d.upi || '',
      d.instagram || '', d.facebook || '', d.youtube || '',
      d.delivery ? 1 : 0, d.onlineOrders ? 1 : 0, d.showPhone ? 1 : 0,
      d.hoursNote || '',
      JSON.stringify(d.hours || {}),
      JSON.stringify(d.products || []),
      now(), now()
    );

    res.json({ ok: true, bizId, id, message: 'Business registered successfully!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/businesses/:bizId — update a business
app.put('/api/businesses/:bizId', (req, res) => {
  const d = req.body;
  try {
    const exists = db.prepare('SELECT id FROM businesses WHERE biz_id = ?').get(req.params.bizId);
    if (!exists) return res.status(404).json({ ok: false, error: 'Business not found' });

    db.prepare(`
      UPDATE businesses SET
        name=?, description=?, price_level=?, keywords=?,
        address=?, city=?, pincode=?, district=?, state=?,
        lat=?, lng=?, phone=?, phone2=?, email=?, website=?,
        whatsapp=?, upi=?, instagram=?, facebook=?, youtube=?,
        delivery=?, online_orders=?, show_phone=?,
        hours_note=?, hours_json=?, products_json=?, updated_at=?
      WHERE biz_id=?
    `).run(
      d.name, d.description, parseInt(d.priceLevel)||2, d.keywords||'',
      d.address||'', d.city||'', d.pincode||'', d.district||'', d.state||'Tamil Nadu',
      parseFloat(d.lat)||null, parseFloat(d.lng)||null,
      d.phone, d.phone2||'', d.email||'', d.website||'',
      d.whatsapp||'', d.upi||'', d.instagram||'', d.facebook||'', d.youtube||'',
      d.delivery?1:0, d.onlineOrders?1:0, d.showPhone?1:0,
      d.hoursNote||'',
      JSON.stringify(d.hours||{}), JSON.stringify(d.products||[]),
      now(), req.params.bizId
    );
    res.json({ ok: true, message: 'Updated successfully' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/businesses/:bizId — soft delete
app.delete('/api/businesses/:bizId', (req, res) => {
  try {
    db.prepare('UPDATE businesses SET is_active = 0, updated_at = ? WHERE biz_id = ?')
      .run(now(), req.params.bizId);
    res.json({ ok: true, message: 'Business removed' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════
//  ROUTES — FAVOURITES
// ══════════════════════════════════════

// GET /api/favourites/:deviceId
app.get('/api/favourites/:deviceId', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT f.biz_id, f.created_at, b.name, b.sector, b.sector_emoji, b.city
      FROM favourites f
      LEFT JOIN businesses b ON f.biz_id = b.biz_id
      WHERE f.device_id = ?
      ORDER BY f.created_at DESC
    `).all(req.params.deviceId);
    res.json({ ok: true, favourites: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/favourites — add favourite
app.post('/api/favourites', (req, res) => {
  const { deviceId, bizId } = req.body;
  if (!deviceId || !bizId) return res.status(400).json({ ok: false, error: 'deviceId and bizId required' });
  try {
    db.prepare('INSERT OR IGNORE INTO favourites (id, device_id, biz_id, created_at) VALUES (?,?,?,?)')
      .run(uuid(), deviceId, bizId, now());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/favourites — remove favourite
app.delete('/api/favourites', (req, res) => {
  const { deviceId, bizId } = req.body;
  try {
    db.prepare('DELETE FROM favourites WHERE device_id = ? AND biz_id = ?').run(deviceId, bizId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════
//  ROUTES — OFFERS
// ══════════════════════════════════════

// GET /api/offers — active offers near location
app.get('/api/offers', (req, res) => {
  const { lat, lng, city, radius = 5 } = req.query;
  try {
    let sql = `
      SELECT o.*, b.name as biz_name, b.sector_emoji, b.city, b.lat, b.lng
      FROM offers o
      JOIN businesses b ON o.biz_id = b.biz_id
      WHERE o.is_active = 1 AND b.is_active = 1
        AND (o.valid_until IS NULL OR o.valid_until > ?)
    `;
    const params = [now()];
    if (city) { sql += ' AND b.city LIKE ?'; params.push(`%${city}%`); }
    sql += ' ORDER BY o.created_at DESC LIMIT 50';

    let rows = db.prepare(sql).all(...params);

    if (lat && lng) {
      const uLat = parseFloat(lat), uLng = parseFloat(lng), rad = parseFloat(radius);
      rows = rows
        .map(r => ({ ...r, distance: r.lat && r.lng ? haversine(uLat, uLng, r.lat, r.lng) : 9999 }))
        .filter(r => r.distance <= rad)
        .sort((a, b) => a.distance - b.distance);
    }

    res.json({ ok: true, offers: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/offers — create offer
app.post('/api/offers', (req, res) => {
  const { bizId, title, description, discount, validUntil } = req.body;
  if (!bizId || !title) return res.status(400).json({ ok: false, error: 'bizId and title required' });
  try {
    const id = uuid();
    db.prepare('INSERT INTO offers (id, biz_id, title, description, discount, valid_until, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, bizId, title, description||'', discount||'', validUntil||null, now());
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════
//  ROUTES — ANALYTICS
// ══════════════════════════════════════

// POST /api/search-log — log a search
app.post('/api/search-log', (req, res) => {
  const { query, city, sector, lat, lng, resultCount } = req.body;
  try {
    db.prepare('INSERT INTO searches (id, query, city, sector, lat, lng, result_count, searched_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(uuid(), query||'', city||'', sector||'', lat||null, lng||null, resultCount||0, now());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/analytics — summary for admin
app.get('/api/analytics', (req, res) => {
  try {
    const total     = db.prepare('SELECT COUNT(*) as c FROM businesses WHERE is_active=1').get().c;
    const cities    = db.prepare('SELECT COUNT(DISTINCT city) as c FROM businesses WHERE is_active=1').get().c;
    const sectors   = db.prepare('SELECT sector, COUNT(*) as c FROM businesses WHERE is_active=1 GROUP BY sector ORDER BY c DESC LIMIT 10').all();
    const topCities = db.prepare('SELECT city, COUNT(*) as c FROM businesses WHERE is_active=1 AND city != "" GROUP BY city ORDER BY c DESC LIMIT 10').all();
    const searches  = db.prepare('SELECT query, COUNT(*) as c FROM searches WHERE query != "" GROUP BY query ORDER BY c DESC LIMIT 20').all();
    const recentBiz = db.prepare('SELECT name, city, sector_name, registered_at FROM businesses WHERE is_active=1 ORDER BY registered_at DESC LIMIT 5').all();

    res.json({ ok: true, stats: { total, cities, sectors, topCities, topSearches: searches, recentRegistrations: recentBiz } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════
//  HEALTH CHECK
// ══════════════════════════════════════
app.get('/', (req, res) => {
  const bizCount = db.prepare('SELECT COUNT(*) as c FROM businesses WHERE is_active=1').get().c;
  res.json({
    app: 'Deckscrab API',
    version: '1.0.0',
    status: 'running',
    businesses: bizCount,
    time: new Date().toISOString()
  });
});

app.get('/health', (req, res) => res.json({ ok: true }));

// ── START ──
app.listen(PORT, () => {
  console.log(`Deckscrab API running on port ${PORT}`);
  console.log(`Open: http://localhost:${PORT}`);
});
