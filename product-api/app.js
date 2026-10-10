require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const productRoutes = require('./routes/productRoutes');

const app = express();

app.use(express.json());

app.get('/health', (_req, res) => {
  const healthy = mongoose.connection.readyState === 1;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'unavailable',
    database: healthy ? 'connected' : 'disconnected'
  });
});

app.use('/api/products', productRoutes);

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'internal server error' });
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/productdb';

  async function start() {
    await mongoose.connect(mongoUri);
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`Product API listening on port ${port}`);
    });

    const shutdown = () => {
      server.close(async (error) => {
        if (error) {
          console.error('Failed to close HTTP server:', error);
          process.exitCode = 1;
        }
        await mongoose.disconnect();
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  start().catch(async (error) => {
    console.error('Failed to start Product API:', error);
    await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = app;
