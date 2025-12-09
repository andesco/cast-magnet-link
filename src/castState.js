const fs = require('fs').promises;
const path = require('path');
const config = require('./config');

const STATE_FILE = path.join(config.dataDir, 'cast-state.json');

// In-memory cache
let currentCast = null;

/**
 * Loads cast state from disk
 * @returns {Promise<Object|null>} Cast state or null
 */
async function loadState() {
  try {
    const data = await fs.readFile(STATE_FILE, 'utf8');
    currentCast = JSON.parse(data);
    return currentCast;
  } catch (error) {
    if (error.code === 'ENOENT') {
      currentCast = null;
      return null;
    }
    console.error('Error loading cast state:', error.message);
    currentCast = null;
    return null;
  }
}

/**
 * Saves cast state to disk
 * @param {Object} cast - Cast object
 * @returns {Promise<void>}
 */
async function saveState(cast) {
  try {
    await fs.writeFile(STATE_FILE, JSON.stringify(cast, null, 2), 'utf8');
    currentCast = cast;
  } catch (error) {
    console.error('Error saving cast state:', error.message);
    throw error;
  }
}

/**
 * Gets the current cast
 * @returns {Object|null} Current cast or null
 */
function getCurrentCast() {
  return currentCast;
}

/**
 * Sets a new cast (replaces existing)
 * @param {Object} cast - Cast object with {hash, title, size, unrestrictedUrl}
 * @returns {Promise<void>}
 */
async function setCast(cast) {
  const newCast = {
    ...cast,
    cachedAt: new Date().toISOString(),
  };

  await saveState(newCast);
  console.log('Cast saved:', {
    title: newCast.title,
    size: newCast.size,
    hash: newCast.hash ? newCast.hash.substring(0, 8) + '...' : 'N/A',
  });
}

/**
 * Clears the current cast
 * @returns {Promise<void>}
 */
async function clearCast() {
  try {
    await fs.unlink(STATE_FILE);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error clearing cast state:', error.message);
    }
  }
  currentCast = null;
  console.log('Cast cleared');
}

// Initialize on module load
(async () => {
  await loadState();
  if (currentCast) {
    console.log('Loaded existing cast:', {
      title: currentCast.title,
      cachedAt: currentCast.cachedAt,
    });
  }
})();

module.exports = {
  getCurrentCast,
  setCast,
  clearCast,
};
