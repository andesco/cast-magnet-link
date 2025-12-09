# Cast Magnet Link

Cast Magnet Link makes it quick and easy to stream [Real-Debrid] hosted media:

* cast from [Debrid Media Manager]
* available as unrestricted [download links]
* added manually using magnet links

Cast Magnet Link is:
* compatible with [Infuse] and other media players that support `WebDAV` and `.strm` files
* an alternative to [DMM Cast](https://debridmediamanager.com/stremio) but <ins>not</ins> a Stremio-compatible add-on
* built on [Hono] to run as either a Cloudflare Workers serverless function or a Node.js system service.

## Features

**Cast Magnet Links**: Add magnet links or infohashes to stream media <u>without</u> adding them to your Real-Debrid library.

**WebDAV**: Access your recent media via WebDAV and `.strm` files.

**Direct Streaming**: Stream your recent media using `.strm` files which redirect to unrestricted Real-Debrid downloads.

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

* **Cast from [Debrid Media Manager]**

* **Add a Magnet Link**\
   manually: `https://{hostname}/add` \
   query parameter: `https://{hostname}/?add{magnet link}` \
   path parameter:  `https://{hostname}/add/{magnet link}`

When submitting a magnet link or infohash, the service automatically:

1. adds the magnet link to Real-Debrid;
2. auto-selects the file (only one large file exists)
3. prompts for file selection (multiple large files exist)
4. generates and caches an unrestricted download link
5. removes the magnet link from your library (while keeping the download link)

### WebDAV

Connect your media player using these credentials:

- **URL**: `https://{hostname}/webdav/`
- **username**
- **password**

The WebDAV directory displays your **5 most recent unique Real-Debrid download links** as `.strm` files. This list is refreshed each time you access the service.

> [!important]
> To ensure compatability with Infuse and other media players, the URL in each `.strm` file inclues the service’s username and password (if set): `https://username:password@{hostname}/strm/:linkId`


Static metadata files from the `public/` directory are also served for media player  coverart:

<p style="text-align: center;"><img src="public/Infuse/favorite-atv.png" alt="Infuse artwork" width="300px"><br>
Cast Media Link</p>


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

[! warning]
> Cloudlfare Worker deployment is recommended and used by the developer.

**Local Deployment**:
```bash
npm run node:deploy:local
```

**Remote SSH Deployment**:
```bash
npm run node:deploy:remote
```

The remote deployment script will:
- prompt for your SSH hostname if not configured
- sync files via rsync
- install dependencies
- set proper file permissions and ownership
- configure and restart the systemd service
- optionally save your SSH host to `.env` for future deployments

Prerequisites for remote deployment:
1. configure `.env` with `SSH_HOST={server address/host/shortcut}`
1. optionally set `DEPLOY_PATH` (defaults to `/opt/cast-magnet-link`)
1. optionally set `REMOTE_USER` (defaults to `www-data`)

Both scripts will create `.env` from `.env.example` if needed and guide you through configuration.

**Manual Deployment**:

1. `cp .env.example .enn`

2. edit `.env` with credentials and variables: `RD_ACCESS_TOKEN` `WEBDAV_PASSWORD` etc.

3. `mkdir -p data`

4. `npm run node:start`

**`systemd`**

To run as a persistent background service, create a `systemd` service file.

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

Node.js/systemd:
```bash
sudo journalctl -u cast-magnet-link -f
```

Cloudflare Worker:
```bash
npx wrangler tail
```

### Smart IP Forwarding

The service automatically forwards your public IP address to Real-Debrid’s API. This improves streaming performance (optimal CDN routing), ensures more consistent IP address (avoids datacentre IP addresses), and mirrors the way [DMM Cast] forwards your IP address.

- **Cloudflare Workers**: uses `cf-connecting-ip`
- **Node.js**: extracts from `remoteAddress` socket connection
- falls back to `x-forwarded-for` or `x-real-ip` headers

Private IP ranges are automatically filtered and not sent to Real-Debrid:
- `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`
- `127.x.x.x` (loopback)
- `169.254.x.x` (link-local)

If no public IP is detected (e.g., local development), requests proceed without the IP parameter. This feature requires no configuration and works automatically in all deployment environments.

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
- Ensure secrets are set: `npx wrangler secret list`
- Verify KV namespace is configured correctly in `wrangler.toml`
- Check account_id is correct

[Hono]: http://hono.dev
[Infuse]: https://firecore.com/infuse
[strm]: https://support.firecore.com/hc/en-us/articles/30038115451799-STRM-Files
[Debrid Media Manager]: https://debridmediamanager.com
[dmm]: http://debridmediamanager.com
[DMM]: https://debridmediamanager.com
[DMM Cast]: https://debridmediamanager.com/stremio
[Real-Debrid]: https://real-debrid.com
[download links]: https://real-debrid.com/downloads