const fs = require('fs');
const path = require('path');
const config = require('./config');

const CACHE_FILE = path.join(config.dataDir, 'strm-cache.json');
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000; // 168 hours in milliseconds

/**
 * Load .strm cache from disk
 * @returns {Object} Cache object mapping link IDs to their data
 */
function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading strm cache:', error.message);
  }
  return {};
}

/**
 * Save .strm cache to disk
 * @param {Object} cache - Cache object to save
 */
function saveCache(cache) {
  try {
    // Ensure data directory exists
    if (!fs.existsSync(config.dataDir)) {
      fs.mkdirSync(config.dataDir, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving strm cache:', error.message);
  }
}

/**
 * Clean up cache entries older than 7 days
 * @param {Object} cache - Cache object
 * @returns {Object} Cleaned cache
 */
function cleanupOldEntries(cache) {
  const now = Date.now();
  const cleaned = {};
  let removedCount = 0;

  for (const [linkId, entry] of Object.entries(cache)) {
    const generatedAt = new Date(entry.generatedAt).getTime();
    const age = now - generatedAt;

    if (age < SEVEN_DAYS_MS) {
      cleaned[linkId] = entry;
    } else {
      removedCount++;
    }
  }

  if (removedCount > 0) {
    console.log(`Cleaned up ${removedCount} old .strm cache entries`);
  }

  return cleaned;
}

/**
 * Add or update a .strm cache entry
 * @param {string} linkId - Real-Debrid link ID (from https://real-debrid.com/d/{linkId})
 * @param {string} originalLink - Original Real-Debrid link
 * @param {string} unrestrictedUrl - Unrestricted download URL
 * @param {string} filename - Original filename
 */
function addEntry(linkId, originalLink, unrestrictedUrl, filename) {
  let cache = loadCache();
  cache = cleanupOldEntries(cache);

  cache[linkId] = {
    originalLink,
    unrestrictedUrl,
    generatedAt: new Date().toISOString(),
    filename,
  };

  saveCache(cache);
  console.log(`Added .strm cache entry for: ${filename} (${linkId})`);
}

/**
 * Get a .strm cache entry by link ID
 * @param {string} linkId - Real-Debrid link ID
 * @returns {Object|null} Cache entry or null if not found
 */
function getEntry(linkId) {
  let cache = loadCache();
  cache = cleanupOldEntries(cache);
  saveCache(cache); // Save cleaned cache

  return cache[linkId] || null;
}

/**
 * Update the unrestricted URL for an existing entry
 * @param {string} linkId - Real-Debrid link ID
 * @param {string} newUnrestrictedUrl - New unrestricted download URL
 */
function updateUnrestrictedUrl(linkId, newUnrestrictedUrl) {
  const cache = loadCache();

  if (cache[linkId]) {
    cache[linkId].unrestrictedUrl = newUnrestrictedUrl;
    cache[linkId].generatedAt = new Date().toISOString(); // Update timestamp
    saveCache(cache);
    console.log(`Updated .strm cache entry for: ${cache[linkId].filename} (${linkId})`);
  }
}

/**
 * Get all cache entries (cleaned)
 * @returns {Object} All cache entries
 */
function getAllEntries() {
  let cache = loadCache();
  cache = cleanupOldEntries(cache);
  saveCache(cache);
  return cache;
}

module.exports = {
  addEntry,
  getEntry,
  updateUnrestrictedUrl,
  getAllEntries,
};
