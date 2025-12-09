const RD_API_BASE = 'https://api.real-debrid.com/rest/1.0';

async function rdApiCall(config, path, options = {}) {
    const url = `${RD_API_BASE}${path}`;
    const headers = {
        ...options.headers,
        'Authorization': `Bearer ${config.rdAccessToken}`,
    };

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`RD API Error: ${response.status} ${response.statusText}`, errorBody);
        throw new Error(`Real-Debrid API request failed: ${response.status} ${response.statusText}`);
    }

    if (response.status === 204) { // No Content
        return;
    }

    return response.json();
}

async function addTorrent(config, magnetOrHash) {
    const magnet = magnetOrHash.startsWith('magnet:')
        ? magnetOrHash
        : `magnet:?xt=urn:btih:${magnetOrHash}`;

    const body = `magnet=${encodeURIComponent(magnet)}`;
    return rdApiCall(config, '/torrents/addMagnet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body,
    });
}

async function getTorrentInfo(config, torrentId) {
    return rdApiCall(config, `/torrents/info/${torrentId}`);
}

async function selectFiles(config, torrentId, fileIds = 'all') {
    const body = `files=${fileIds}`;
    return rdApiCall(config, `/torrents/selectFiles/${torrentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body,
    });
}

async function deleteTorrent(config, torrentId) {
    return rdApiCall(config, `/torrents/delete/${torrentId}`, {
        method: 'DELETE',
    });
}

/**
 * Unrestricts a Real-Debrid link to get the direct download URL
 *
 * @param {Object} config - Configuration object
 * @param {string} link - Real-Debrid link to unrestrict
 * @param {string|null} [userIP=null] - Optional public IP address of the user
 * @returns {Promise<string>} Direct download URL
 */
async function unrestrictLink(config, link, userIP = null) {
    let body = `link=${encodeURIComponent(link)}`;

    // Add IP parameter only if it's a valid public IP
    if (userIP) {
        body += `&ip=${encodeURIComponent(userIP)}`;
        console.log(`Unrestricting link with user IP: ${userIP}`);
    }

    const data = await rdApiCall(config, '/unrestrict/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body,
    });
    return data.download;
}

async function getTorrentsList(config) {
    return rdApiCall(config, '/torrents');
}

async function getDownloadsList(config, limit = 50) {
    return rdApiCall(config, `/downloads?limit=${limit}`);
}

export {
    addTorrent,
    getTorrentInfo,
    getTorrentsList,
    getDownloadsList,
    selectFiles,
    deleteTorrent,
    unrestrictLink,
};