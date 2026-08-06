const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const logger = require('./config/logger');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

// 1. Enable Cross-Origin Resource Sharing (CORS)
app.use(cors());

// 2. Parse Incoming JSON and URL-encoded requests
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. HTTP Request Logging (using Morgan redirected to Winston logger)
const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(morganFormat, {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

// 4. Rate Limiting Middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
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

app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/tests', testRoutes);
app.use('/api/results', resultRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/hmo', hmoRoutes);

// 6. Global Catch-all Error Handling Middleware
app.use(errorHandler);

module.exports = app;
