const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ═══ IN-MEMORY STORAGE ═══
let businesses = [];
let orders = [];

// ═══ ROOT ═══
app.get('/', (req, res) => {
  res.json({ 
    status: 'Deckscrab API running',
    endpoints: ['/api/businesses', '/api/orders'],
    businesses: businesses.length,
    orders: orders.length
  });
});

// ════════════════════════════════
// BUSINESSES
// ════════════════════════════════

// GET all businesses
app.get('/api/businesses', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const sector = req.query.sector;
  const city = req.query.city;
  const search = req.query.search;

  let result = [...businesses];

  if (sector) result = result.filter(b => 
    (b.sector||'').toLowerCase().includes(sector.toLowerCase()) ||
    (b.sectorName||'').toLowerCase().includes(sector.toLowerCase())
  );
  if (city) result = result.filter(b => 
    (b.city||'').toLowerCase().includes(city.toLowerCase())
  );
  if (search) result = result.filter(b => 
    (b.name||'').toLowerCase().includes(search.toLowerCase()) ||
    (b.description||'').toLowerCase().includes(search.toLowerCase())
  );

  res.json({ 
    businesses: result.slice(0, limit),
    total: result.length
  });
});

// GET single business
app.get('/api/businesses/:id', (req, res) => {
  const b = businesses.find(x => x.id === req.params.id || x.bizId === req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  res.json(b);
});

// POST create business
app.post('/api/businesses', (req, res) => {
  const bizId = 'BIZ-' + Date.now();
  const business = {
    ...req.body,
    id: bizId,
    bizId,
    createdAt: Date.now(),
    views: 0,
    rating: 0,
    reviewCount: 0
  };
  businesses.unshift(business);
  if (businesses.length > 1000) businesses.splice(1000);
  res.json({ ok: true, bizId, id: bizId });
});

// PATCH update business
app.patch('/api/businesses/:id', (req, res) => {
  const idx = businesses.findIndex(x => x.id === req.params.id || x.bizId === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  businesses[idx] = { ...businesses[idx], ...req.body, updatedAt: Date.now() };
  res.json({ ok: true });
});

// DELETE business
app.delete('/api/businesses/:id', (req, res) => {
  const before = businesses.length;
  businesses = businesses.filter(x => x.id !== req.params.id && x.bizId !== req.params.id);
  res.json({ ok: true, deleted: before - businesses.length });
});

// ════════════════════════════════
// ORDERS — NEW ENDPOINTS
// ════════════════════════════════

// GET all orders (shopkeeper fetches by shopPhone or shopName)
app.get('/api/orders', (req, res) => {
  const limit = parseInt(req.query.limit) || 200;
  const shopPhone = req.query.shopPhone;
  const shopName = req.query.shopName;
  const status = req.query.status;

  let result = [...orders];

  if (shopPhone) {
    const clean = shopPhone.replace(/\D/g, '');
    result = result.filter(o => (o.shopPhone||'').replace(/\D/g,'') === clean);
  }
  if (shopName) {
    result = result.filter(o => 
      (o.shopName||'').toLowerCase().includes(shopName.toLowerCase())
    );
  }
  if (status) {
    result = result.filter(o => o.status === status);
  }

  res.json({ 
    orders: result.slice(0, limit),
    total: result.length,
    pending: result.filter(o => o.status === 'pending').length
  });
});

// GET single order
app.get('/api/orders/:id', (req, res) => {
  const o = orders.find(x => x.id === req.params.id || x.orderId === req.params.id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  res.json(o);
});

// POST create order (called when customer places order)
app.post('/api/orders', (req, res) => {
  // Don't store OTP on server for security — only used for cross-device sync
  const { otp, ...safeOrder } = req.body;
  const order = {
    ...safeOrder,
    _id: 'ORD-' + Date.now(),
    otp, // still store otp so shopkeeper can verify
    status: req.body.status || 'pending',
    serverCreatedAt: Date.now()
  };
  orders.unshift(order);
  if (orders.length > 1000) orders.splice(1000);
  res.json({ ok: true, id: order._id, orderId: order.orderId });
});

// PATCH update order status (confirm / reject)
app.patch('/api/orders/:id', (req, res) => {
  const o = orders.find(x => 
    x.id === req.params.id || 
    x._id === req.params.id || 
    x.orderId === req.params.id
  );
  if (!o) return res.status(404).json({ error: 'Not found' });
  Object.assign(o, req.body, { updatedAt: Date.now() });
  res.json({ ok: true, order: o });
});

// DELETE order
app.delete('/api/orders/:id', (req, res) => {
  const before = orders.length;
  orders = orders.filter(x => 
    x.id !== req.params.id && 
    x._id !== req.params.id && 
    x.orderId !== req.params.id
  );
  res.json({ ok: true, deleted: before - orders.length });
});

// ════════════════════════════════
// HEALTH CHECK
// ════════════════════════════════
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    uptime: process.uptime(),
    businesses: businesses.length,
    orders: orders.length,
    pendingOrders: orders.filter(o => o.status === 'pending').length
  });
});

app.listen(PORT, () => {
  console.log(`Deckscrab API running on port ${PORT}`);
});
