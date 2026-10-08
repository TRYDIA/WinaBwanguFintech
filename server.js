require('dotenv').config();

const express = require("express");
const mysql = require("mysql2/promise");
const session = require("express-session");
const path = require("path");   

const app = express();
const PORT = process.env.PORT || 3000;


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

const db= mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
   
});

app.get('/api/test-db', async (req, res) => {
  try {
    const [rows] = await db.query('SHOW TABLES');
    res.json(rows);
  } catch (err) {
    console.error(err.code, err.message);
    res.status(500).json({ error: err.code });
  }
});

// LOGIN
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await db.query(
      'SELECT * FROM users WHERE username = ?', [username]
    );
    if (rows.length === 0 || rows[0].password !== password) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    req.session.user = {
      id: rows[0].id,
      username: rows[0].username,
      role: rows[0].role
    };
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error(err.code, err.message);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// WHO AM I (dashboard uses this to check login)
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  res.json(req.session.user);
});

// LOGOUT
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  next();
}

// ---------- TABLE DATA ----------
['booths', 'services', 'booth_services', 'transactions'].forEach(table => {
  app.get('/api/' + table, requireLogin, async (req, res) => {
    try {
      const [rows] = await db.query('SELECT * FROM ' + table);
      res.json(rows);
    } catch (err) {
      console.error(err.code, err.message);
      res.status(500).json({ error: err.message });
    }
  });
});

app.get('/api/booths/:boothId/services', requireLogin, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT s.service_id, s.service_name, s.monthly_limit, s.revenue_rate,
              COALESCE(SUM(t.transaction_amount), 0) AS used,
              s.monthly_limit - COALESCE(SUM(t.transaction_amount), 0) AS remaining
       FROM booth_services bs
       JOIN services s ON s.service_id = bs.service_id
       LEFT JOIN transactions t ON t.service_id = s.service_id
       WHERE bs.booth_id = ?
       GROUP BY s.service_id, s.service_name, s.monthly_limit, s.revenue_rate
       ORDER BY s.service_name`,
      [req.params.boothId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err.code, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/next-transaction-id', requireLogin, async (req, res) => {
  try {
    const [[row]] = await db.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(transaction_id, 3) AS UNSIGNED)), 0) + 1 AS next_number
       FROM transactions
       WHERE transaction_id LIKE 'WB%'`
    );
    res.json({ transaction_id: formatTransactionId(row.next_number) });
  } catch (err) {
    console.error(err.code, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/transactions', requireLogin, async (req, res) => {
  const { booth_id, service_id, amount } = req.body;
  const transactionAmount = Number(amount);
  const serviceId = Number(service_id);

  if (!booth_id || !serviceId || !Number.isFinite(transactionAmount) || transactionAmount <= 0) {
    return res.status(400).json({ error: 'Please provide a valid booth, service, and positive amount.' });
  }

  const connection = await db.getConnection();
  let hasIdLock = false;

  try {
    await connection.beginTransaction();

    const [[lockRow]] = await connection.query(`SELECT GET_LOCK('wina_next_transaction_id', 10) AS locked`);
    if (lockRow.locked !== 1) {
      await connection.rollback();
      return res.status(503).json({ error: 'Could not reserve a transaction ID. Please try again.' });
    }
    hasIdLock = true;

    // Lock the service row while checking its monthly limit.
    const [serviceRows] = await connection.query(
      `SELECT s.service_id, s.revenue_rate, s.monthly_limit
       FROM booth_services bs
       JOIN services s ON s.service_id = bs.service_id
       WHERE bs.booth_id = ? AND bs.service_id = ?
       FOR UPDATE`,
      [booth_id, serviceId]
    );

    if (serviceRows.length === 0) {
      await connection.rollback();
      await connection.query(`SELECT RELEASE_LOCK('wina_next_transaction_id')`);
      hasIdLock = false;
      return res.status(400).json({ error: 'This booth does not offer the selected service.' });
    }

    const service = serviceRows[0];
    const [[usageRow]] = await connection.query(
      `SELECT COALESCE(SUM(transaction_amount), 0) AS used
       FROM transactions
       WHERE service_id = ?`,
      [serviceId]
    );
    const remaining = Number(service.monthly_limit) - Number(usageRow.used);

    if (transactionAmount > remaining) {
      await connection.rollback();
      await connection.query(`SELECT RELEASE_LOCK('wina_next_transaction_id')`);
      hasIdLock = false;
      return res.status(400).json({
        error: `Insufficient credit remaining. This service has ZMW ${remaining.toFixed(2)} left.`
      });
    }

    const [[idRow]] = await connection.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(transaction_id, 3) AS UNSIGNED)), 0) + 1 AS next_number
       FROM transactions
       WHERE transaction_id LIKE 'WB%'`
    );
    const transactionId = formatTransactionId(idRow.next_number);
    const taxAmount = Number((transactionAmount * 0.05).toFixed(2));
    const revenueGenerated = Number((transactionAmount * Number(service.revenue_rate)).toFixed(2));

    await connection.query(
      `INSERT INTO transactions
        (transaction_id, booth_id, service_id, transaction_amount, tax_amount, revenue_generated)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [transactionId, booth_id, serviceId, transactionAmount, taxAmount, revenueGenerated]
    );

    const [[created]] = await connection.query(
      `SELECT t.transaction_id, t.booth_id, t.service_id, t.transaction_amount,
              t.tax_amount, t.revenue_generated, t.created_at
       FROM transactions t
       WHERE t.transaction_id = ?`,
      [transactionId]
    );

    await connection.commit();
    await connection.query(`SELECT RELEASE_LOCK('wina_next_transaction_id')`);
    hasIdLock = false;
    res.status(201).json(created);
  } catch (err) {
    await connection.rollback();
    if (hasIdLock) {
      await connection.query(`SELECT RELEASE_LOCK('wina_next_transaction_id')`);
    }
    console.error(err.code, err.message);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

function formatTransactionId(number) {
  return `WB${String(number).padStart(7, '0')}`;
}

app.get('/api/dashboard', requireLogin, async (req, res) => {
  try {
    const [[summary]] = await db.query(
      `SELECT COUNT(*) AS transactions,
              SUM(transaction_amount) AS total_amount,
              SUM(tax_amount) AS total_tax,
              SUM(revenue_generated) AS total_revenue
       FROM transactions`);
    const [[cap]] = await db.query(
      'SELECT SUM(monthly_limit) AS total_capital FROM services');

    const [services] = await db.query(
      `SELECT s.service_name, s.monthly_limit,
              COALESCE(SUM(t.transaction_amount), 0) AS used,
              s.monthly_limit - COALESCE(SUM(t.transaction_amount), 0) AS remaining,
              COALESCE(SUM(t.tax_amount), 0) AS tax
       FROM services s
       LEFT JOIN transactions t ON t.service_id = s.service_id
       GROUP BY s.service_id, s.service_name, s.monthly_limit`);

    const [booths] = await db.query(
      `SELECT b.booth_id, b.location,
              COUNT(t.transaction_id) AS transactions,
              COALESCE(SUM(t.revenue_generated), 0) AS revenue,
              COALESCE(SUM(t.tax_amount), 0) AS tax
       FROM booths b
       LEFT JOIN transactions t ON t.booth_id = b.booth_id
       GROUP BY b.booth_id, b.location
       ORDER BY b.booth_id`);

    const [frequency] = await db.query(
      `SELECT t.booth_id, s.service_name, COUNT(*) AS count
       FROM transactions t
       JOIN services s ON s.service_id = t.service_id
       GROUP BY t.booth_id, s.service_name
       ORDER BY t.booth_id, s.service_name`);

    res.json({ summary: { ...summary, ...cap }, services, booths, frequency });
  } catch (err) {
    console.error(err.code, err.message);
    res.status(500).json({ error: err.message });
  }
});
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
