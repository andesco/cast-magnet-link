const config = require('./config');

function log(level, message, metadata = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...metadata,
  };

  if (config.logFormat === 'json') {
    console.log(JSON.stringify(logEntry));
  } else {
    // Default to plain text for development/simplicity
    const metaString = Object.keys(metadata).length > 0 ? ` ${JSON.stringify(metadata)}` : '';
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}${metaString}`);
  }
}

module.exports = {
  info: (message, metadata) => log('info', message, metadata),
  warn: (message, metadata) => log('warn', message, metadata),
  error: (message, metadata) => log('error', message, metadata),
  debug: (message, metadata) => log('debug', message, metadata),
};
