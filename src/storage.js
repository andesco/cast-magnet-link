import { promises as fs } from 'fs';
import path from 'path';
const isWorker = typeof caches !== 'undefined';

// Conditionally import config only in Node.js environment
let config;
if (!isWorker) {
    const { getConfig } = await import('./config.node.js');
    config = getConfig(process.env);
}

// --- Worker (Cloudflare KV) Implementation ---

const workerStorage = {
    // STRM Cache
    async getStrmEntry(env, linkId) {
        return env.CAST_MAGNET_LINK.get(linkId, 'json');
    },
    async addStrmEntry(env, linkId, originalLink, unrestrictedUrl, filename, manuallyAdded = false, filesize = 0) {
        // If the new entry is not manually added, check if an existing manually added entry exists.
        if (!manuallyAdded) {
            const existingEntry = await this.getStrmEntry(env, linkId);
            if (existingEntry && existingEntry.manuallyAdded) {
                // If a manually added entry exists, just update its generation date to keep it fresh
                existingEntry.generatedAt = new Date().toISOString();
                const sevenDaysInSeconds = 7 * 24 * 60 * 60;
                return env.CAST_MAGNET_LINK.put(linkId, JSON.stringify(existingEntry), {
                    expirationTtl: sevenDaysInSeconds,
                });
            }
        }

        const entry = {
            originalLink,
            unrestrictedUrl,
            generatedAt: new Date().toISOString(),
            filename,
            manuallyAdded,
            filesize,
        };
        // KV items have a minimum 60s TTL. 7 days in seconds.
        const sevenDaysInSeconds = 7 * 24 * 60 * 60;
        return env.CAST_MAGNET_LINK.put(linkId, JSON.stringify(entry), {
            expirationTtl: sevenDaysInSeconds,
        });
    },
    async updateStrmUrl(env, linkId, newUnrestrictedUrl) {
        const entry = await this.getStrmEntry(env, linkId);
        if (entry) {
            entry.unrestrictedUrl = newUnrestrictedUrl;
            entry.generatedAt = new Date().toISOString();
            const sevenDaysInSeconds = 7 * 24 * 60 * 60;
            return env.CAST_MAGNET_LINK.put(linkId, JSON.stringify(entry), {
                expirationTtl: sevenDaysInSeconds,
            });
        }
    },
    async getAllStrmEntries(env) {
        const list = await env.CAST_MAGNET_LINK.list();
        const keys = list.keys.map(k => k.name);
        const promises = keys.map(key => this.getStrmEntry(env, key));
        return Promise.all(promises);
    }
};

// --- Node.js (Filesystem) Implementation ---

// In-memory cache for Node.js to reduce disk I/O
let nodeStrmCache = null;

const nodeStorage = {
    async _loadNodeStrmCache() {
        if (nodeStrmCache) return nodeStrmCache;
        try {
            const data = await fs.readFile(path.join(config.dataDir, 'strm-cache.json'), 'utf8');
            nodeStrmCache = JSON.parse(data);
            return nodeStrmCache;
        } catch (error) {
            if (error.code === 'ENOENT') return {};
            throw error;
        }
    },

    // STRM Cache
    async _cleanupAndSaveStrmCache(cache) {
        const now = Date.now();
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        const cleaned = {};
        for (const [linkId, entry] of Object.entries(cache)) {
            if (now - new Date(entry.generatedAt).getTime() < sevenDaysMs) {
                cleaned[linkId] = entry;
            }
        }
        nodeStrmCache = cleaned;
        await fs.mkdir(config.dataDir, { recursive: true });
        return fs.writeFile(path.join(config.dataDir, 'strm-cache.json'), JSON.stringify(cleaned, null, 2));
    },

    async getStrmEntry(env, linkId) { // env is not used in node
        const cache = await this._loadNodeStrmCache();
        return cache[linkId] || null;
    },
    async addStrmEntry(env, linkId, originalLink, unrestrictedUrl, filename, manuallyAdded = false, filesize = 0) {
        const cache = await this._loadNodeStrmCache();

        // If the new entry is not manually added, but an existing manually added entry exists, don't overwrite it.
        if (!manuallyAdded && cache[linkId] && cache[linkId].manuallyAdded) {
            // Just update its generation date to keep it fresh
            cache[linkId].generatedAt = new Date().toISOString();
            return this._cleanupAndSaveStrmCache(cache);
        }

        cache[linkId] = {
            originalLink,
            unrestrictedUrl,
            generatedAt: new Date().toISOString(),
            filename,
            manuallyAdded,
            filesize,
        };
        return this._cleanupAndSaveStrmCache(cache);
    },
    async updateStrmUrl(env, linkId, newUnrestrictedUrl) {
        const cache = await this._loadNodeStrmCache();
        if (cache[linkId]) {
            cache[linkId].unrestrictedUrl = newUnrestrictedUrl;
            cache[linkId].generatedAt = new Date().toISOString();
            return this._cleanupAndSaveStrmCache(cache);
        }
    },
    async getAllStrmEntries() {
        const cache = await this._loadNodeStrmCache();
        return Object.values(cache);
    }
};

// Export the correct implementation
export default isWorker ? workerStorage : nodeStorage;
