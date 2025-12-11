
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { getConfig } from './config.js';
import storage from './storage.js';
import * as rdClient from './rdClient.js';

const app = new Hono();

// --- Middleware ---

// Middleware to load config and validate
app.use('*', async (c, next) => {
    // When in Node.js, Hono's `c.env` is empty. We must read from `process.env`.
    // In a Worker, `c.env` contains the bindings, and `process` is undefined.
    const env = typeof process !== 'undefined' ? process.env : c.env;

    // Debug: log what we're receiving
    console.log('Environment type:', typeof env);
    console.log('Environment keys:', Object.keys(env));
    console.log('Environment:', JSON.stringify(Object.keys(env)));
    console.log('RD_ACCESS_TOKEN present:', 'RD_ACCESS_TOKEN' in env);
    console.log('WEBDAV_PASSWORD present:', 'WEBDAV_PASSWORD' in env);
    console.log('CAST_MAGNET_LINK present:', 'CAST_MAGNET_LINK' in env);

    const config = getConfig(env);

    if (!config.rdAccessToken || !config.webdavPassword) {
        return c.text('Server configuration is invalid. Missing required environment variables.', 500);
    }
    c.set('config', config);
    await next();
});

// Basic Auth Middleware
app.use('/webdav/*', async (c, next) => {
    const config = c.get('config');
    const auth = basicAuth({
        username: config.webdavUsername,
        password: config.webdavPassword,
    });
    return auth(c, next);
});
app.use('/add*', async (c, next) => {
    const config = c.get('config');
    const auth = basicAuth({
        username: config.webdavUsername,
        password: config.webdavPassword,
    });
    return auth(c, next);
});


// --- HTML Templates ---

function getHomePage(error = null, success = null, downloads = []) {
  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Cast Magnet Link</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
    <link rel="stylesheet" href="/style.css?2025-12-11">
</head>
<body>
    <main class="container">
        <article>
            <header>
                ${error ? `<p style="color: red;">${error}</p>` : ''}
                ${success ? `<p style="color: green;">${success}</p>` : ''}
                <h2>Cast Magnet Link</h2>
                <p>Enter a magnet link or infohash to add to WebDAV</p>
            </header>

            ${downloads && downloads.length > 0 ? `
            <div class="status-info">
                <h3>Currently Casted Media:</h3>
                <ul>
                    ${downloads.map(d => `
                    <li>${d.filename} <small><code>${formatBytes(d.filesize || 0)}</code></small></li>
                    `).join('')}
                </ul>
            </div>
            ` : ''}

            <form method="POST" action="/add">
                <input type="text" name="magnet" placeholder="magnet:?xt=urn:btih:... or infohash" required autofocus>
                <button type="submit">Add Magnet Link</button>
            </form>

            <footer style="margin-top: 2rem; text-align: center;">
                <small>
                    <a href="/">Home</a> &middot;
                    <a href="/add">Add Magnet Link</a> &middot;
                    <a href="/webdav/">WebDAV Files</a>
                </small>
            </footer>

        </article>
    </main>
</body>
</html>`;
}

function getAddPage(error = null, success = null, torrentInfo = null) {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Add Magnet - Cast Magnet Link</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
    <link rel="stylesheet" href="/style.css?2025-12-11">
</head>
<body>
    <main class="container">
        <article>
            <header>
                ${error ? `<p style="color: red;">${error}</p>` : ''}
                ${success ? `<p style="color: green;">${success}</p>` : ''}
                <h2>${success || error || 'Cast Magnet Link: Add'}</h2>
                ${!success && !error ? '<p>Enter a magnet link or infohash</p>' : ''}
            </header>

            ${torrentInfo ? `
            <div>
                <p>Infohash: <code>${torrentInfo.hash}</code></p>
                <p>File: ${torrentInfo.filename || torrentInfo.hash.substring(0, 8) + '...'} <small><code>${formatBytes(torrentInfo.bytes || 0)}</code></small>
            </div>
            ` : ''}

            <form method="POST" action="/add">
                <input type="text" name="magnet" placeholder="magnet:?xt=urn:btih:... or infohash" required autofocus>
                <button type="submit">Add Magnet Link</button>
            </form>

            <footer style="margin-top: 2rem; text-align: center;">
                <small>
                    <a href="/">Home</a> &middot;
                    <a href="/add">Add Magnet Link</a> &middot;
                    <a href="/webdav/">WebDAV Files</a>
                </small>
            </footer>

        </article>
    </main>
</body>
</html>`;
}

function getSelectFilePage(files, torrentId, title) {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Select File - Cast Magnet Link</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
</head>
<body>
    <main class="container">
        <article>
            <header>
                <h2>Select File to Cast</h2>
                <p>${title || 'Multiple files found'}</p>
            </header>

            <form method="POST" action="/add/select">
                <input type="hidden" name="torrentId" value="${torrentId}">
                ${files.map((file, idx) => `
                <label>
                    <input type="radio" name="fileId" value="${file.id}" ${idx === 0 ? 'checked' : ''} required>
                    ${file.name || file.path} <code>${formatBytes(file.size || file.bytes || 0)}</code>
                </label>
                `).join('')}
                <button type="submit" style="margin-top: 1rem;">Cast Selected File</button>
            </form>
        </article>
    </main>
</body>
</html>`;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    // Always show MB as GB for better readability
    if (i === 2) { // MB
        const gb = bytes / Math.pow(k, 3);
        return Math.round(gb * 100) / 100 + ' GB';
    }

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}


// --- Core Logic Helpers ---

function extractLinkId(rdLink) {
    if (!rdLink) return null;
    try {
        const url = new URL(rdLink);
        const pathParts = url.pathname.split('/');
        if (url.hostname === 'real-debrid.com' && pathParts[1] === 'd' && pathParts[2]) {
            return pathParts[2];
        }
    } catch (error) {
        console.error('Error parsing RD link:', error.message);
    }
    return null;
}

function getAutoSelectFile(files) {
    if (!files || files.length === 0) return null;
    if (files.length === 1) return files[0];

    const TWO_MB = 2 * 1024 * 1024;
    const largeFiles = files.filter(f => (f.bytes || f.size || 0) > TWO_MB);

    if (largeFiles.length === 1) {
        console.log(`Auto-selecting only large file (${formatBytes(largeFiles[0].bytes || largeFiles[0].size)})`);
        return largeFiles[0];
    }
    return null;
}

async function processMagnet(c, magnetOrHash) {
    const config = c.get('config');
    console.log('Adding magnet/hash:', magnetOrHash.substring(0, 50) + '...');

    const addResult = await rdClient.addTorrent(config, magnetOrHash);
    const torrentId = addResult.id;
    console.log('Torrent added with ID:', torrentId);

    await new Promise(resolve => setTimeout(resolve, 2000));

    const torrentInfo = await rdClient.getTorrentInfo(config, torrentId);
    console.log('Torrent status:', torrentInfo.status);

    if (torrentInfo.status === 'waiting_files_selection') {
        const fileToSelect = getAutoSelectFile(torrentInfo.files);
        if (fileToSelect) {
            return processSelectedFile(c, torrentId, fileToSelect.id.toString());
        }
        else {
            return c.html(getSelectFilePage(torrentInfo.files, torrentId, torrentInfo.filename));
        }
    }

    if (!torrentInfo.links || torrentInfo.links.length === 0) {
        throw new Error('No links available for torrent');
    }

    const originalLink = torrentInfo.links[0];
    const unrestrictedUrl = await rdClient.unrestrictLink(config, originalLink);
    const filename = torrentInfo.filename;

    const linkId = extractLinkId(originalLink);
    if (linkId) {
        await storage.addStrmEntry(c.env, linkId, originalLink, unrestrictedUrl, filename, true);
    }

    await rdClient.deleteTorrent(config, torrentInfo.id);

    return c.html(getAddPage(null, 'Media ready to cast', {
        hash: torrentInfo.hash,
        filename: filename,
        bytes: torrentInfo.bytes,
    }));
}

async function processSelectedFile(c, torrentId, fileId) {
    const config = c.get('config');
    console.log('File selected:', fileId, 'for torrent:', torrentId);

    await rdClient.selectFiles(config, torrentId, fileId);
    console.log('File selected successfully');

    await new Promise(resolve => setTimeout(resolve, 2000));

    const updatedInfo = await rdClient.getTorrentInfo(config, torrentId);

    if (!updatedInfo.links || updatedInfo.links.length === 0) {
        throw new Error('No links available after file selection');
    }

    const originalLink = updatedInfo.links[0];
    const unrestrictedUrl = await rdClient.unrestrictLink(config, originalLink);

    const selectedFile = updatedInfo.files.find(f => f.id.toString() === fileId.toString() && f.selected === 1);
    const filename = selectedFile ? (selectedFile.path || selectedFile.name) : updatedInfo.filename;
    const size = selectedFile ? (selectedFile.bytes || selectedFile.size) : updatedInfo.bytes;

    const linkId = extractLinkId(originalLink);
    if (linkId) {
        await storage.addStrmEntry(c.env, linkId, originalLink, unrestrictedUrl, filename, true);
    }

    await rdClient.deleteTorrent(config, torrentId);

    return c.html(getAddPage(null, 'Media ready to cast', {
        hash: updatedInfo.hash,
        filename: filename,
        bytes: size,
    }));
}


// --- Routes ---

app.get('/', async (c) => {
    const config = c.get('config');

    // Get latest 3 downloads to display
    let downloads = [];
    try {
        const allDownloads = await rdClient.getDownloadsList(config, 3);
        if (allDownloads && allDownloads.length > 0) {
            downloads = allDownloads.sort((a, b) => {
                const dateA = new Date(a.generated || 0);
                const dateB = new Date(b.generated || 0);
                return dateB - dateA;
            });
        }
    } catch (err) {
        console.error('Error fetching downloads for home page:', err.message);
    }

    return c.html(getHomePage(null, null, downloads));
});

app.get('/add', (c) => {
    return c.html(getAddPage());
});

app.post('/add', async (c) => {
    const body = await c.req.parseBody();
    const magnet = body.magnet;
    if (!magnet) {
        return c.html(getAddPage('Please provide a magnet link or infohash'));
    }
    try {
        return await processMagnet(c, magnet);
    } catch (err) {
        console.error('Error adding magnet:', err.message);
        return c.html(getAddPage(`Failed to cast: ${err.message}`));
    }
});

app.post('/add/select', async (c) => {
    const body = await c.req.parseBody();
    const { torrentId, fileId } = body;
    if (!torrentId || !fileId) {
        return c.html(getAddPage('Invalid file selection'));
    }
    try {
        return await processSelectedFile(c, torrentId, fileId);
    } catch (err) {
        console.error('Error selecting file:', err.message);
        return c.html(getAddPage(`Failed to cast: ${err.message}`));
    }
});

app.get('/health', (c) => {
    // In worker, process.uptime is not available.
    const uptime = typeof process !== 'undefined' ? process.uptime() : 0;
    return c.json({
        status: 'ok',
        uptime: uptime,
        timestamp: new Date().toISOString(),
    });
});

// --- WebDAV ---

async function getWebDAVFiles(c) {
    const config = c.get('config');
    try {
        // Fetch the 3 most recent downloads from Real-Debrid
        const downloads = await rdClient.getDownloadsList(config, 3);
        const sortedDownloads = (downloads || []).sort((a, b) => new Date(b.generated) - new Date(a.generated));

        // Add/update them in cache with manuallyAdded: false
        const recent3LinkIds = new Set();
        for (const download of sortedDownloads) {
            const linkId = extractLinkId(download.link);
            if (linkId) {
                await storage.addStrmEntry(c.env, linkId, download.link, download.download, download.filename, false);
                recent3LinkIds.add(linkId);
            }
        }

        // Get all cached entries
        const allEntries = await storage.getAllStrmEntries(c.env);

        // Filter: show if (in recent 3) OR (manuallyAdded AND < 7 days old)
        const now = Date.now();
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

        const files = [];
        for (const entry of allEntries) {
            if (!entry) continue;

            const linkId = extractLinkId(entry.originalLink);
            if (!linkId) continue;

            const age = now - new Date(entry.generatedAt).getTime();
            const showInListing = recent3LinkIds.has(linkId) || (entry.manuallyAdded && age < sevenDaysMs);

            if (showInListing) {
                const urlObj = new URL(config.publicUrl);
                urlObj.username = config.webdavUsername;
                urlObj.password = config.webdavPassword;
                urlObj.pathname = `/strm/${linkId}`;
                const strmUrl = urlObj.toString();
                const filename = `${entry.filename}.strm`;

                files.push({
                    name: filename,
                    content: strmUrl,
                    size: strmUrl.length,
                    modified: entry.generatedAt,
                    contentType: 'text/plain; charset=utf-8',
                });
            }
        }

        // Sort by modified date descending (most recent first)
        return files.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    } catch (error) {
        console.error('Error getting WebDAV files:', error.message);
        return [];
    }
}

app.on(['PROPFIND'], '/webdav/', async (c) => {
    const files = await getWebDAVFiles(c);
    const depth = c.req.header('Depth') || '0';
    const requestUrl = new URL(c.req.url);
    const requestPath = requestUrl.pathname;

    const responses = files.map(file => `
      <D:response>
        <D:href>${requestPath}${file.name}</D:href>
        <D:propstat>
          <D:prop>
            <D:resourcetype/>
            <D:getcontentlength>${file.size}</D:getcontentlength>
            <D:getlastmodified>${new Date(file.modified).toUTCString()}</D:getlastmodified>
            <D:getcontenttype>${file.contentType}</D:getcontenttype>
          </D:prop>
          <D:status>HTTP/1.1 200 OK</D:status>
        </D:propstat>
      </D:response>`).join('');

    const collectionResponse = `
      <D:response>
        <D:href>${requestPath}</D:href>
        <D:propstat>
          <D:prop>
            <D:resourcetype><D:collection/></D:resourcetype>
            <D:getlastmodified>${new Date().toUTCString()}</D:getlastmodified>
          </D:prop>
          <D:status>HTTP/1.1 200 OK</D:status>
        </D:propstat>
      </D:response>`;

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
${depth !== '0' ? responses : ''}${collectionResponse}
</D:multistatus>`;

    return new Response(xml, { status: 207, headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
});

app.get('/webdav/', async (c) => {
    const files = await getWebDAVFiles(c);

    // Filter out specific metadata files from HTML listing
    const excludedHtmlFiles = ['favorite.png', 'favorite-atv.png', 'folder.png'];
    const visibleFiles = files.filter(file => !excludedHtmlFiles.includes(file.name));

    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>WebDAV - Cast Magnet Link</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
    <link rel="stylesheet" href="/style.css?2025-12-11">
</head>
<body>
    <main class="container">
        <article>
            <header>
                <h2>Cast Magnet Link: WebDAV</h2>
                <p>Available files for streaming</p>
            </header>

            <div class="status-info">
                <h3>WebDAV Files:</h3>
                <ul>
                    ${visibleFiles.map(file => `
                    <li><a href="/webdav/${file.name}">${file.name}</a> <small><code>${formatBytes(file.size)}</code></small></li>
                    `).join('')}
                </ul>
            </div>

            <footer style="margin-top: 2rem; text-align: center;">
                <small>
                    <a href="/">Home</a> &middot;
                    <a href="/add">Add Magnet Link</a> &middot;
                    <a href="/webdav/">WebDAV Files</a>
                </small>
            </footer>

        </article>
    </main>
</body>
</html>`;
    return c.html(html);
});

app.get('/webdav/:filename', async (c) => {
    const { filename } = c.req.param();
    const files = await getWebDAVFiles(c);
    const file = files.find(f => f.name === filename);

    if (!file) {
        return c.text('File not found', 404);
    }
    
    // This is a simplified GET. The original served static files too.
    // The new implementation uses static asset handling in the entry points.
    if (filename.endsWith('.strm')) {
        return c.text(file.content);
    }

    return c.text('File type not supported for direct GET', 400);
});

app.get('/strm/:linkId', async (c) => {
    const { linkId } = c.req.param();
    const config = c.get('config');
    const cacheEntry = await storage.getStrmEntry(c.env, linkId);

    if (!cacheEntry) {
        return c.text('Download link not found in cache', 404);
    }

    const generatedAt = new Date(cacheEntry.generatedAt).getTime();
    const age = Date.now() - generatedAt;
    const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

    if (age > FORTY_EIGHT_HOURS_MS) {
        console.log(`Refreshing old unrestricted URL for: ${cacheEntry.filename}`);
        try {
            const newUnrestrictedUrl = await rdClient.unrestrictLink(config, cacheEntry.originalLink);
            await storage.updateStrmUrl(c.env, linkId, newUnrestrictedUrl);
            return c.redirect(newUnrestrictedUrl, 302);
        } catch (error) {
            console.error('Error refreshing unrestricted URL:', error.message);
            // Continue with old URL as fallback
            return c.redirect(cacheEntry.unrestrictedUrl, 302);
        }
    }

    return c.redirect(cacheEntry.unrestrictedUrl, 302);
});


export default app;

// Add static file serving for Cloudflare Workers
import { serveStatic } from 'hono/cloudflare-workers';
app.use('/Infuse/*', serveStatic({ root: './' }));
app.use('/metadata/*', serveStatic({ root: './' }));
app.use('/style.css', serveStatic({ path: './style.css' }));
