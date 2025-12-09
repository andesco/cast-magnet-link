/**
 * IP Utility Functions
 *
 * Provides IP extraction and validation for both Cloudflare Workers and Node.js environments.
 */

/**
 * Extracts the user's IP address from the Hono context
 *
 * @param {Object} c - Hono context object
 * @returns {string} IP address or 'unknown'
 */
export function getUserIP(c) {
    // Cloudflare Workers: cf-connecting-ip header contains the real client IP
    const cfConnectingIP = c.req.header('cf-connecting-ip');
    if (cfConnectingIP) {
        return cfConnectingIP;
    }

    // Node.js: Access socket information via c.env.incoming
    // Note: c.env.incoming is set by @hono/node-server adapter
    if (c.env?.incoming?.socket?.remoteAddress) {
        const nodeIP = c.env.incoming.socket.remoteAddress;
        // Strip IPv6 wrapper if present (::ffff:192.168.1.1 -> 192.168.1.1)
        return nodeIP.replace(/^::ffff:/, '');
    }

    // Fallback headers (in case of proxy setup)
    const xForwardedFor = c.req.header('x-forwarded-for');
    if (xForwardedFor) {
        // x-forwarded-for can be a comma-separated list; take the first one
        return xForwardedFor.split(',')[0].trim();
    }

    const xRealIP = c.req.header('x-real-ip');
    if (xRealIP) {
        return xRealIP;
    }

    return 'unknown';
}

/**
 * Validates if an IP address is a public IP (not private/internal)
 *
 * @param {string} ip - IP address to validate
 * @returns {boolean} True if IP is public, false otherwise
 */
export function isPublicIP(ip) {
    if (!ip || ip === 'unknown') {
        return false;
    }

    // Must start with a digit (basic format check)
    if (!/^\d/.test(ip)) {
        return false;
    }

    // Parse the first octet for IPv4 check
    const parts = ip.split('.');
    if (parts.length !== 4) {
        // Not a standard IPv4 address (could be IPv6, but we'll skip for now)
        return false;
    }

    const firstOctet = parseInt(parts[0], 10);
    const secondOctet = parseInt(parts[1], 10);

    // Check for private IP ranges
    if (firstOctet === 10) {
        // 10.0.0.0/8
        return false;
    }

    if (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) {
        // 172.16.0.0/12
        return false;
    }

    if (firstOctet === 192 && secondOctet === 168) {
        // 192.168.0.0/16
        return false;
    }

    if (firstOctet === 127) {
        // 127.0.0.0/8 (loopback)
        return false;
    }

    if (firstOctet === 169 && secondOctet === 254) {
        // 169.254.0.0/16 (link-local)
        return false;
    }

    if (firstOctet === 0) {
        // 0.0.0.0/8 (invalid)
        return false;
    }

    if (firstOctet >= 224) {
        // 224.0.0.0/4 (multicast) and 240.0.0.0/4 (reserved)
        return false;
    }

    // All checks passed - this is a public IP
    return true;
}

/**
 * Gets a validated public IP from the request, or null if not available
 *
 * @param {Object} c - Hono context object
 * @returns {string|null} Public IP address or null
 */
export function getPublicIP(c) {
    const ip = getUserIP(c);
    return isPublicIP(ip) ? ip : null;
}
