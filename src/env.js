/**
 * Universal Environment Accessor
 *
 * Provides a unified way to access environment variables across different runtimes:
 * - Cloudflare Workers: reads from c.env (bindings)
 * - Node.js: reads from process.env
 *
 * This eliminates the need for runtime detection and makes the code truly universal.
 */

export function getEnv(c) {
    return new Proxy({}, {
        get(target, prop) {
            // Try c.env first (Cloudflare Workers bindings)
            if (c.env && prop in c.env) {
                return c.env[prop];
            }

            // Fall back to process.env (Node.js)
            if (typeof process !== 'undefined' && process.env && prop in process.env) {
                return process.env[prop];
            }

            return undefined;
        },

        // Support 'in' operator checks
        has(target, prop) {
            if (c.env && prop in c.env) {
                return true;
            }
            if (typeof process !== 'undefined' && process.env && prop in process.env) {
                return true;
            }
            return false;
        }
    });
}
