import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

function zktecoDevPlugin() {
  return {
    name: 'zkteco-adms-dev-middleware',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const url = req.url || '';
        if (url.startsWith('/api/ai/hr-intelligence') && req.method === 'POST') {
          try {
            const chunks: any[] = [];
            for await (const chunk of req) {
              chunks.push(chunk);
            }
            const rawBody = Buffer.concat(chunks).toString('utf-8');
            const { handleAiHrIntelligenceRequest } = await import('./src/server/aiHrIntelligenceHandler.ts');
            const result = await handleAiHrIntelligenceRequest(rawBody);
            res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result.body));
            return;
          } catch (err: any) {
            console.error('[Server AI HR Intelligence Error]:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err?.message || 'Internal AI server error' }));
            return;
          }
        }
        if (url.startsWith('/iclock/') || url.startsWith('/zkteco/')) {
          try {
            const { handler } = await import('./netlify/functions/iclock.js');
            const parsedUrl = new URL(url, 'http://localhost:3000');
            const queryParams: Record<string, string> = {};
            parsedUrl.searchParams.forEach((val, key) => {
              queryParams[key] = val;
            });

            let body = '';
            if (req.method === 'POST' || req.method === 'PUT') {
              const chunks: any[] = [];
              for await (const chunk of req) {
                chunks.push(chunk);
              }
              body = Buffer.concat(chunks).toString('utf-8');
            }

            const event = {
              httpMethod: req.method,
              path: parsedUrl.pathname,
              queryStringParameters: queryParams,
              headers: req.headers,
              body,
              isBase64Encoded: false,
            };

            const response = await handler(event);
            res.writeHead(
              response.statusCode || 200,
              response.headers || { 'Content-Type': 'text/plain' }
            );
            res.end(response.body || '');
            return;
          } catch (err: any) {
            console.error('[Vite ZKTeco Middleware] Error:', err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(`Internal Error: ${err.message}`);
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), zktecoDevPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
