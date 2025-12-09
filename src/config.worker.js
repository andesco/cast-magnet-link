// Cloudflare Workers configuration (no Node.js-specific variables)

export function getConfig(env) {
    const config = {
        // Real-Debrid Configuration
        rdAccessToken: env.RD_ACCESS_TOKEN,

        // WebDAV Authentication
        webdavUsername: env.WEBDAV_USERNAME || 'admin',
        webdavPassword: env.WEBDAV_PASSWORD,

        // Public URL (auto-detects from request if not set)
        publicUrl: env.PUBLIC_URL || 'http://localhost:3000',

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
