import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const root = process.cwd()
const port = Number(process.env.PORT) || 5173
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`)
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname
  const filePath = normalize(join(root, pathname))
  if (!filePath.startsWith(root)) {
    response.writeHead(403)
    response.end('forbidden')
    return
  }
  try {
    const info = await stat(filePath)
    if (info.isDirectory()) throw new Error('directory')
    const body = await readFile(filePath)
    response.writeHead(200, { 'content-type': types[extname(filePath)] || 'application/octet-stream' })
    response.end(body)
  } catch {
    response.writeHead(404)
    response.end('not found')
  }
}).listen(port, () => {
  console.log(`serving http://localhost:${port}`)
})
