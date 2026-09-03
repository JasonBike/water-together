import { createServer } from 'node:http'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { createReadStream } from 'node:fs'
import { join, normalize, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const rootDir = dirname(fileURLToPath(import.meta.url))
const dataDir = join(rootDir, 'data')
const databasePath = process.env.WATER_DB_PATH || join(dataDir, 'water-together.sqlite')
const distDir = join(rootDir, 'dist')
const port = Number(process.env.PORT || 8787)

mkdirSync(dirname(databasePath), { recursive: true })
const db = new DatabaseSync(databasePath)
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    emoji TEXT NOT NULL,
    color TEXT NOT NULL,
    gender TEXT NOT NULL DEFAULT 'secret',
    cup_capacity INTEGER NOT NULL DEFAULT 350,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('fetch', 'drink', 'restroom')),
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS actions_member_date_idx ON actions(member_id, date);
  CREATE INDEX IF NOT EXISTS actions_created_at_idx ON actions(created_at);
`)

const memberColumns = 'id, name, emoji, color, gender, cup_capacity AS cupCapacity'
const actionColumns = 'id, member_id AS memberId, type, date, time, created_at AS createdAt'
const selectMembers = db.prepare(`SELECT ${memberColumns} FROM members ORDER BY created_at ASC`)
const selectActions = db.prepare(`SELECT ${actionColumns} FROM actions ORDER BY created_at ASC`)
const selectMember = db.prepare(`SELECT ${memberColumns} FROM members WHERE id = ?`)
const selectMemberByName = db.prepare(`SELECT ${memberColumns} FROM members WHERE name = ?`)
const upsertMember = db.prepare(`
  INSERT INTO members (id, name, emoji, color, gender, cup_capacity, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(name) DO UPDATE SET
    emoji = excluded.emoji,
    color = excluded.color,
    gender = excluded.gender,
    cup_capacity = excluded.cup_capacity
`)
const insertAction = db.prepare(`
  INSERT INTO actions (id, member_id, type, date, time, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`)
const selectAction = db.prepare(`SELECT ${actionColumns} FROM actions WHERE id = ?`)
const deleteAction = db.prepare('DELETE FROM actions WHERE id = ?')
const deleteDateActions = db.prepare('DELETE FROM actions WHERE member_id = ? AND date = ?')
const memberExists = db.prepare('SELECT id FROM members WHERE id = ?')

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  })
  response.end(body)
}

function sendEmpty(response, status = 204) {
  response.writeHead(status, { 'Access-Control-Allow-Origin': '*' })
  response.end()
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 100_000) reject(new Error('request body too large'))
    })
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        reject(new Error('invalid json'))
      }
    })
    request.on('error', reject)
  })
}

function validMemberPayload(payload) {
  const capacities = [250, 350, 500, 750]
  const genders = ['female', 'male', 'secret']
  return payload
    && typeof payload.name === 'string'
    && payload.name.trim().length > 0
    && payload.name.trim().length <= 12
    && typeof payload.emoji === 'string'
    && typeof payload.color === 'string'
    && genders.includes(payload.gender)
    && capacities.includes(Number(payload.cupCapacity))
}

function validActionPayload(payload) {
  return payload
    && typeof payload.id === 'string'
    && typeof payload.memberId === 'string'
    && ['fetch', 'drink', 'restroom'].includes(payload.type)
    && /^\d{4}-\d{2}-\d{2}$/.test(payload.date)
    && typeof payload.time === 'string'
    && typeof payload.createdAt === 'number'
}

async function handleApi(request, response, url) {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    response.end()
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
    sendJson(response, 200, { members: selectMembers.all(), actions: selectActions.all() })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/members') {
    const payload = await readBody(request)
    if (!validMemberPayload(payload)) {
      sendJson(response, 400, { error: 'invalid member payload' })
      return
    }
    const existing = selectMemberByName.get(payload.name.trim())
    const id = existing?.id || (typeof payload.id === 'string' && payload.id ? payload.id : `member-${Date.now()}`)
    upsertMember.run(
      id,
      payload.name.trim(),
      payload.emoji,
      payload.color,
      payload.gender,
      Number(payload.cupCapacity),
      Number.isFinite(payload.createdAt) ? payload.createdAt : Date.now(),
    )
    sendJson(response, 200, selectMember.get(id) || selectMemberByName.get(payload.name.trim()))
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/actions') {
    const payload = await readBody(request)
    if (!validActionPayload(payload) || !memberExists.get(payload.memberId)) {
      sendJson(response, 400, { error: 'invalid action payload' })
      return
    }
    insertAction.run(payload.id, payload.memberId, payload.type, payload.date, payload.time, payload.createdAt)
    sendJson(response, 201, selectAction.get(payload.id))
    return
  }

  const actionMatch = url.pathname.match(/^\/api\/actions\/([^/]+)$/)
  if (request.method === 'DELETE' && actionMatch) {
    deleteAction.run(decodeURIComponent(actionMatch[1]))
    sendEmpty(response)
    return
  }

  if (request.method === 'DELETE' && url.pathname === '/api/actions') {
    const memberId = url.searchParams.get('memberId')
    const date = url.searchParams.get('date')
    if (!memberId || !date) {
      sendJson(response, 400, { error: 'memberId and date are required' })
      return
    }
    deleteDateActions.run(memberId, date)
    sendEmpty(response)
    return
  }

  sendJson(response, 404, { error: 'not found' })
}

function serveStatic(request, response, url) {
  if (!existsSync(distDir)) {
    sendJson(response, 503, { error: 'dist is missing, run npm run build first' })
    return
  }
  const requested = url.pathname === '/' ? '/index.html' : url.pathname
  const candidate = normalize(join(distDir, requested))
  const safePath = candidate.startsWith(distDir) ? candidate : join(distDir, 'index.html')
  const path = existsSync(safePath) && statSync(safePath).isFile() ? safePath : join(distDir, 'index.html')
  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(path).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': extname(path) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  })
  createReadStream(path).pipe(response)
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(request, response, url)
    else if (request.method === 'GET' || request.method === 'HEAD') serveStatic(request, response, url)
    else sendJson(response, 405, { error: 'method not allowed' })
  } catch (error) {
    console.error(error)
    if (!response.headersSent) sendJson(response, 500, { error: 'internal server error' })
    else response.end()
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`Water Together server listening on http://0.0.0.0:${port}`)
  console.log(`SQLite database: ${databasePath}`)
})

function close() {
  server.close(() => {
    db.close()
    process.exit(0)
  })
}

process.on('SIGINT', close)
process.on('SIGTERM', close)
