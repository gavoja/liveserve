import { createReadStream, watch as nodeWatch } from 'node:fs'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

const DEFAULT_HOSTNAME = 'localhost'
const DEFAULT_PORT = 3000
const DEFAULT_MIME_TYPE = 'application/octet-stream'
const DEFAULT_DEBOUNCE = 100

const MIME_TYPES = {
  '.css': 'text/css',
  '.eot': 'application/vnd.ms-fontobject',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.otf': 'application/font-otf',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'application/font-ttf',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'application/font-woff',
  '.woff2': 'application/font-woff2',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

const CLIENT_SCRIPT = `
(() => {
  let error = false

  const es = new EventSource('/events')

  es.addEventListener('init', () => {})
  es.addEventListener('reload', () => location.reload())

  es.onopen = () => {
    console.log('[serve] Connected to server.')
    if (error) {
      console.log('[serve] Reconnected to server, reloading...')
      location.reload()
      error = false
    }
  }

  es.onerror = () => {
    console.error('[serve] Connection error, attempting to reconnect...')
    error = true
  }
})();
`

const clients = new Set()

function sendEvent (res, event, data) {
  event && res.write(`event: ${event}\n`)
  res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`)
}

function reloadClients () {
  for (const res of clients) {
    sendEvent(res, 'reload', {})
  }
}

let previousDir = ''

export function watch ({ pathToWatch, debounce = DEFAULT_DEBOUNCE, callback }) {
  const payload = new Set()

  let timeout

  nodeWatch(pathToWatch, { recursive: true }, (eventType, filename) => {
    // Deduplicate parent folder changes.
    if (!filename || (previousDir === filename && eventType === 'change')) {
      return
    }

    previousDir = path.dirname(filename)
    payload.add(path.resolve(pathToWatch, filename))

    // Handle bulk changes in batches.
    clearTimeout(timeout)
    timeout = setTimeout(() => {
      const batch = [...payload].toSorted() // Ensure consistent order for stability.
      callback(batch)
      payload.clear()
    }, debounce)
  })
}

export async function serve ({ root, hostname = DEFAULT_HOSTNAME, port = DEFAULT_PORT, debounce = DEFAULT_DEBOUNCE }) {
  const origin = `http://${hostname}:${port}`
  const server = http.createServer(async (req, res) => {
    try {
      // Live reload event stream endpoint.
      if (req.url === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })

        sendEvent(res, 'init', String(Date.now()))
        clients.add(res)
        req.on('close', () => clients.delete(res))
        return
      }

      const reqUrl = new URL(decodeURIComponent(req.url), origin)

      let filePath = `${root}${reqUrl.pathname}`
      if (filePath === '/' || filePath.endsWith('/')) {
        filePath = filePath.replace(/\/$/, '') + '/index.html'
      }

      // Verify file exists.
      const stat = await fs.stat(filePath).catch(() => null)
      if (!stat || !stat.isFile()) {
        res.statusCode = 404
        res.end('Not found')
        return
      }

      const mimeType = MIME_TYPES[path.extname(filePath)] || DEFAULT_MIME_TYPE
      res.writeHead(200, { 'Content-Type': mimeType })

      // Stream file, then append the live reload script to HTML.
      const stream = createReadStream(filePath)
      stream.pipe(res, { end: false })
      stream.on('end', () => res.end(mimeType === 'text/html' ? `<script>${CLIENT_SCRIPT}</script>` : undefined))
      stream.on('error', () => res.end())
    } catch (err) {
      console.error(err)
      res.statusCode = 500
      res.end('Server error')
    }
  })

  server.listen(port)
  server.on('error', err => err.code !== 'EADDRINUSE' && console.error(err))

  if (!server.listening) {
    console.error(`[serve] Unable to start server. Is port ${port} available?`)
    return
  }

  console.log(`[serve] Listening at http://${hostname}:${port}.`)

  // Reload clients on change.
  watch({ pathToWatch: root, debounce, callback: reloadClients })
}

// Start when run directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  serve({ root: process.cwd() })
}
