import { serveStatic } from 'hono/cloudflare-workers';
import app from './app.js';

// Static file serving for Cloudflare Workers
app.use('/style.css', serveStatic({ path: './public/style.css' }));
app.use('/Infuse/*', serveStatic({ root: './public' }));
app.use('/metadata/*', serveStatic({ root: './public' }));

export default app;