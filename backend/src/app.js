const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const env = require('./config/environment');
const logger = require('./config/logger');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

// 0. Baseline security response headers.
//
// This API serves patient-identifying records, so the defaults matter: nosniff, frameguard
// (an attacker's page cannot iframe an authenticated response), HSTS, and a referrer policy
// that stops URLs leaking to third parties. contentSecurityPolicy is off because this process
// only ever returns JSON and file downloads — the CSP that matters belongs to the Vite app,
// and a policy declared here would be both inert and misleading.
app.use(helmet({ contentSecurityPolicy: false }));

// 1. Cross-Origin Resource Sharing (CORS)
//
// Restricted to the configured frontend origin instead of the previous bare cors(), which
// reflected ANY origin. Because the browser sends the bearer token from JS rather than a
// cookie, a wide-open policy let any page a signed-in staff member visited call this API with
// their token and read the response. Extra origins can be listed in CORS_ORIGINS (comma
// separated) for staging or LAN testing.
const allowedOrigins = new Set(
  [env.FRONTEND_URL, ...(process.env.CORS_ORIGINS || '').split(',')]
    .map((o) => o.trim())
    .filter(Boolean)
);
app.use(cors({
  origin: (origin, cb) => {
    // No Origin header: same-origin, curl, health checks, and the PayMongo webhook. These are
    // not browser cross-origin requests, so CORS is not the control that applies to them.
    if (!origin || allowedOrigins.has(origin)) return cb(null, true);
    // Withhold the header rather than raising: an error here surfaces as a 500, which reads as
    // a server fault and tells the caller more than it should. Omitting the header is what
    // actually stops the browser handing the response to the calling page.
    return cb(null, false);
  },
  credentials: true
}));

// 2. Parse Incoming JSON and URL-encoded requests
//
// The `verify` hook stashes the raw request bytes on req.rawBody. The PayMongo payment webhook
// signs the exact bytes it sent, so verifying against a re-serialised req.body would fail on
// every legitimate delivery (key order and whitespace are not preserved by a parse/stringify
// round trip). Capturing here — rather than mounting the webhook route ahead of this parser —
// keeps route ordering, CORS, logging and rate limiting identical for every endpoint.
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));

// 3. HTTP Request Logging (using Morgan redirected to Winston logger)
const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(morganFormat, {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

// 4. Rate Limiting Middleware
// Production stays deliberately tight at 100/15min. The dev ceiling exists only so the
// frontend/tests/e2e Playwright suite can run: that suite is now ~190 tests, most of which
// perform several authenticated API calls, and it comfortably exceeded the previous 1000 —
// exhausting the window mid-run and failing ~25 specs with a misleading
// "Cannot read properties of undefined (reading 'token')" rather than an obvious 429.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 100 : 20000,
  message: {
    status: 'error',
    message: 'Too many requests from this IP, please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// 5. Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Enlogada Clinic Backend API is healthy and running.',
    timestamp: new Date().toISOString()
  });
});

// 6. Mount feature routes
const authRoutes = require('./routes/authRoutes');
const patientRoutes = require('./routes/patientRoutes');
const visitRoutes = require('./routes/visitRoutes');
const appointmentRoutes = require('./routes/appointmentRoutes');
const testRoutes = require('./routes/testRoutes');
const resultRoutes = require('./routes/resultRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const hmoRoutes = require('./routes/hmoRoutes');
const rbacRoutes = require('./routes/rbacRoutes');
const adminRoutes = require('./routes/adminRoutes');
const superAdminRoutes = require('./routes/superAdminRoutes');
const reportRoutes = require('./routes/reportRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const discountRoutes = require('./routes/discountRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/discounts', discountRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/tests', testRoutes);
app.use('/api/results', resultRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/hmo', hmoRoutes);
app.use('/api/rbac', rbacRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/superadmin', superAdminRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);

// 6. Global Catch-all Error Handling Middleware
app.use(errorHandler);

module.exports = app;
