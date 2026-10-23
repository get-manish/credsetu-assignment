import express from 'express';
import { config } from './config';
import { errorHandler, notFound } from './middleware/errorHandler';
import { authRouter } from './routes/auth';
import { loansRouter } from './routes/loans';

// The app is built here and exported WITHOUT calling listen(),
// so tests (supertest) can use it without opening a real port.
export const app = express();

app.use(express.json());

// Serve uploaded receipt images. nosniff stops browsers from treating a file as HTML.
app.use(
  '/uploads',
  express.static(config.uploadsDir, {
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  }),
);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRouter);
app.use('/loans', loansRouter);

// Order matters: unknown-route handler first, error handler last.
app.use(notFound);
app.use(errorHandler);
