const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI || process.env.DATABASE_URL || '';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

let db = null;
let useMemory = true;
let connectError = '';
let mongoUrlStatus = MONGO_URL ? `set (${MONGO_URL.substring(0,30)}...)` : 'NOT SET';

let _businesses = [];
let _orders = [];

async function connectDB() {
  if (!MONGO_URL) {
    console.log('❌ MONGO_URL not set');
    connectError = 'MONGO_URL environment variable not set';
    return;
  }
  
  console.log('Connecting to:', MONGO_URL.substring(0, 40) + '...');
  
  try {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(MONGO_URL, {
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
      socketTimeoutMS: 15000,
    });
    
    await client.connect();
    db = client.db('deckscrab');
    await db.command({ ping: 1 });
    
    useMemory = false;
    connectError = '';
    console.log('✅ MongoDB connected!');
    
    // Handle disconnection
    client.on('close', () => {
      console.log('MongoDB disconnected');
      useMemory = true;
    });
    
  } catch(e) {
    connectError = e.message;
    useMemory = true;
    console.log('❌ MongoDB failed:', e.message);
  }
}

// ═══ ROOT ═══
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    storage: useMemory ? 'memory' : 'mongodb',
    mongoUrl: mongoUrlStatus,
    mongoConnected: !useMemory,
    connectError: connectError || null
  });
});

app.get('/health', async (req, res) => {
  let bizCount = 0, orderCount = 0;
  try {
    if (!useMemory && db) {
      bizCount = await db.collection('businesses').countDocuments();
      orderCount = await db.collection('orders').countDocuments();
    } else {
      bizCount = _businesses.length;
      orderCount = _orders.length;
    }
  } catch(e) {}
  res.json({
    status: 'ok',
    storage: useMemory ? 'memory' : 'mongodb',
    mongoConnected: !useMemory,
    mongoUrl: mongoUrlStatus,
    connectError: connectError || null,
    uptime: process.uptime(),
    businesses: bizCount,
    orders: orderCount,
    pendingOrders: useMemory
      ? _orders.filter(o=>o.status==='pending').length
      : 0
  });
});

// ═══ BUSINESSES ═══
app.get('/api/businesses', async (req, res) => {
  const limit = parseInt(req.query.limit) || 200;
  const search = (req.query.search || '').toLowerCase();
  try {
    let businesses;
    if (!useMemory && db) {
      let query = {};
      if (search) query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } }
      ];
      businesses = await db.collection('businesses').find(query).sort({ createdAt: -1 }).limit(limit).toArray();
    } else {
      businesses = [..._businesses];
      if (search) businesses = businesses.filter(b =>
        (b.name||'').toLowerCase().includes(search) ||
        (b.city||'').toLowerCase().includes(search)
      );
      businesses = businesses.slice(0, limit);
    }
    res.json({ businesses, total: businesses.length });
  } catch(e) {
    res.json({ businesses: _businesses.slice(0, limit), total: _businesses.length });
  }
});

app.get('/api/businesses/:id', async (req, res) => {
  try {
    let b;
    if (!useMemory && db) {
      b = await db.collection('businesses').findOne({
        $or: [{ id: req.params.id }, { bizId: req.params.id }]
      });
    } else {
      b = _businesses.find(x => x.id === req.params.id || x.bizId === req.params.id);
    }
    if (!b) return res.status(404).json({ error: 'Not found' });
    res.json(b);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/businesses', async (req, res) => {
  const bizId = req.body.bizId || 'BIZ-' + Date.now();
  const business = { ...req.body, id: req.body.id || bizId, bizId, createdAt: req.body.createdAt || Date.now() };
  try {
    if (!useMemory && db) {
      const existing = await db.collection('businesses').findOne({
        $or: [{ id: business.id }, { bizId: business.bizId }]
      });
      if (existing) {
        await db.collection('businesses').updateOne({ _id: existing._id }, { $set: { ...business, updatedAt: Date.now() } });
        res.json({ ok: true, bizId: existing.bizId, id: existing.id, updated: true });
      } else {
        await db.collection('businesses').insertOne(business);
        res.json({ ok: true, bizId, id: bizId });
      }
    } else {
      const idx = _businesses.findIndex(x => x.id === business.id || x.bizId === business.bizId);
      if (idx >= 0) _businesses[idx] = business; else _businesses.unshift(business);
      if (_businesses.length > 1000) _businesses.splice(1000);
      res.json({ ok: true, bizId, id: bizId });
    }
  } catch(e) {
    _businesses.unshift(business);
    res.json({ ok: true, bizId, id: bizId, fallback: true });
  }
});

app.patch('/api/businesses/:id', async (req, res) => {
  try {
    if (!useMemory && db) {
      await db.collection('businesses').updateOne(
        { $or: [{ id: req.params.id }, { bizId: req.params.id }] },
        { $set: { ...req.body, updatedAt: Date.now() } }
      );
    } else {
      const idx = _businesses.findIndex(x => x.id === req.params.id || x.bizId === req.params.id);
      if (idx >= 0) _businesses[idx] = { ..._businesses[idx], ...req.body };
    }
    res.json({ ok: true });
  } catch(e) { res.json({ ok: true }); }
});

app.delete('/api/businesses/:id', async (req, res) => {
  try {
    if (!useMemory && db) {
      await db.collection('businesses').deleteOne({ $or: [{ id: req.params.id }, { bizId: req.params.id }] });
    } else {
      _businesses = _businesses.filter(x => x.id !== req.params.id && x.bizId !== req.params.id);
    }
    res.json({ ok: true });
  } catch(e) { res.json({ ok: true }); }
});

// ═══ ORDERS ═══
app.get('/api/orders', async (req, res) => {
  const limit = parseInt(req.query.limit) || 200;
  const shopPhone = (req.query.shopPhone || '').replace(/\D/g, '');
  const shopName = (req.query.shopName || '').toLowerCase();
  try {
    let orders;
    if (!useMemory && db) {
      let query = {};
      if (shopPhone) query.shopPhone = { $regex: shopPhone };
      if (shopName) query.shopName = { $regex: shopName, $options: 'i' };
      orders = await db.collection('orders').find(query).sort({ createdAt: -1 }).limit(limit).toArray();
    } else {
      orders = [..._orders];
      if (shopPhone) orders = orders.filter(o => (o.shopPhone||'').replace(/\D/g,'') === shopPhone);
      if (shopName) orders = orders.filter(o => (o.shopName||'').toLowerCase().includes(shopName));
      orders = orders.slice(0, limit);
    }
    res.json({ orders, total: orders.length, pending: orders.filter(o=>o.status==='pending').length });
  } catch(e) { res.json({ orders: [], total: 0, pending: 0 }); }
});

app.post('/api/orders', async (req, res) => {
  const order = { ...req.body, _serverId: 'ORD-' + Date.now(), serverCreatedAt: Date.now(), status: req.body.status || 'pending' };
  try {
    if (!useMemory && db) {
      const existing = await db.collection('orders').findOne({ orderId: order.orderId });
      if (!existing) await db.collection('orders').insertOne(order);
    } else {
      const exists = _orders.find(o => o.orderId === order.orderId);
      if (!exists) { _orders.unshift(order); if (_orders.length > 1000) _orders.splice(1000); }
    }
    res.json({ ok: true, id: order._serverId, orderId: order.orderId });
  } catch(e) {
    _orders.unshift(order);
    res.json({ ok: true, fallback: true });
  }
});

app.patch('/api/orders/:id', async (req, res) => {
  try {
    if (!useMemory && db) {
      await db.collection('orders').updateOne(
        { $or: [{ id: req.params.id }, { _serverId: req.params.id }, { orderId: req.params.id }] },
        { $set: { ...req.body, updatedAt: Date.now() } }
      );
    } else {
      const o = _orders.find(x => x.id === req.params.id || x.orderId === req.params.id);
      if (o) Object.assign(o, req.body);
    }
    res.json({ ok: true });
  } catch(e) { res.json({ ok: true }); }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    if (!useMemory && db) {
      await db.collection('orders').deleteOne({ $or: [{ id: req.params.id }, { orderId: req.params.id }] });
    } else {
      _orders = _orders.filter(x => x.id !== req.params.id && x.orderId !== req.params.id);
    }
    res.json({ ok: true });
  } catch(e) { res.json({ ok: true }); }
});

// ═══ START ═══
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Deckscrab API port ${PORT} | ${useMemory ? 'MEMORY' : 'MONGODB'}`);
  });
});
