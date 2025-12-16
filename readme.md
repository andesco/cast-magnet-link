# Cast Magnet Link

Cast Magnet Link makes it quick and easy to stream [Real-Debrid] hosted media:

* cast from [Debrid Media Manager];
* available as unrestricted [download links]; or
* added manually using magnet links.

Cast Magnet Link:
* avoids using Stremio and add-ons;
* is compatible with [Infuse] and media players that support **`WebDAV`** and **`.strm`** files; and
* was built on [Hono] to run as either a Cloudflare Workers serverless function or a Node.js system service.

## Features

**Download Links**: stream recent [download links] directly from Real-Debrid servers.

**Casted Links**: stream media cast with [DMM Cast] <u>without</u> using the Stremio add-on.

**Add Magnet Link**: add a magnet link or infohash to stream media <u>without</u> adding it to your Real-Debrid library.

<div align="center">
    <p><img src="public/downloads/favorite-atv.png" width="300px"><br />
    Download Links
    <p><img src="public/dmmcast/favorite-atv.png" width="300px"><br />
    Casted Links
</div>

## Deploy to Cloudflare
   
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/andesco/cast-magnet-link)
      
1. Workers → Create an application → [Clone a repository](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/deploy-to-workers): <nobr>Git repository URL:</nobr>
   ```
   https://github.com/andesco/cast-magnet-link
   ```

2. [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages/) ⇢ {worker name} ⇢ Settings: <nobr>Variables and Secrets:</nobr>

   **Required Secrets**:\
   `RD_ACCESS_TOKEN` · https://real-debrid.com/apitoken \
   `WEBDAV_USERNAME` \
   `WEBDAV_PASSWORD`
   
   Optional Text Variables:\
   `PORT`
   `HOST`
   `DATA_DIR`
   `PUBLIC_URL`
   

3. Verifify your current list of streamable media:
   ```
   https://cast-magnet-link.{user}.workers.dev
   ```

4. Add the WebDAV endpoint to your media player:
   ```
   https://cast-magnet-link.{user}.workers.dev/webdav/
   ```

## Usage

### Adding Media

* **Cast from Debrid Media Manager:** \
  cast: <code>[debridmediamanager.com](https://debridmediamanager.com)</code> \
  manage casted links: <code>[debridmediamanager.com/stremio/manage](https://debridmediamanager.com/stremio/manage)</code>

* **Add a Magnet Link**\
   manually: `https://{hostname}/add` \
   query parameter: `https://{hostname}/?add{magnet link}` \
   path parameter:  `https://{hostname}/add/{magnet link}`

  When submitting a magnet link or infohash, the service automatically:
  
  - adds the magnet link to Real-Debrid;
  - auto-selects the file (only one large file exists)
  - prompts for file selection (multiple large files exist)
  - generates and caches an unrestricted download link
  - removes the magnet link from your library (while keeping the download link)

> [!NOTE]
> A browser extension like [StopTheMadness Pro](https://apple.co/4e0lkPG) that supports [URL redirect rules](https://underpassapp.com/StopTheMadness/Pro/Docs/Redirects.html) can redirect magnet links to this service to automatically create new download links: \
> matching pattern: `/^magnet:\?xt=urn:btih:([A-Fa-f0-9]+)(?:&amp;.*)?$/` \
> replacement pattern: `https://cast.user.workers.dev/add/$1`

### WebDAV

Add one or both of the WebDAV endpoints to your media player:

- URL: `https://{hostname}/webdav/downloads/`
  - 10 most recent download links
- URL: `https://{hostname}/webdav/dmmcast/`
  - all DMM Cast media added within the last 7 days**
- username: `WEBDAV_USERNAME`
- password: `WEBDAV_PASSWORD`

WebDAV directories and file lists are refreshed each time you access the service, with `.strm` files created for each link.

### Media Player Artwork

Infuse and other media players that support [overriding artwork](https://support.firecore.com/hc/en-us/articles/4405042929559-Overriding-Artwork-and-Metadata) can use the [artwork] served via WebDAV. Infuse defaults to using `favorite.png` and `favorite-atv.png`.

## Configuration

### Environment Variables

Configuration is handled through environment variables. Set them according to your deployment method:

- **Node.js**: create a `.env` file in the project root
- **Cloudflare Worker**: use `npx wrangler secret put {VARIABLE_NAME}`

| Variable | Description | Default |
|:---|:---|:---|
| `RD_ACCESS_TOKEN` | **required**: your Real-Debrid API access token | |
| `WEBDAV_PASSWORD` | **required**: password for basic auth | |
| `WEBDAV_USERNAME` | username for basic auth | `admin` |
| `PORT` | port for Node.js server | `3000` |
| `HOST` | bind address for Node.js server | `0.0.0.0` |
| `DATA_DIR` | cache storage directory for Node.js | `./data` |
| `PUBLIC_URL` | public-facing URL for `.strm` files; only required for custom domains behind reverse proxies |  |

## Technical Notes

### Deploy to Cloudflare using Wrangler CLI

```
gh repo clone andesco/cast-magnet-link

wrangler secret put RD_ACCESS_TOKEN
wrangler secret put WEBDAV_USERNAME
wrangler secret put WEBDAV_PASSWORD

wrangler deploy
```

### Deploy as Node.js System Service

Run the service on a traditional VPS or server.

> [!NOTE]
> Cloudlfare Worker deployment is recommended and used by the developer.

**Manual Deployment**:

1. `cp .env.example .env`

2. edit `.env` with credentials and variables: `RD_ACCESS_TOKEN` `WEBDAV_USERNAME` `WEBDAV_PASSWORD` etc.

3. `mkdir -p data`

4. `npm run node:start`

**System Service:**

To run as a persistent background service, use the provided `cast-magnet-link.service.example` as a template for a **`systemd`** service file.

  - Copy the example file to: <nobr>`/etc/systemd/system/cast-magnet-link.service`</nobr>
  - Edit the new file, adjusting these as needed: <nobr>`User` `WorkingDirectory` `ExecStart`</nobr>
  - Enable and start the new service:
    ```bash
    sudo systemctl enable cast-magnet-link.service
    sudo systemctl start cast-magnet-link.service
    ```

### Health Check Endpoint

The `/health` endpoint is available for monitoring and does not require authentication:
```
http://your-server-url/health
```
```json
{
  "status": "ok",
  "uptime": 123.456,
  "timestamp": "2025-12-09T12:00:00.000Z"
}
```

### Service Logs

Node.js `systemd`:
```bash
sudo journalctl -u cast-magnet-link -f
```

Cloudflare Worker:
```bash
npx wrangler tail
```

### Add Magent Link: Smart IP Forwarding

The service automatically forwards your public IP address to Real-Debrid’s API. This mirrors the way [Debrid Media Manager] forwards your IP address.

- **Cloudflare Workers**: uses `cf-connecting-ip`
- **Node.js**: extracts from `remoteAddress` socket connection
- falls back to `x-forwarded-for` or `x-real-ip` headers

Private IP ranges are automatically filtered and not sent to Real-Debrid:
- `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`
- `127.x.x.x` (loopback)
- `169.254.x.x` (link-local)

If no public IP is detected (local development), requests proceed without the IP parameter. This feature requires no configuration and works automatically in all deployment environments.

## Troubleshooting

### Common Issues

**Authentication fails:**
- verify `WEBDAV_USERNAME` and `WEBDAV_PASSWORD` are set correctly
- check the credentials used by your media player

**Node.js service fails to start:**
- verify the port is not already in use: `lsof -i :3000`
- check all required environment variables are set in `.env`
- review logs: `sudo journalctl -u cast-magnet-link -n 50`

**Cloudflare Worker deployment fails:**
- ensure secrets are set: `npx wrangler secret list`
- verify KV namespace is configured correctly in `wrangler.toml`
- check if `account_id` is correct

[Hono]: http://hono.dev
[Infuse]: https://firecore.com/infuse
[strm]: https://support.firecore.com/hc/en-us/articles/30038115451799-STRM-Files
[Debrid Media Manager]: https://debridmediamanager.com
[dmm]: http://debridmediamanager.com
[DMM]: https://debridmediamanager.com
[DMM Cast]: https://debridmediamanager.com/stremio/manage
[Stremio add-on]: https://debridmediamanager.com/stremio
[Real-Debrid]: https://real-debrid.com
[download links]: https://real-debrid.com/downloads
[artwork]: https://github.com/andesco/cast-magnet-link/tree/main/public
