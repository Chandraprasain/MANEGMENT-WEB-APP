import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer as createViteServer } from 'vite';
import { getDb } from './server/db';
import { attachAuthMiddleware } from './server/security';
import { initRealtimeServer } from './server/realtime';
import { createAuthRouter } from './server/routes/auth';
import { createSchoolAdminRouter } from './server/routes/schoolAdmin';
import { createAcademicsRouter } from './server/routes/academics';
import { createSocialAndOpsRouter } from './server/routes/socialAndOps';
import { createAutomationAndAiRouter } from './server/routes/automationAndAi';
import { createCurriculumAndAssessmentRouter } from './server/routes/curriculumAndAssessment';
import { createFinanceHubRouter } from './server/routes/financeHub';
import { createTrustAndCommunityRouter } from './server/routes/trustAndCommunity';

export function createApp(customDbPath?: string) {
  const db = getDb(customDbPath);
  const app = express();

  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());
  app.use(attachAuthMiddleware(db));

  app.get('/api/v1/health', (_req, res) => {
    res.json({ success: true, status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api/v1/auth', createAuthRouter(db));
  app.use('/api/v1', createSchoolAdminRouter(db));
  app.use('/api/v1/academics', createAcademicsRouter(db));
  app.use('/api/v1', createSocialAndOpsRouter(db));
  app.use('/api/v1', createAutomationAndAiRouter(db));
  app.use('/api/v1', createCurriculumAndAssessmentRouter(db));
  app.use('/api/v1', createFinanceHubRouter(db));
  app.use('/api/v1', createTrustAndCommunityRouter(db));

  // Global error handler — never leak raw SQL stack traces
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled API error:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'An unexpected server error occurred.',
      error: { code: 'INTERNAL_ERROR', details: null },
    });
  });

  return { app, db };
}

async function startServer() {
  const PORT = Number(process.env.PORT || 3000);
  const { app, db } = createApp();
  const server = http.createServer(app);

  initRealtimeServer(server, db);

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });
    app.get('/@vite/client', (_req, res) => {
      res.type('application/javascript').send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  const data = {};
  return {
    data,
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return \`\${pathname}?\${queryToInject}\${search ? '&' + search.slice(1) : ''}\${hash || ''}\`;
}
export class ErrorOverlay {}
`);
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`ShikshyaPlus full-stack server listening on http://0.0.0.0:${PORT}`);
  });
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectRun) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
