
import { serveStatic } from 'hono/cloudflare-workers';
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { getConfig } from './config.worker.js';
import { getEnv } from './env.js';
import * as rdClient from './rdClient.js';
import { getPublicIP } from './ipUtils.js';
import { serveAsset, getAssetsInDirectory } from './dynamic-assets.js';

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

// Basic Auth Middleware - Protect ALL routes except /health and public assets
app.use('*', async (c, next) => {
    // Skip auth for health check and public static assets
    const publicPaths = ['/health', '/style.css', '/public/'];
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


import { layout, statusHeader, pageHeader, footer, formatBytes } from './html.js';

/**
 * Fetch casted links from Debrid Media Manager API
 * Returns items from last 7 days, sorted by most recent
 */
async function getCastedLinks(config) {
    try {
        const response = await fetch(`https://debridmediamanager.com/api/stremio/links?token=${config.rdAccessToken}`);
        if (!response.ok) {
            console.error('Failed to fetch casted links:', response.statusText);
            return [];
        }

        const data = await response.json();
        if (!Array.isArray(data)) {
            console.error('Invalid response from DMM API');
            return [];
        }

        // Filter for items from last 7 days
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const filteredLinks = data.filter(link => {
            if (!link.updatedAt) return false;
            const updatedTime = new Date(link.updatedAt).getTime();
            return updatedTime >= sevenDaysAgo;
        });

        // Sort by updatedAt (most recent first)
        filteredLinks.sort((a, b) => {
            const timeA = new Date(a.updatedAt).getTime();
            const timeB = new Date(b.updatedAt).getTime();
            return timeB - timeA;
        });

        // Format for display
        return filteredLinks.map(link => {
            // Extract filename from URL path if not provided
            let filename = link.filename;
            if (!filename || filename === 'Unknown') {
                try {
                    const urlPath = new URL(link.url).pathname;
                    filename = decodeURIComponent(urlPath.split('/').pop()) || 'Unknown';
                } catch (e) {
                    filename = 'Unknown';
                }
            }

            return {
                url: link.url || '#',
                filename: filename,
                sizeGB: link.size ? Math.round(link.size / 1024 * 100) / 100 : 0, // Convert MB to GB
                updatedAt: link.updatedAt,
            };
        });
    } catch (error) {
        console.error('Error fetching casted links:', error.message);
        return [];
    }
}

/**
 * Fetch Real-Debrid download links for home page display
 * Returns ONLY RD downloads (not DMM links), max 10 items
 */
async function getRealDebridDownloads(config) {
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
                // Stop after collecting 10 unique items
                if (uniqueDownloads.length >= 10) break;
            }
        }

        // Format for home page display
        return uniqueDownloads.map(download => ({
            filename: download.filename,
            filesize: download.filesize || 0,
            downloadUrl: download.download,
        }));
    } catch (error) {
        console.error('Error fetching RD downloads:', error.message);
        return [];
    }
}


// --- Core Logic Helpers ---

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
			const content = `
				${pageHeader('Select File to Cast', torrentInfo.filename || 'Multiple files found')}
				<form method="POST" action="/add/select">
					<input type="hidden" name="torrentId" value="${torrentId}">
					${torrentInfo.files.map((file, idx) => `
					<label>
						<input type="radio" name="fileId" value="${file.id}" ${idx === 0 ? 'checked' : ''} required>
						${file.name || file.path} <code>${formatBytes(file.size || file.bytes || 0)}</code>
					</label>
					`).join('')}
					<button type="submit" style="margin-top: 1rem;">Cast Selected File</button>
				</form>
			`;
            return c.html(layout('Select File', content));
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

    await rdClient.deleteTorrent(config, torrentInfo.id);
	const content = `
		${statusHeader(null, 'Media ready to cast')}
		<div>
			<p>Infohash: <code>${torrentInfo.hash}</code></p>
			<p>File: ${filename || torrentInfo.hash.substring(0, 8) + '...'} <small><code>${formatBytes(size || 0)}</code></small>
		</div>
		<form method="POST" action="/add">
			<input type="text" name="magnet" placeholder="magnet:?xt=urn:btih:... or infohash" required autofocus>
			<button type="submit">Add Magnet Link</button>
		</form>
		${footer()}
	`;
	return c.html(layout('Add Magnet', content));
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

    await rdClient.deleteTorrent(config, torrentId);

	const content = `
		${statusHeader(null, 'Media ready to cast')}
		<div>
			<p>Infohash: <code>${updatedInfo.hash}</code></p>
			<p>File: ${filename || updatedInfo.hash.substring(0, 8) + '...'} <small><code>${formatBytes(size || 0)}</code></small>
		</div>
		<form method="POST" action="/add">
			<input type="text" name="magnet" placeholder="magnet:?xt=urn:btih:... or infohash" required autofocus>
			<button type="submit">Add Magnet Link</button>
		</form>
		${footer()}
	`;
	return c.html(layout('Add Magnet', content));
}


// --- Routes ---

app.get('/', async (c) => {
    const config = c.get('config');
    const hostname = new URL(c.req.url).origin;

    // Check for 'add' query parameter to auto-add magnet/infohash
    const magnetOrHash = c.req.query('add');
    if (magnetOrHash) {
        try {
            // Extract user IP for RD geolocation
            const userIP = getPublicIP(c);
            return await processMagnet(c, magnetOrHash, userIP);
        } catch (err) {
            console.error('Error auto-adding magnet:', err.message);
			const content = `
				${statusHeader(`Failed to cast: ${err.message}`)}
				<form method="POST" action="/add">
					<input type="text" name="magnet" placeholder="magnet:?xt=urn:btih:... or infohash" required autofocus>
					<button type="submit">Add Magnet Link</button>
				</form>
				${footer()}
			`;
			return c.html(layout('Error', content));
        }
    }

    // Fetch Real-Debrid download links only for "Most Recent Download Links"
    const rdDownloads = await getRealDebridDownloads(config);

    // Get casted links from DMM API for "Most Recent Casted Links"
    const castedLinks = await getCastedLinks(config);

	const content = `
		${statusHeader()}
		${rdDownloads && rdDownloads.length > 0 ? `
		<div class="status-info">
			<h3>Most Recent Download Links</h3>
			<p><small>source: <a href="https://real-debrid.com/downloads" target="_blank">real-debrid.com/downloads</a></small><br />
			   <small>WebDAV: <code>${hostname}/webdav/downloads/</code></small>
            </p>
			<ul>
				${rdDownloads.map(d => `
				<li><a href="${d.downloadUrl}" target="_blank">${d.filename}</a> <small><code>${formatBytes(d.filesize || 0)}</code></small></li>
				`).join('')}
			</ul>
		</div>
        <div class="button-wrapper">
            <form method="POST" action="/add">
                <input type="text" name="magnet" placeholder="magnet:?xt=urn:btih:... or infohash" required autofocus>
                <button type="submit">Add Magnet Link</button>
            </form>
        </div>
        <hr>
		` : ''}
		${castedLinks && castedLinks.length > 0 ? `
		<div class="status-info">
			<h3>Most Recent Casted Links</h3>
			<p><small>source: <a href="https://debridmediamanager.com/stremio/manage" target="_blank">debridmediamanager.com/stremio/manage</a></small><br />
			   <small>WebDAV: <code>${hostname}/webdav/dmmcast/</code></small>
            </p>
			<ul>
				${castedLinks.map(link => `
				<li><a href="${link.url}" target="_blank">${link.filename}</a> <small><code>${link.sizeGB} GB</code></small></li>
				`).join('')}
			</ul>
		</div>
        <div class="button-wrapper">
            <a href="https://debridmediamanager.com/stremio/manage" target="_blank" role="button">Manage Casted Links</a>
        </div>
		` : ''}
		${footer()}
	`;
    return c.html(layout('Cast Magnet Link', content));
});

app.get('/add', (c) => {
	const content = `
		${statusHeader(null, null, 'Cast Magnet Link: Add', 'Enter a magnet link or infohash')}
		<form method="POST" action="/add">
			<input type="text" name="magnet" placeholder="magnet:?xt=urn:btih:... or infohash" required autofocus>
			<button type="submit">Add Magnet Link</button>
		</form>
        <small>
            <p style="margin-top: 2rem;">Redirecting a magnet link to this page will automatically create a new download link:</p>
            <p>magnet link: <code>magnet:\?xt=urn:btih:{infohash}</code>
            <br />automatically add magnet link: <code>https://cast-magnet-link.dev/add/{magnet link}</code>
            <br />automatically add infohash: <code>https://cast-magnet-link.dev/add/{info hash}</code></p>

            <p style="margin-top: 2rem;">A browser extension like <a href="https://apple.co/4e0lkPG">StopTheMadness Pro</a> that supports <a href="https://underpassapp.com/StopTheMadness/Pro/Docs/Redirects.html">URL redirect rules</a> can redirect magnet links to this page:</p>
            <p>matching pattern: <code>/^magnet:\?xt=urn:btih:([A-Fa-f0-9]+)(?:&amp;.*)?$/</code>
            <br />replacement pattern: <code>https://cast.user.workers.dev/add/$1</code></p>
        </small>
		${footer()}
	`;
    return c.html(layout('Add Magnet', content));
});

app.post('/add', async (c) => {
    const body = await c.req.parseBody();
    const magnet = body.magnet;
    if (!magnet) {
		const content = `
			${statusHeader('Please provide a magnet link or infohash')}
			<form method="POST" action="/add">
				<input type="text" name="magnet" placeholder="magnet:?xt=urn:btih:... or infohash" required autofocus>
				<button type="submit">Add Magnet Link</button>
			</form>
			${footer()}
		`;
		return c.html(layout('Error', content));
    }
    try {
        // Extract user IP for RD geolocation
        const userIP = getPublicIP(c);
        return await processMagnet(c, magnet, userIP);
    } catch (err) {
        console.error('Error adding magnet:', err.message);
		const content = `
			${statusHeader(`Failed to cast: ${err.message}`)}
			<form method="POST" action="/add">
				<input type="text" name="magnet" placeholder="magnet:?xt=urn:btih:... or infohash" required autofocus>
				<button type="submit">Add Magnet Link</button>
			</form>
			${footer()}
		`;
		return c.html(layout('Error', content));
    }
});

app.post('/add/select', async (c) => {
    const body = await c.req.parseBody();
    const { torrentId, fileId } = body;
    if (!torrentId || !fileId) {
		const content = `
			${statusHeader('Invalid file selection')}
			<form method="POST" action="/add">
				<input type="text" name="magnet" placeholder="magnet:?xt=urn:btih:... or infohash" required autofocus>
				<button type="submit">Add Magnet Link</button>
			</form>
			${footer()}
		`;
		return c.html(layout('Error', content));
    }
    try {
        // Extract user IP for RD geolocation
        const userIP = getPublicIP(c);
        return await processSelectedFile(c, torrentId, fileId, userIP);
    } catch (err) {
        console.error('Error selecting file:', err.message);
		const content = `
			${statusHeader(`Failed to cast: ${err.message}`)}
			<form method="POST" action="/add">
				<input type="text" name="magnet" placeholder="magnet:?xt=urn:btih:... or infohash" required autofocus>
				<button type="submit">Add Magnet Link</button>
			</form>
			${footer()}
		`;
		return c.html(layout('Error', content));
    }
});

// Add magnet link or infohash via URL path parameter
app.get('/add/:magnetOrHash', async (c) => {
    const magnetOrHash = c.req.param('magnetOrHash');
    if (!magnetOrHash) {
		const content = `
			${statusHeader('Please provide a magnet link or infohash')}
			<form method="POST" action="/add">
				<input type="text" name="magnet" placeholder="magnet:?xt=urn:btih:... or infohash" required autofocus>
				<button type="submit">Add Magnet Link</button>
			</form>
			${footer()}
		`;
		return c.html(layout('Error', content));
    }
    try {
        // Extract user IP for RD geolocation
        const userIP = getPublicIP(c);
        return await processMagnet(c, decodeURIComponent(magnetOrHash), userIP);
    } catch (err) {
        console.error('Error adding magnet via URL path:', err.message);
		const content = `
			${statusHeader(`Failed to cast: ${err.message}`)}
			<form method="POST" action="/add">
				<input type="text" name="magnet" placeholder="magnet:?xt=urn:btih:... or infohash" required autofocus>
				<button type="submit">Add Magnet Link</button>
			</form>
			${footer()}
		`;
		return c.html(layout('Error', content));
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

// Redirect /webdav to /webdav/
app.all('/webdav', async (c) => {
    return c.redirect('/webdav/', 301);
});

/**
 * Get Real-Debrid download links as WebDAV files
 * Returns .strm files for RD downloads only
 */
async function getRealDebridWebDAVFiles(c) {
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
                // Limit to 10 items for WebDAV
                if (uniqueDownloads.length >= 10) break;
            }
        }

        // Deduplicate by filename, keeping most recent
        const filesMap = new Map();
        for (const download of uniqueDownloads) {
            const strmUrl = download.download;
            const filename = `${download.filename}.strm`;
            const modified = new Date(download.generated).getTime();

            const fileObj = {
                name: filename,
                content: strmUrl,
                size: strmUrl.length,
                modified: download.generated,
                modifiedTimestamp: modified,
                contentType: 'text/plain; charset=utf-8',
                originalFilename: download.filename,
                filesize: download.filesize || 0,
                downloadUrl: download.download,
            };

            const existing = filesMap.get(filename);
            if (existing) {
                if (modified > existing.modifiedTimestamp) {
                    filesMap.set(filename, fileObj);
                }
            } else {
                filesMap.set(filename, fileObj);
            }
        }

        // Convert map to array and remove temporary timestamp field
        const files = Array.from(filesMap.values()).map(file => {
            const { modifiedTimestamp, ...cleanFile } = file;
            return cleanFile;
        });

        return files;
    } catch (error) {
        console.error('Error in getRealDebridWebDAVFiles:', error.message, error.stack);
        return [];
    }
}

/**
 * Get DMM casted links as WebDAV files
 * Returns .strm files for DMM Cast only
 */
async function getDMMCastWebDAVFiles(c) {
    const config = c.get('config');
    try {
        const castedLinks = await getCastedLinks(config);

        // Deduplicate by filename, keeping most recent
        const filesMap = new Map();
        for (const link of castedLinks) {
            const strmUrl = link.url;
            const filename = `${link.filename}.strm`;
            const modified = new Date(link.updatedAt).getTime();

            const fileObj = {
                name: filename,
                content: strmUrl,
                size: strmUrl.length,
                modified: link.updatedAt,
                modifiedTimestamp: modified,
                contentType: 'text/plain; charset=utf-8',
                originalFilename: link.filename,
                filesize: link.sizeGB * 1024 * 1024 * 1024,
                downloadUrl: link.url,
            };

            const existing = filesMap.get(filename);
            if (existing) {
                if (modified > existing.modifiedTimestamp) {
                    filesMap.set(filename, fileObj);
                }
            } else {
                filesMap.set(filename, fileObj);
            }
        }

        // Convert map to array and remove temporary timestamp field
        const files = Array.from(filesMap.values()).map(file => {
            const { modifiedTimestamp, ...cleanFile } = file;
            return cleanFile;
        });

        return files;
    } catch (error) {
        console.error('Error in getDMMCastWebDAVFiles:', error.message, error.stack);
        return [];
    }
}

// PROPFIND /webdav/ - WebDAV root showing directories
app.on(['PROPFIND'], '/webdav/', async (c) => {
    const depth = c.req.header('Depth') || '0';
    const requestUrl = new URL(c.req.url);
    const requestPath = requestUrl.pathname;

    const directories = [
        { name: 'downloads/', modified: new Date().toUTCString() },
        { name: 'dmmcast/', modified: new Date().toUTCString() }
    ];

    const responses = directories.map(dir => `
      <D:response>
        <D:href>${requestPath}${dir.name}</D:href>
        <D:propstat>
          <D:prop>
            <D:resourcetype><D:collection/></D:resourcetype>
            <D:getlastmodified>${dir.modified}</D:getlastmodified>
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

// PROPFIND /webdav/downloads/ - WebDAV endpoint for Real-Debrid download links
app.on(['PROPFIND'], '/webdav/downloads/', async (c) => {
    const files = await getRealDebridWebDAVFiles(c);
    const depth = c.req.header('Depth') || '0';
    const requestUrl = new URL(c.req.url);
    const requestPath = requestUrl.pathname;

    const env = getEnv(c);
    const downloadsStaticFiles = await getAssetsInDirectory('downloads', env);
    const allFiles = [...files, ...downloadsStaticFiles];

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

// PROPFIND /webdav/dmmcast/ - WebDAV endpoint for DMM Cast
app.on(['PROPFIND'], '/webdav/dmmcast/', async (c) => {
    const files = await getDMMCastWebDAVFiles(c);
    const depth = c.req.header('Depth') || '0';
    const requestUrl = new URL(c.req.url);
    const requestPath = requestUrl.pathname;

    const env = getEnv(c);
    const dmmcastStaticFiles = await getAssetsInDirectory('dmmcast', env);
    const allFiles = [...files, ...dmmcastStaticFiles];

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

// GET /webdav/ - HTML index showing both RD downloads and DMM cast (no WebDAV PROPFIND)
app.get('/webdav/', async (c) => {
    const rdFiles = await getRealDebridWebDAVFiles(c);
    const dmmFiles = await getDMMCastWebDAVFiles(c);
    const hostname = new URL(c.req.url).origin;

	const content = `
		${pageHeader('Cast Magnet Link: WebDAV', 'Available files for streaming')}
		${rdFiles && rdFiles.length > 0 ? `
		<div class="status-info">
			<h3>WebDAV: Most Recent Download Links</h3>
			<p><small>source: <a href="https://real-debrid.com/downloads" target="_blank">real-debrid.com/downloads</a></small><br />
			   <small>WebDAV: <code>${hostname}/webdav/downloads/</code></small>
            </p>
			<ul>
				${rdFiles.map(file => `
				<li><a href="/webdav/downloads/${file.name}">${file.name}</a> <small><code>${formatBytes(file.size)}</code></small></li>
				`).join('')}
			</ul>
		</div>
		` : ''}
		${dmmFiles && dmmFiles.length > 0 ? `
		<div class="status-info">
			<h3>WebDAV: Most Recent Casted Links</h3>
			<p><small>source: <a href="https://debridmediamanager.com/stremio/manage" target="_blank">debridmediamanager.com/stremio/manage</a></small><br />
			   <small>WebDAV: <code>${hostname}/webdav/dmmcast/</code></small>
            </p>
			<ul>
				${dmmFiles.map(file => `
				<li><a href="/webdav/dmmcast/${file.name}">${file.name}</a> <small><code>${formatBytes(file.size)}</code></small></li>
				`).join('')}
			</ul>
		</div>
		` : ''}
		${footer()}
	`;
    return c.html(layout('WebDAV', content));
});

// Redirect /webdav/downloads to /webdav/downloads/
app.all('/webdav/downloads', async (c) => {
    return c.redirect('/webdav/downloads/', 301);
});

// Redirect /webdav/dmmcast to /webdav/dmmcast/
app.all('/webdav/dmmcast', async (c) => {
    return c.redirect('/webdav/dmmcast/', 301);
});

// GET /webdav/downloads/ - HTML listing for Real-Debrid download links
app.get('/webdav/downloads/', async (c) => {
    const files = await getRealDebridWebDAVFiles(c);
	const content = `
		${pageHeader('Download Links', '<small>source: <a href="https://real-debrid.com/downloads" target="_blank">real-debrid.com/downloads</a></small>')}
		<div class="status-info">
			<h3>Available Files:</h3>
			<ul>
				${files.map(file => `
				<li><a href="/webdav/downloads/${file.name}">${file.name}</a> <small><code>${formatBytes(file.size)}</code></small></li>
				`).join('')}
			</ul>
		</div>
		${footer()}
	`;
    return c.html(layout('Download Links', content));
});

// GET /webdav/dmmcast/ - HTML listing for DMM Cast
app.get('/webdav/dmmcast/', async (c) => {
    const files = await getDMMCastWebDAVFiles(c);
	const content = `
		${pageHeader('DMM Casted Links', '<small>source: <a href="https://debridmediamanager.com/stremio/manage" target="_blank">debridmediamanager.com/stremio/manage</a></small>')}
		<div class="status-info">
			<h3>Available Files:</h3>
			<ul>
				${files.map(file => `
				<li><a href="/webdav/dmmcast/${file.name}">${file.name}</a> <small><code>${formatBytes(file.size)}</code></small></li>
				`).join('')}
			</ul>
		</div>
		${footer()}
	`;
    return c.html(layout('DMM Casted Links', content));
});

// --- Static File Serving ---
// Dynamically serve files from R2 (if configured) or bundled assets

// Serve style.css from root path
app.get('/style.css', async (c) => {
    const env = getEnv(c);
    const response = await serveAsset('style.css', env);
    return response || c.text('File not found: style.css', 404);
});

// Dynamic route handler for /public/* paths
app.get('/public/*', async (c) => {
    const path = c.req.path.replace('/public/', '');
    const env = getEnv(c);
    const response = await serveAsset(path, env);
    return response || c.text(`File not found: ${path}`, 404);
});

// Removed generic /webdav/:directory/:filename route
// Static files are now handled in the specific routes below

// GET /webdav/downloads/:filename - Serve .strm files from Real-Debrid download links or static files
app.get('/webdav/downloads/:filename', async (c) => {
    const { filename } = c.req.param();

    // First, try to serve as static file
    if (!filename.endsWith('.strm')) {
        const env = getEnv(c);
        const assetPath = `downloads/${filename}`;
        const response = await serveAsset(assetPath, env);
        if (response) {
            return response;
        }
        // If not found as static file, continue to .strm handling
    }

    // Handle .strm files
    const files = await getRealDebridWebDAVFiles(c);
    const file = files.find(f => f.name === filename);

    if (!file) {
        return c.text('File not found', 404);
    }

    if (filename.endsWith('.strm')) {
        return c.text(file.content, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    return c.text('File type not supported for direct GET', 400);
});

// GET /webdav/dmmcast/:filename - Serve .strm files from DMM Cast or static files
app.get('/webdav/dmmcast/:filename', async (c) => {
    const { filename } = c.req.param();

    // First, try to serve as static file
    if (!filename.endsWith('.strm')) {
        const env = getEnv(c);
        const assetPath = `dmmcast/${filename}`;
        const response = await serveAsset(assetPath, env);
        if (response) {
            return response;
        }
        // If not found as static file, continue to .strm handling
    }

    // Handle .strm files
    const files = await getDMMCastWebDAVFiles(c);
    const file = files.find(f => f.name === filename);

    if (!file) {
        return c.text('File not found', 404);
    }

    if (filename.endsWith('.strm')) {
        return c.text(file.content, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    return c.text('File type not supported for direct GET', 400);
});

export default app;
