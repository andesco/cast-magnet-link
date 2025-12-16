import 'dotenv/config'; // MUST be first to load .env before other imports
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import app from './app.js';
import { getConfig } from './config.node.js';

const config = getConfig(process.env);

// Static file serving for Node.js - only serve actual static asset directories
app.use('/style.css', serveStatic({ path: './public/style.css' }));
app.use('/Infuse/*', serveStatic({ root: './public' }));
app.use('/metadata/*', serveStatic({ root: './public' }));

console.log('Starting Node.js server...');

serve({
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
}, (info) => {
    // Display localhost instead of 0.0.0.0 for user-friendly URLs
    const displayAddress = info.address === '0.0.0.0' || info.address === '::' ? 'localhost' : info.address;

    console.log(`
╔═══════════════════════════════════════════════╗
║         Cast Magnet Link Service Started      ║
╚═══════════════════════════════════════════════╝`);
    console.log(`  HTTP Server: http://${displayAddress}:${info.port}`);
    console.log(`  WebDAV:      http://${displayAddress}:${info.port}/`);
    console.log(`
WebDAV Credentials:
  Username: ${config.webdavUsername}
  Password: ********`);
});