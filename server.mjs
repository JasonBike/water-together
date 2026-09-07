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

  CREATE TABLE IF NOT EXISTS nudges (
    id TEXT PRIMARY KEY,
    from_member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    to_member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS nudges_to_member_idx ON nudges(to_member_id, created_at);

  CREATE TABLE IF NOT EXISTS daily_notes (
    date TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS note_likes (
    date TEXT NOT NULL REFERENCES daily_notes(date) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (date, member_id)
  );

  CREATE INDEX IF NOT EXISTS note_likes_member_idx ON note_likes(member_id, date);
`)

const memberColumns = 'id, name, emoji, color, gender, cup_capacity AS cupCapacity'
const actionColumns = 'id, member_id AS memberId, type, date, time, created_at AS createdAt'
const nudgeColumns = 'id, from_member_id AS fromMemberId, to_member_id AS toMemberId, date, time, created_at AS createdAt'
const selectMembers = db.prepare(`SELECT ${memberColumns} FROM members ORDER BY created_at ASC`)
const selectActions = db.prepare(`SELECT ${actionColumns} FROM actions ORDER BY created_at ASC`)
const selectNudges = db.prepare(`SELECT ${nudgeColumns} FROM nudges ORDER BY created_at ASC`)
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
const insertNudge = db.prepare(`
  INSERT INTO nudges (id, from_member_id, to_member_id, date, time, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`)
const selectNudge = db.prepare(`SELECT ${nudgeColumns} FROM nudges WHERE id = ?`)
const selectNotes = db.prepare('SELECT date, content, updated_at AS updatedAt FROM daily_notes ORDER BY date ASC')
const selectNoteLikeRows = db.prepare('SELECT date, member_id AS memberId FROM note_likes ORDER BY created_at ASC')
const selectNote = db.prepare('SELECT date, content, updated_at AS updatedAt FROM daily_notes WHERE date = ?')
const selectNoteLikesCount = db.prepare('SELECT COUNT(*) AS likes FROM note_likes WHERE date = ?')
const selectNoteLike = db.prepare('SELECT date, member_id AS memberId FROM note_likes WHERE date = ? AND member_id = ?')
const upsertNote = db.prepare(`
  INSERT INTO daily_notes (date, content, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(date) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
`)
const insertNoteLike = db.prepare('INSERT INTO note_likes (date, member_id, created_at) VALUES (?, ?, ?)')
const deleteNoteLike = db.prepare('DELETE FROM note_likes WHERE date = ? AND member_id = ?')

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

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function noteView(date) {
  const note = selectNote.get(date)
  if (!note) return { date, content: '', likes: 0, updatedAt: null }
  return { ...note, likes: Number(selectNoteLikesCount.get(date)?.likes || 0) }
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
    sendJson(response, 200, {
      members: selectMembers.all(),
      actions: selectActions.all(),
      nudges: selectNudges.all(),
      notes: selectNotes.all().map((note) => ({ ...note, likes: Number(selectNoteLikesCount.get(note.date)?.likes || 0) })),
      noteLikes: selectNoteLikeRows.all(),
    })
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

  if (request.method === 'POST' && url.pathname === '/api/nudges') {
    const payload = await readBody(request)
    const valid = payload
      && typeof payload.id === 'string'
      && typeof payload.fromMemberId === 'string'
      && typeof payload.toMemberId === 'string'
      && payload.fromMemberId !== payload.toMemberId
      && /^\d{4}-\d{2}-\d{2}$/.test(payload.date)
      && typeof payload.time === 'string'
      && typeof payload.createdAt === 'number'
      && memberExists.get(payload.fromMemberId)
      && memberExists.get(payload.toMemberId)
    if (!valid) {
      sendJson(response, 400, { error: 'invalid nudge payload' })
      return
    }
    insertNudge.run(payload.id, payload.fromMemberId, payload.toMemberId, payload.date, payload.time, payload.createdAt)
    sendJson(response, 201, selectNudge.get(payload.id))
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/notes') {
    const payload = await readBody(request)
    if (!validDate(payload.date) || typeof payload.content !== 'string' || payload.content.trim().length < 1 || payload.content.trim().length > 160) {
      sendJson(response, 400, { error: 'invalid note payload' })
      return
    }
    const date = payload.date
    upsertNote.run(date, payload.content.trim(), Date.now())
    sendJson(response, 200, noteView(date))
    return
  }

  const noteLikeMatch = url.pathname.match(/^\/api\/notes\/([^/]+)\/like$/)
  if (request.method === 'POST' && noteLikeMatch) {
    const date = decodeURIComponent(noteLikeMatch[1])
    const payload = await readBody(request)
    if (!validDate(date) || !payload || typeof payload.memberId !== 'string' || !memberExists.get(payload.memberId)) {
      sendJson(response, 400, { error: 'invalid note like payload' })
      return
    }
    if (!selectNote.get(date)) upsertNote.run(date, '', Date.now())
    const existingLike = selectNoteLike.get(date, payload.memberId)
    if (existingLike) deleteNoteLike.run(date, payload.memberId)
    else insertNoteLike.run(date, payload.memberId, Date.now())
    sendJson(response, 200, { note: noteView(date), liked: !existingLike })
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
