
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { getConfig } from './config.worker.js';
import { getEnv } from './env.js';
import storage from './storage.js';
import * as rdClient from './rdClient.js';
import { getPublicIP } from './ipUtils.js';

const app = new Hono();

// --- Middleware ---

// Middleware to load config and validate
app.use('*', async (c, next) => {
    // Universal environment accessor - works in both Node.js and Cloudflare Workers
    const env = getEnv(c);
    const config = getConfig(env);

    if (!config.rdAccessToken || !config.webdavPassword) {
        return c.text('Server configuration is invalid. Missing required environment variables.', 500);
    }
    c.set('config', config);
    await next();
});

// Basic Auth Middleware - Protect ALL routes except /health and static files
app.use('*', async (c, next) => {
    // Skip auth for health check and static files
    const publicPaths = ['/health', '/style.css', '/Infuse/', '/metadata/'];
    if (publicPaths.some(path => c.req.path === path || c.req.path.startsWith(path))) {
        return next();
    }

    // Apply Basic Auth
    const config = c.get('config');
    return basicAuth({
        verifyUser: (username, password, c) => {
            return username === config.webdavUsername && password === config.webdavPassword;
        },
    })(c, next);
});


// --- HTML Templates ---

function getHomePage(error = null, success = null, downloads = []) {
  return `<!DOCTYPE html>
<html data-theme="light">
<head>
    <meta charset="UTF-8">
    <title>Cast Magnet Link</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
    <link rel="stylesheet" href="/style.css">
    <script>
        // Support light and dark mode based on system preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    </script>
</head>
<body>
    <main class="container">
        <article>
            <header>
                ${error ? `<span class="status-badge error">ERROR</span>` : ''}
                ${success ? `<span class="status-badge success">SUCCESS</span>` : ''}
                <h2>${error ? 'Error' : success ? success : 'Cast Magnet Link'}</h2>
                ${!error && !success ? '<p>Enter a magnet link or infohash to add to WebDAV</p>' : ''}
            </header>

            ${error ? `
            <code style="display: block; white-space: pre-wrap; padding: 0.75rem; background: var(--pico-code-background-color); border-radius: var(--pico-border-radius); margin-bottom: 1rem;">${error}</code>
            ` : ''}

            ${downloads && downloads.length > 0 ? `
            <div class="status-info">
                <h3>Currently Casted Media:</h3>
                <ul>
                    ${downloads.map(d => `
                    <li><a href="${d.downloadUrl}" target="_blank">${d.filename}</a> <small><code>${formatBytes(d.filesize || 0)}</code></small></li>
                    `).join('')}
                </ul>
            </div>
            ` : ''}

            <form method="POST" action="/add">
                <input type="text" name="magnet" placeholder="magnet:?xt=urn:btih:... or infohash" required autofocus>
                <button type="submit">Add Torrent</button>
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
<html data-theme="light">
<head>
    <meta charset="UTF-8">
    <title>Add Magnet - Cast Magnet Link</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
    <link rel="stylesheet" href="/style.css">
    <script>
        // Support light and dark mode based on system preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    </script>
</head>
<body>
    <main class="container">
        <article>
            <header>
                ${error ? `<span class="status-badge error">ERROR</span>` : ''}
                ${success ? `<span class="status-badge success">SUCCESS</span>` : ''}
                <h2>${error ? 'Error' : success || 'Cast Magnet Link: Add'}</h2>
                ${!error && !success ? '<p>Enter a magnet link or infohash</p>' : ''}
            </header>

            ${error ? `
            <code style="display: block; white-space: pre-wrap; padding: 0.75rem; background: var(--pico-code-background-color); border-radius: var(--pico-border-radius); margin-bottom: 1rem;">${error}</code>
            ` : ''}

            ${torrentInfo ? `
            <div>
                <p>Infohash: <code>${torrentInfo.hash}</code></p>
                <p>File: ${torrentInfo.filename || torrentInfo.hash.substring(0, 8) + '...'} <small><code>${formatBytes(torrentInfo.bytes || 0)}</code></small>
            </div>
            ` : ''}

            <form method="POST" action="/add">
                <input type="text" name="magnet" placeholder="magnet:?xt=urn:btih:... or infohash" required autofocus>
                <button type="submit">Add Torrent</button>
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
<html data-theme="light">
<head>
    <meta charset="UTF-8">
    <title>Select File - Cast Magnet Link</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
    <link rel="stylesheet" href="/style.css">
    <script>
        // Support light and dark mode based on system preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    </script>
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

/**
 * Process a magnet link or infohash
 *
 * @param {Object} c - Hono context
 * @param {string} magnetOrHash - Magnet link or infohash
 * @param {string|null} [userIP=null] - Optional user IP for RD geolocation
 * @returns {Promise<Response>} Hono response
 */
async function processMagnet(c, magnetOrHash, userIP = null) {
    const config = c.get('config');
    console.log('Adding magnet/hash:', magnetOrHash.substring(0, 50) + '...');
    if (userIP) {
        console.log('User IP for RD routing:', userIP);
    }

    const addResult = await rdClient.addTorrent(config, magnetOrHash);
    const torrentId = addResult.id;
    console.log('Torrent added with ID:', torrentId);

    await new Promise(resolve => setTimeout(resolve, 2000));

    const torrentInfo = await rdClient.getTorrentInfo(config, torrentId);
    console.log('Torrent status:', torrentInfo.status);

    if (torrentInfo.status === 'waiting_files_selection') {
        const fileToSelect = getAutoSelectFile(torrentInfo.files);
        if (fileToSelect) {
            return processSelectedFile(c, torrentId, fileToSelect.id.toString(), userIP);
        }
        else {
            return c.html(getSelectFilePage(torrentInfo.files, torrentId, torrentInfo.filename));
        }
    }

    if (!torrentInfo.links || torrentInfo.links.length === 0) {
        throw new Error('No links available for torrent');
    }

    const originalLink = torrentInfo.links[0];
    const unrestrictedUrl = await rdClient.unrestrictLink(config, originalLink, userIP);

    // Get the selected file's name from the files array
    const selectedFile = torrentInfo.files?.find(f => f.selected === 1);
    const filename = selectedFile ? (selectedFile.path || selectedFile.name) : torrentInfo.filename;
    const size = selectedFile ? (selectedFile.bytes || selectedFile.size) : torrentInfo.bytes;

    const linkId = extractLinkId(originalLink);
    if (linkId) {
        await storage.addStrmEntry(c.env, linkId, originalLink, unrestrictedUrl, filename, true, size);
    }

    await rdClient.deleteTorrent(config, torrentInfo.id);

    return c.html(getAddPage(null, 'Media ready to cast', {
        hash: torrentInfo.hash,
        filename: filename,
        bytes: size,
    }));
}

/**
 * Process a selected file from a multi-file torrent
 *
 * @param {Object} c - Hono context
 * @param {string} torrentId - Real-Debrid torrent ID
 * @param {string} fileId - Selected file ID
 * @param {string|null} [userIP=null] - Optional user IP for RD geolocation
 * @returns {Promise<Response>} Hono response
 */
async function processSelectedFile(c, torrentId, fileId, userIP = null) {
    const config = c.get('config');
    console.log('File selected:', fileId, 'for torrent:', torrentId);
    if (userIP) {
        console.log('User IP for RD routing:', userIP);
    }

    await rdClient.selectFiles(config, torrentId, fileId);
    console.log('File selected successfully');

    await new Promise(resolve => setTimeout(resolve, 2000));

    const updatedInfo = await rdClient.getTorrentInfo(config, torrentId);

    if (!updatedInfo.links || updatedInfo.links.length === 0) {
        throw new Error('No links available after file selection');
    }

    const originalLink = updatedInfo.links[0];
    const unrestrictedUrl = await rdClient.unrestrictLink(config, originalLink, userIP);

    const selectedFile = updatedInfo.files.find(f => f.id.toString() === fileId.toString() && f.selected === 1);
    const filename = selectedFile ? (selectedFile.path || selectedFile.name) : updatedInfo.filename;
    const size = selectedFile ? (selectedFile.bytes || selectedFile.size) : updatedInfo.bytes;

    const linkId = extractLinkId(originalLink);
    if (linkId) {
        await storage.addStrmEntry(c.env, linkId, originalLink, unrestrictedUrl, filename, true, size);
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
    // Check for 'add' query parameter to auto-add magnet/infohash
    const magnetOrHash = c.req.query('add');
    if (magnetOrHash) {
        try {
            // Extract user IP for RD geolocation
            const userIP = getPublicIP(c);
            return await processMagnet(c, magnetOrHash, userIP);
        } catch (err) {
            console.error('Error auto-adding magnet:', err.message);
            const files = await getWebDAVFiles(c);
            const downloadsForHomePage = files.map(file => ({
                filename: file.originalFilename,
                filesize: file.filesize,
                downloadUrl: file.downloadUrl,
            }));
            return c.html(getHomePage(`Failed to cast: ${err.message}`, null, downloadsForHomePage));
        }
    }

    // Get the unified list of files
    const files = await getWebDAVFiles(c);

    // Adapt the file list for the home page template
    const downloadsForHomePage = files.map(file => ({
        filename: file.originalFilename,
        filesize: file.filesize,
        downloadUrl: file.downloadUrl, // Include direct download link
    }));

    return c.html(getHomePage(null, null, downloadsForHomePage));
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
        // Extract user IP for RD geolocation
        const userIP = getPublicIP(c);
        return await processMagnet(c, magnet, userIP);
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
        // Extract user IP for RD geolocation
        const userIP = getPublicIP(c);
        return await processSelectedFile(c, torrentId, fileId, userIP);
    } catch (err) {
        console.error('Error selecting file:', err.message);
        return c.html(getAddPage(`Failed to cast: ${err.message}`));
    }
});

// Add magnet link or infohash via URL path parameter
app.get('/add/:magnetOrHash', async (c) => {
    const magnetOrHash = c.req.param('magnetOrHash');
    if (!magnetOrHash) {
        return c.html(getAddPage('Please provide a magnet link or infohash'));
    }
    try {
        // Extract user IP for RD geolocation
        const userIP = getPublicIP(c);
        return await processMagnet(c, decodeURIComponent(magnetOrHash), userIP);
    } catch (err) {
        console.error('Error adding magnet via URL path:', err.message);
        return c.html(getAddPage(`Failed to cast: ${err.message}`));
    }
});

// Serve stylesheet
app.get('/style.css', (c) => {
    const css = `article {
    margin-top: 2rem;
}

/* Status badge styles */
.status-badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    border-radius: 1rem;
    color: white;
    font-weight: 600;
    margin-bottom: 1rem;
}

.status-badge.success {
    background: #43a047;
    background-color: #43a047;
}

.status-badge.warning {
    background: #fb8c00;
    background-color: #fb8c00;
}

.status-badge.error {
    background: #e53935;
    background-color: #e53935;
}

code {
    font-weight: normal;
}

.status-info {
    padding: 1rem;
    border-radius: var(--pico-border-radius);
    background: var(--pico-background-color);
    margin-bottom: 1rem;
}

.status-info code {
    font-size: 0.875rem;
}

.casted-list {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0;
}

.casted-list li {
    margin-bottom: 0.5rem;
}

ul {
    list-style-type: disc;
    padding-left: 1.5rem;
}

ul li {
    padding: 0.25rem 0;
}

ul li a {
    font-weight: 500;
}

ul li small {
    margin-left: 0.5rem;
    color: var(--pico-muted-color);
}`;
    return c.text(css, 200, { 'Content-Type': 'text/css', 'Cache-Control': 'public, max-age=3600' });
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

// Redirect /webdav to /webdav/
app.all('/webdav', async (c) => {
    return c.redirect('/webdav/', 301);
});

async function getWebDAVFiles(c) {
    const config = c.get('config');
    try {
        // Fetch 20 downloads to account for potential duplicates
        const downloads = await rdClient.getDownloadsList(config, 20);
        const sortedDownloads = (downloads || []).sort((a, b) => new Date(b.generated) - new Date(a.generated));

        // Deduplicate by ID, keeping only the most recent occurrence
        const seenIds = new Set();
        const uniqueDownloads = [];
        for (const download of sortedDownloads) {
            if (!seenIds.has(download.id)) {
                seenIds.add(download.id);
                uniqueDownloads.push(download);
                // Stop after collecting 5 unique items
                if (uniqueDownloads.length >= 5) break;
            }
        }

        const files = [];
        for (const download of uniqueDownloads) {
            const linkId = extractLinkId(download.link);
            if (!linkId) continue;

            // Cache entry for later access via /strm/:linkId
            await storage.addStrmEntry(c.env, linkId, download.link, download.download, download.filename, false, download.filesize);

            // Build .strm file URL - auto-detect hostname from request if PUBLIC_URL not explicitly set
            let baseUrl = config.publicUrl;
            if (!baseUrl || baseUrl === 'http://localhost:3000' || baseUrl.includes('localhost')) {
                // Auto-detect from request
                const requestUrl = new URL(c.req.url);
                baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
            }

            const urlObj = new URL(baseUrl);
            urlObj.username = config.webdavUsername;
            urlObj.password = config.webdavPassword;
            urlObj.pathname = `/strm/${linkId}`;
            const strmUrl = urlObj.toString();
            const filename = `${download.filename}.strm`;

            files.push({
                name: filename,
                content: strmUrl,
                size: strmUrl.length,
                modified: download.generated,
                contentType: 'text/plain; charset=utf-8',
                originalFilename: download.filename,
                filesize: download.filesize || 0,
                downloadUrl: download.download, // Real Debrid direct download link
            });
        }

        return files;
    } catch (error) {
        console.error('Error in getWebDAVFiles:', error.message, error.stack);
        return [];
    }
}

app.on(['PROPFIND'], '/webdav/', async (c) => {
    const files = await getWebDAVFiles(c);
    const depth = c.req.header('Depth') || '0';
    const requestUrl = new URL(c.req.url);
    const requestPath = requestUrl.pathname;

    // Add favorite-atv.png for Infuse (only in PROPFIND, not in HTML listing)
    const staticFile = {
        name: 'favorite-atv.png',
        size: 20824,
        modified: '2024-10-23T00:00:00.000Z', // Static date to avoid cache invalidation
        contentType: 'image/png'
    };

    const allFiles = [...files, staticFile];

    const responses = allFiles.map(file => `
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
    <link rel="stylesheet" href="/style.css">
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
            // Extract user IP for RD geolocation
            const userIP = getPublicIP(c);
            const newUnrestrictedUrl = await rdClient.unrestrictLink(config, cacheEntry.originalLink, userIP);
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
