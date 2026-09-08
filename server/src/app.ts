import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { globalRateLimit } from './middleware/rateLimit';
import { requestIdMiddleware } from './middleware/request-id';
import { errorHandler } from './middleware/errorHandler';
import { ErrorCode } from './errors/error-codes';
import { createHealthRouter } from './health/health.routes';
import { authRouter } from './modules/auth/auth.routes';
import { sitesRouter } from './modules/sites/sites.routes';
import { contractorsRouter } from './modules/contractors/contractors.routes';
import { categoriesRouter } from './modules/categories/categories.routes';
import { suppliersRouter } from './modules/suppliers/suppliers.routes';
import { materialsRouter, categoryMaterialsRouter } from './modules/materials/materials.routes';
import { ordersRouter } from './modules/orders/orders.routes';
import { hqRouter } from './modules/hq/hq.routes';
import { pushRouter } from './modules/push/push.routes';

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',') }));
// Mounted before body parsing and rate limiting so every response — including a 400 from a
// malformed body or a 429 from the rate limiter — still carries X-Request-ID.
app.use(requestIdMiddleware);
// Mounted before body parsing and the global rate limiter: infrastructure (a load balancer,
// Kubernetes) can poll these on a tight loop, and a GET here never has — or needs — a JSON body.
// `/health` below is a pre-existing route kept as a compatibility alias for liveness; it stays
// exactly where it was (after the rate limiter) so its existing behavior is unchanged.
app.use('/health', createHealthRouter());
app.use(express.json());
app.use(globalRateLimit);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRouter);
app.use('/sites', sitesRouter);
app.use('/contractors', contractorsRouter);
app.use('/categories', categoriesRouter);
app.use('/categories', categoryMaterialsRouter);
app.use('/suppliers', suppliersRouter);
app.use('/materials', materialsRouter);
app.use('/orders', ordersRouter);
app.use('/hq', hqRouter);
app.use('/push', pushRouter);

// Reached only when no router above matched — keeps an unknown route consistent with the rest of
// the API's JSON error contract instead of Express's default plain-text/HTML 404.
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', code: ErrorCode.NOT_FOUND, requestId: req.requestId });
});

app.use(errorHandler);
