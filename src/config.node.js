// Node.js configuration (includes Node.js-specific variables)
import path from 'path';

export function getConfig(env) {
    const config = {
        // Real-Debrid Configuration
        rdAccessToken: env.RD_ACCESS_TOKEN,

        // Server Configuration (Node.js-specific)
        // Using bracket notation to hide from Cloudflare Dashboard scanner
        port: parseInt(env['PORT']) || 3000,
        host: env['HOST'] || '0.0.0.0',
        publicUrl: env.PUBLIC_URL || 'http://localhost:3000',

        // WebDAV Authentication
        webdavUsername: env.WEBDAV_USERNAME || 'admin',
        webdavPassword: env.WEBDAV_PASSWORD,

        // Data Directory (Node.js only)
        dataDir: env['DATA_DIR'] ? path.resolve(env['DATA_DIR']) : path.resolve('./data'),

        // Logging
        logFormat: env.LOG_FORMAT || 'text', // 'json' or 'text'
    };

    // Validation
    const required = {
        rdAccessToken: 'RD_ACCESS_TOKEN',
        webdavPassword: 'WEBDAV_PASSWORD',
    };

    const missing = [];
    for (const [key, envVar] of Object.entries(required)) {
        if (!config[key]) {
            missing.push(envVar);
        }
    }

    if (missing.length > 0) {
        const errorMsg = `Missing required environment variables: ${missing.join(', ')}`;
        console.error(errorMsg);
    }

    return config;
}
