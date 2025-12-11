// src/html.js

export function layout(title, content) {
    const pageTitle = title ? `${title} - Cast Magnet Link` : 'Cast Magnet Link';
    // The cache-busting query parameter is added here.
    const cacheBuster = new Date().getTime();
    return `<!DOCTYPE html>
<html data-theme="light">
<head>
    <meta charset="UTF-8">
    <title>${pageTitle}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
    <link rel="stylesheet" href="/style.css?_v=${cacheBuster}">
    <script>
        // Support light and dark mode based on system preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    </script>
</head>
<body>
    <main class="container">
        <article>
            ${content}
        </article>
    </main>
</body>
</html>`;
}

export function statusHeader(error = null, success = null, defaultTitle = 'Cast Magnet Link', defaultSubtitle = 'Enter a magnet link or infohash to add to WebDAV') {
    const title = error ? 'Error' : success || defaultTitle;
    const subtitle = !error && !success ? defaultSubtitle : null;
    return `
<header>
    ${error ? `<span class="status-badge error">ERROR</span>` : ''}
    ${success ? `<span class="status-badge success">SUCCESS</span>` : ''}
    <h2>${title}</h2>
    ${subtitle ? `<p>${subtitle}</p>` : ''}
</header>`;
}

export function pageHeader(title, subtitle = null) {
    return `
<header>
    <h2>${title}</h2>
    ${subtitle ? `<p>${subtitle}</p>` : ''}
</header>`;
}

export function footer() {
    return `
<footer style="margin-top: 2rem; text-align: center;">
    <small>
        <a href="/">Home</a> &middot;
        <a href="/add">Add Magnet Link</a> &middot;
        <a href="/webdav/">WebDAV</a>
    </small>
</footer>`;
}

export function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    // Always show MB as GB for better readability
    if (i === 2) { // MB
        const gb = bytes / Math.pow(k, 3);
        return Math.round(gb * 100) / 100 + ' GB';
    }

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
