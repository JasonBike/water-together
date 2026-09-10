import { createServer } from 'node:http'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { createReadStream } from 'node:fs'
import { join, normalize, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const rootDir = dirname(fileURLToPath(import.meta.url))
const dataDir = join(rootDir, 'data')
const databasePath = process.env.WATER_DB_PATH || join(dataDir, 'water-together.sqlite')
const distDir = join(rootDir, 'dist')
const port = Number(process.env.PORT || 8787)
const noteModelEndpoint = 'http://127.0.0.1:8317/v1/chat/completions'
const noteModel = 'gpt-5.6-terra'
const weeklyAnalysisVersion = 1
const noteDefaults = [
  '水要慢慢喝，\n喜欢要一直在。',
  '今天也要记得，\n给自己一杯温柔。',
  '先喝一口水，\n再继续闪闪发光。',
  '和喜欢的人一起，\n把日子过得水当当。',
  '小口喝水，\n大口拥抱今天。',
  '水杯在手，\n好运常有。',
  '今天的你也很棒，\n喝水是给自己的奖励。',
]

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
    created_at INTEGER NOT NULL,
    drink_kind TEXT,
    volume INTEGER
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

  CREATE TABLE IF NOT EXISTS weekly_analyses (
    date TEXT NOT NULL,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    analysis_version INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (date, member_id)
  );
`)

for (const column of ['drink_kind TEXT', 'volume INTEGER']) {
  try {
    db.exec(`ALTER TABLE actions ADD COLUMN ${column}`)
  } catch {
    // Existing databases already have this column.
  }
}

const memberColumns = 'id, name, emoji, color, gender, cup_capacity AS cupCapacity'
const actionColumns = 'id, member_id AS memberId, type, date, time, created_at AS createdAt, drink_kind AS drinkKind, volume'
const nudgeColumns = 'id, from_member_id AS fromMemberId, to_member_id AS toMemberId, date, time, created_at AS createdAt'
const selectMembers = db.prepare(`SELECT ${memberColumns} FROM members ORDER BY created_at ASC`)
const selectActions = db.prepare(`SELECT ${actionColumns} FROM actions ORDER BY created_at ASC`)
const selectNudges = db.prepare(`SELECT ${nudgeColumns} FROM nudges ORDER BY created_at ASC`)
const selectMember = db.prepare(`SELECT ${memberColumns} FROM members WHERE id = ?`)
const selectMemberByName = db.prepare(`SELECT ${memberColumns} FROM members WHERE name = ?`)
const deleteMember = db.prepare('DELETE FROM members WHERE id = ?')
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
  INSERT INTO actions (id, member_id, type, date, time, created_at, drink_kind, volume)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
const selectNoteContextActions = db.prepare(`
  SELECT
    COALESCE(SUM(CASE WHEN type = 'fetch' THEN 1 ELSE 0 END), 0) AS preparedCups,
    COALESCE(SUM(CASE WHEN type = 'drink' THEN 1 ELSE 0 END), 0) AS drinkCount,
    COALESCE(SUM(CASE WHEN type = 'restroom' THEN 1 ELSE 0 END), 0) AS restroomCount
  FROM actions
  WHERE date = ?
`)
const selectMemberCount = db.prepare('SELECT COUNT(*) AS memberCount FROM members')
const upsertNote = db.prepare(`
  INSERT INTO daily_notes (date, content, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(date) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
`)
const insertNoteLike = db.prepare('INSERT INTO note_likes (date, member_id, created_at) VALUES (?, ?, ?)')
const deleteNoteLike = db.prepare('DELETE FROM note_likes WHERE date = ? AND member_id = ?')
const selectWeeklyAnalysis = db.prepare(`
  SELECT date, member_id AS memberId, content, source_hash AS sourceHash,
    analysis_version AS analysisVersion, updated_at AS updatedAt
  FROM weekly_analyses
  WHERE date = ? AND member_id = ?
`)
const upsertWeeklyAnalysis = db.prepare(`
  INSERT INTO weekly_analyses (date, member_id, content, source_hash, analysis_version, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(date, member_id) DO UPDATE SET
    content = excluded.content,
    source_hash = excluded.source_hash,
    analysis_version = excluded.analysis_version,
    updated_at = excluded.updated_at
`)

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
  const genders = ['female', 'male', 'secret']
  const cupCapacity = Number(payload?.cupCapacity)
  return payload
    && typeof payload.name === 'string'
    && payload.name.trim().length > 0
    && payload.name.trim().length <= 12
    && typeof payload.emoji === 'string'
    && typeof payload.color === 'string'
    && genders.includes(payload.gender)
    && Number.isInteger(cupCapacity)
    && cupCapacity >= 100
    && cupCapacity <= 2000
}

function validActionPayload(payload) {
  const validDrinkKinds = ['water', 'milkTea', 'coffee', 'beverage']
  const hasDrinkDetails = payload.drinkKind != null || payload.volume != null
  const hasValidDrinkDetails = !hasDrinkDetails
    || (validDrinkKinds.includes(payload.drinkKind) && Number.isInteger(Number(payload.volume)) && Number(payload.volume) > 0 && Number(payload.volume) <= 2000)
  return payload
    && typeof payload.id === 'string'
    && typeof payload.memberId === 'string'
    && ['fetch', 'drink', 'restroom'].includes(payload.type)
    && /^\d{4}-\d{2}-\d{2}$/.test(payload.date)
    && typeof payload.time === 'string'
    && typeof payload.createdAt === 'number'
    && hasValidDrinkDetails
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

const shanghaiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const shanghaiTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function currentDateKey() {
  const parts = Object.fromEntries(
    shanghaiDateFormatter.formatToParts(new Date()).map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

function rejectHistoricalWrite(response, date) {
  if (date === currentDateKey()) return false
  sendJson(response, 403, { error: 'only current-day data can be modified' })
  return true
}

function shiftDateKey(date, offset) {
  const [year, month, day] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + offset, 12))
  return shifted.toISOString().slice(0, 10)
}

function shanghaiClockParts(date = new Date()) {
  const parts = Object.fromEntries(
    shanghaiTimeFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  )
  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    label: `${parts.hour}:${parts.minute}`,
  }
}

function actionMinuteOfDay(action) {
  const match = /^(\d{1,2}):(\d{2})/.exec(action.time || '')
  if (match) {
    const hour = Number(match[1])
    const minute = Number(match[2])
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return hour * 60 + minute
  }
  const fallback = shanghaiClockParts(new Date(action.createdAt))
  return fallback.hour * 60 + fallback.minute
}

function emptyHealthCounts() {
  return {
    preparedCups: 0,
    preparedVolumeMl: 0,
    drinkCount: 0,
    restroomCount: 0,
    totalRecords: 0,
    drinkKinds: { water: 0, milkTea: 0, coffee: 0, beverage: 0, unknown: 0 },
  }
}

function healthCounts(actions, member) {
  const result = emptyHealthCounts()
  for (const action of actions) {
    result.totalRecords += 1
    if (action.type === 'fetch') {
      result.preparedCups += 1
      result.preparedVolumeMl += Number(action.volume) > 0 ? Number(action.volume) : Number(member.cupCapacity || 0)
      const kind = Object.hasOwn(result.drinkKinds, action.drinkKind) ? action.drinkKind : 'unknown'
      result.drinkKinds[kind] += 1
    } else if (action.type === 'drink') {
      result.drinkCount += 1
    } else if (action.type === 'restroom') {
      result.restroomCount += 1
    }
  }
  return result
}

function rounded(value, digits = 1) {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function averageHealthCounts(counts, days) {
  return {
    preparedCups: rounded(counts.preparedCups / days),
    preparedVolumeMl: Math.round(counts.preparedVolumeMl / days),
    drinkCount: rounded(counts.drinkCount / days),
    restroomCount: rounded(counts.restroomCount / days),
  }
}

function changePercent(current, previous) {
  if (!previous || previous < 1) return null
  return Math.round(((current - previous) / previous) * 100)
}

function healthChanges(current, previous) {
  return {
    preparedCups: changePercent(current.preparedCups, previous.preparedCups),
    preparedVolumeMl: changePercent(current.preparedVolumeMl, previous.preparedVolumeMl),
    drinkCount: changePercent(current.drinkCount, previous.drinkCount),
    restroomCount: changePercent(current.restroomCount, previous.restroomCount),
  }
}

function weeklyAnalysisContext(date, member) {
  const recentDates = Array.from({ length: 7 }, (_, index) => shiftDateKey(date, index - 6))
  const previousDates = Array.from({ length: 7 }, (_, index) => shiftDateKey(date, index - 13))
  const allDates = new Set([...previousDates, ...recentDates])
  const memberActions = selectActions.all().filter((action) => action.memberId === member.id && allDates.has(action.date))
  const actionsByDate = new Map([...allDates].map((day) => [day, []]))
  for (const action of memberActions) actionsByDate.get(action.date)?.push(action)

  const recentDaily = recentDates.map((day) => ({ date: day, ...healthCounts(actionsByDate.get(day), member) }))
  const previousDaily = previousDates.map((day) => ({ date: day, ...healthCounts(actionsByDate.get(day), member) }))
  const recentActions = memberActions.filter((action) => recentDates.includes(action.date))
  const previousActions = memberActions.filter((action) => previousDates.includes(action.date))
  const recentTotals = healthCounts(recentActions, member)
  const previousTotals = healthCounts(previousActions, member)
  const recentCompletedTotals = healthCounts(recentActions.filter((action) => action.date !== date), member)
  const currentClock = shanghaiClockParts()
  const cutoffMinute = date === currentDateKey() ? currentClock.hour * 60 + currentClock.minute : 23 * 60 + 59
  const priorSixDays = recentDates.slice(0, 6)
  const priorSixSameTimeTotals = healthCounts(
    memberActions.filter((action) => priorSixDays.includes(action.date) && actionMinuteOfDay(action) <= cutoffMinute),
    member,
  )
  const today = recentDaily[recentDaily.length - 1]
  const todaySameTimeAverage = averageHealthCounts(priorSixSameTimeTotals, 6)

  const timeBandDefinitions = [
    ['凌晨 00:00-05:59', 0, 359],
    ['上午 06:00-11:59', 360, 719],
    ['下午 12:00-17:59', 720, 1079],
    ['晚上 18:00-23:59', 1080, 1439],
  ]
  const timeBands = timeBandDefinitions.map(([label, start, end]) => ({
    label,
    ...healthCounts(recentActions.filter((action) => {
      const minute = actionMinuteOfDay(action)
      return minute >= start && minute <= end
    }), member),
  }))

  const recentDailyAverage = averageHealthCounts(recentTotals, 7)
  const previousDailyAverage = averageHealthCounts(previousTotals, 7)
  const completedRecentDailyAverage = averageHealthCounts(recentCompletedTotals, 6)
  const sourcePayload = {
    version: weeklyAnalysisVersion,
    date,
    cutoffHour: date === currentDateKey() ? currentClock.hour : 23,
    member: { id: member.id, gender: member.gender, cupCapacity: member.cupCapacity },
    actions: memberActions
      .map(({ id, type, date: actionDate, time, drinkKind, volume }) => ({ id, type, date: actionDate, time, drinkKind, volume }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  }

  return {
    sourceHash: createHash('sha256').update(JSON.stringify(sourcePayload)).digest('hex'),
    modelContext: {
      analysisDate: date,
      generatedAtShanghai: `${currentDateKey()} ${currentClock.label}`,
      profile: {
        gender: member.gender,
        defaultCupCapacityMl: member.cupCapacity,
        missingMedicalInformation: ['年龄', '体重', '基础疾病', '用药', '运动量', '天气与出汗情况', '是否喝完准备的饮品', '排尿或排便类型', '尿色和伴随症状'],
      },
      recordingSemantics: {
        preparedCups: '准备的饮品杯数，不等于实际喝完杯数',
        preparedVolumeMl: '按每次准备记录估算的容量，不等于实际摄入量',
        drinkCount: '点击喝水的次数，没有单次容量',
        restroomCount: '自报上厕所次数，未区分排尿和排便，可能漏记',
        zero: '0 可能表示没有发生，也可能表示没有记录',
      },
      recentWindow: {
        startDate: recentDates[0],
        endDate: date,
        todayIsPartial: date === currentDateKey(),
        daily: recentDaily,
        totals: recentTotals,
        dailyAverage: recentDailyAverage,
        completedSixDayAverage: completedRecentDailyAverage,
        recordedDays: recentDaily.filter((day) => day.totalRecords > 0).length,
      },
      previousWindow: {
        startDate: previousDates[0],
        endDate: previousDates[previousDates.length - 1],
        daily: previousDaily,
        totals: previousTotals,
        dailyAverage: previousDailyAverage,
      },
      recentVsPreviousPercent: healthChanges(recentDailyAverage, previousDailyAverage),
      todayComparison: {
        cutoffTime: currentClock.label,
        today,
        priorSixDaysSameTimeAverage: todaySameTimeAverage,
        todayVsPriorSameTimePercent: healthChanges(today, todaySameTimeAverage),
      },
      recentSevenDayTimeBands: timeBands,
      dataQuality: {
        recentRecordedDays: recentDaily.filter((day) => day.totalRecords > 0).length,
        previousRecordedDays: previousDaily.filter((day) => day.totalRecords > 0).length,
        legacyPreparedRecordsUsingDefaultCapacity: memberActions.filter((action) => action.type === 'fetch' && !(Number(action.volume) > 0)).length,
      },
    },
  }
}

function fallbackWeeklyAnalysis(context) {
  const today = context.todayComparison.today
  const baseline = context.todayComparison.priorSixDaysSameTimeAverage
  const enoughData = context.dataQuality.recentRecordedDays >= 3 && context.recentWindow.totals.totalRecords >= 6
  const restroomDifference = today.restroomCount - baseline.restroomCount
  const preparedDifference = today.preparedCups - baseline.preparedCups
  const drinkDifference = today.drinkCount - baseline.drinkCount
  const notableRestroomChange = Math.abs(restroomDifference) >= 3 && baseline.restroomCount > 0
  const notableHydrationChange = Math.abs(preparedDifference) >= 3 || Math.abs(drinkDifference) >= 4
  const riskLevel = !enoughData ? '数据不足' : notableRestroomChange || notableHydrationChange ? '需关注' : '低风险'
  const confidence = enoughData ? '中' : '低'
  const recentAverage = context.recentWindow.dailyAverage
  const previousAverage = context.previousWindow.dailyAverage
  const trendChange = context.recentVsPreviousPercent
  const anomalies = []
  if (notableHydrationChange) anomalies.push(`截至 ${context.todayComparison.cutoffTime}，杯数或喝水次数与前 6 天同一时刻均值差异较大。`)
  if (notableRestroomChange) anomalies.push(`截至 ${context.todayComparison.cutoffTime}，上厕所次数较前 6 天同一时刻均值相差 ${Math.abs(rounded(restroomDifference))} 次。`)
  if (!anomalies.length) anomalies.push(enoughData ? '没有发现达到提示阈值的明显异动。' : '有效记录天数不足，暂时无法可靠识别异动。')

  return {
    headline: riskLevel === '低风险' ? '今天的记录与近期节奏大体相近' : riskLevel === '数据不足' ? '记录还不够，暂时无法可靠判断' : '今天有指标偏离近期节奏',
    riskLevel,
    confidence,
    todayAssessment: `截至 ${context.todayComparison.cutoffTime}，记录杯数 ${today.preparedCups} 杯、估算准备量 ${today.preparedVolumeMl} ml、喝水 ${today.drinkCount} 次、上厕所 ${today.restroomCount} 次。前 6 天同一时刻均值分别为 ${baseline.preparedCups} 杯、${baseline.preparedVolumeMl} ml、${baseline.drinkCount} 次和 ${baseline.restroomCount} 次。`,
    trendAssessment: `最近 7 天有 ${context.recentWindow.recordedDays} 天留下记录，日均杯数 ${recentAverage.preparedCups} 杯、估算准备量 ${recentAverage.preparedVolumeMl} ml、喝水 ${recentAverage.drinkCount} 次、上厕所 ${recentAverage.restroomCount} 次；前 7 天日均分别为 ${previousAverage.preparedCups} 杯、${previousAverage.preparedVolumeMl} ml、${previousAverage.drinkCount} 次和 ${previousAverage.restroomCount} 次，变化比例依次为 ${trendChange.preparedCups ?? '无法计算'}%、${trendChange.preparedVolumeMl ?? '无法计算'}%、${trendChange.drinkCount ?? '无法计算'}% 和 ${trendChange.restroomCount ?? '无法计算'}%。仍需结合漏记情况理解。`,
    anomalies,
    healthPossibilities: riskLevel === '需关注'
      ? ['补水行为或上厕所频率发生变化，可能与饮水、咖啡因、活动量、天气、用药或泌尿系统状态有关，需要结合症状继续观察。']
      : ['现有记录未显示明确健康风险，但准备量不等于实际摄入量，不能据此排除脱水、饮水过量或排尿异常。'],
    actions: ['继续完整记录实际喝完的容量和上厕所类型。', '若异动持续 2–3 天，记录尿色、口渴、头晕、水肿、疼痛和用药情况，并咨询医生。'],
    missingInformation: context.profile.missingMedicalInformation,
    warningSigns: ['若出现明显少尿或无尿、血尿、排尿疼痛、持续呕吐、意识异常、呼吸困难或快速加重的水肿，应及时就医。'],
    dataBoundary: '这是基于自报打卡的医学导向风险评估，不是诊断；“低风险”只表示没有发现相对个人近期记录的明显异动。',
  }
}

function cleanAnalysisText(value, fallback, maxLength = 320) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback
}

function cleanAnalysisList(value, fallback, maxItems = 5) {
  if (!Array.isArray(value)) return fallback
  const cleaned = value.filter((item) => typeof item === 'string' && item.trim()).slice(0, maxItems).map((item) => item.trim().slice(0, 220))
  return cleaned.length ? cleaned : fallback
}

function normalizeWeeklyAnalysis(value, fallback) {
  const riskLevels = ['低风险', '需关注', '明显异动', '数据不足']
  const confidenceLevels = ['低', '中', '高']
  return {
    headline: cleanAnalysisText(value?.headline, fallback.headline, 80),
    riskLevel: riskLevels.includes(value?.riskLevel) ? value.riskLevel : fallback.riskLevel,
    confidence: confidenceLevels.includes(value?.confidence) ? value.confidence : fallback.confidence,
    todayAssessment: cleanAnalysisText(value?.todayAssessment, fallback.todayAssessment),
    trendAssessment: cleanAnalysisText(value?.trendAssessment, fallback.trendAssessment),
    anomalies: cleanAnalysisList(value?.anomalies, fallback.anomalies),
    healthPossibilities: cleanAnalysisList(value?.healthPossibilities, fallback.healthPossibilities),
    actions: cleanAnalysisList(value?.actions, fallback.actions),
    missingInformation: cleanAnalysisList(value?.missingInformation, fallback.missingInformation, 9),
    warningSigns: cleanAnalysisList(value?.warningSigns, fallback.warningSigns),
    dataBoundary: cleanAnalysisText(value?.dataBoundary, fallback.dataBoundary),
  }
}

function parseAnalysisJson(content) {
  if (typeof content !== 'string') return null
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(content.slice(start, end + 1))
  } catch {
    return null
  }
}

async function generateWeeklyAnalysis(context) {
  const fallback = fallbackWeeklyAnalysis(context)
  const requestId = randomUUID()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(noteModelEndpoint, {
      method: 'POST',
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: noteModel,
        temperature: 0.2,
        max_tokens: 1_000,
        messages: [
          {
            role: 'system',
            content: `你是严谨的个人饮水与排泄健康风险分析助手。基于用户最近 7 天、前 7 天和今日同一时刻对照数据，做医学导向的风险判断。必须引用输入中的具体数字或日期，先考虑漏记和今天尚未结束，不得把准备容量当成实际摄入量，不得把上厕所次数直接当成排尿次数。可以提出脱水、饮水过多、咖啡因影响或排尿异常等医学可能性，但不能写成确诊。riskLevel 只能是“低风险”“需关注”“明显异动”“数据不足”，其中“低风险”仅指相对个人近期记录未见明显异动；如果没有明确异动，anomalies 必须写“未发现明显问题”。当对照基线低于 1 次/天时，不要输出夸张的百分比，改用绝对次数和“基线过低”。只输出 JSON，不要 Markdown。JSON 字段必须是 headline、riskLevel、confidence、todayAssessment、trendAssessment、anomalies、healthPossibilities、actions、missingInformation、warningSigns、dataBoundary；confidence 只能是“低”“中”“高”，后六项均为中文字符串数组。`,
          },
          { role: 'user', content: `这是第 ${requestId} 次独立分析请求，请不要复用任何旧结论，重新根据以下匿名个人记录完整判断：${JSON.stringify(context)}` },
        ],
      }),
    })
    if (!response.ok) throw new Error(`weekly analysis model ${response.status}`)
    const payload = await response.json()
    const parsed = parseAnalysisJson(payload?.choices?.[0]?.message?.content)
    if (!parsed) throw new Error('weekly analysis model returned invalid JSON')
    return { analysis: normalizeWeeklyAnalysis(parsed, fallback), source: 'model' }
  } catch (error) {
    console.warn('weekly analysis generation fell back to local analysis:', error.message)
    return { analysis: fallback, source: 'fallback' }
  } finally {
    clearTimeout(timeout)
  }
}

function weeklyAnalysisView(row, stale = false) {
  if (!row) return null
  try {
    const stored = JSON.parse(row.content)
    const source = stored?._meta?.source || 'unknown'
    const { _meta, ...analysis } = stored
    return {
      date: row.date,
      memberId: row.memberId,
      analysis,
      generatedBy: source,
      analysisVersion: row.analysisVersion,
      updatedAt: row.updatedAt,
      stale,
    }
  } catch {
    return null
  }
}

function noteView(date) {
  const note = selectNote.get(date)
  if (!note) return { date, content: '', likes: 0, updatedAt: null }
  return { ...note, likes: Number(selectNoteLikesCount.get(date)?.likes || 0) }
}

function defaultNoteForDate(date) {
  const dayNumber = Number(date.replaceAll('-', ''))
  return noteDefaults[Math.abs(dayNumber) % noteDefaults.length]
}

function noteContextForDate(date) {
  const counts = selectNoteContextActions.get(date)
  const preparedCups = Number(counts?.preparedCups || 0)
  return {
    preparedCups,
    drinkCount: Number(counts?.drinkCount || 0),
    restroomCount: Number(counts?.restroomCount || 0),
    memberCount: Number(selectMemberCount.get()?.memberCount || 0),
    progress: Math.min(100, Math.round((preparedCups / 10) * 100)),
  }
}

async function generateNoteContent(date, context = noteContextForDate(date)) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  const contextMessage = `当天是 ${context.memberCount} 人的小水站，共准备 ${context.preparedCups} 杯，喝水 ${context.drinkCount} 次，上厕所 ${context.restroomCount} 次，共同进度 ${context.progress}%。`
  try {
    const response = await fetch(noteModelEndpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: noteModel,
        temperature: 0.9,
        max_tokens: 80,
        messages: [
          { role: 'system', content: '你是情侣饮水小站的每日小纸条助手。根据当天统计写一句简短、可爱、温柔的中文话术，不超过30个汉字。只挑一个最值得回应的状态，不要机械罗列数字，不要编造事实，不要引号，不要解释。' },
          { role: 'user', content: `日期：${date}。${contextMessage}请写一句贴合今天状态、提醒喝水和好好生活的小纸条。` },
        ],
      }),
    })
    if (!response.ok) throw new Error(`note model ${response.status}`)
    const payload = await response.json()
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content === 'string' && content.trim()) return content.trim().slice(0, 160)
  } catch (error) {
    console.warn('daily note generation fell back to default:', error.message)
  } finally {
    clearTimeout(timeout)
  }
  return defaultNoteForDate(date)
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

  const memberMatch = url.pathname.match(/^\/api\/members\/([^/]+)$/)
  if (request.method === 'DELETE' && memberMatch) {
    deleteMember.run(decodeURIComponent(memberMatch[1]))
    sendEmpty(response)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/actions') {
    const payload = await readBody(request)
    if (!validActionPayload(payload) || !memberExists.get(payload.memberId)) {
      sendJson(response, 400, { error: 'invalid action payload' })
      return
    }
    if (rejectHistoricalWrite(response, payload.date)) return
    insertAction.run(payload.id, payload.memberId, payload.type, payload.date, payload.time, payload.createdAt, payload.drinkKind || null, payload.volume ? Number(payload.volume) : null)
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
    if (rejectHistoricalWrite(response, payload.date)) return
    insertNudge.run(payload.id, payload.fromMemberId, payload.toMemberId, payload.date, payload.time, payload.createdAt)
    sendJson(response, 201, selectNudge.get(payload.id))
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/weekly-analysis') {
    const date = url.searchParams.get('date')
    const memberId = url.searchParams.get('memberId')
    if (!validDate(date) || !memberId) {
      sendJson(response, 400, { error: 'date and memberId are required' })
      return
    }
    const member = selectMember.get(memberId)
    if (!member) {
      sendJson(response, 404, { error: 'member not found' })
      return
    }
    const stored = selectWeeklyAnalysis.get(date, memberId)
    if (!stored) {
      sendJson(response, 200, null)
      return
    }
    const currentContext = weeklyAnalysisContext(date, member)
    const stale = stored.sourceHash !== currentContext.sourceHash || stored.analysisVersion !== weeklyAnalysisVersion
    sendJson(response, 200, weeklyAnalysisView(stored, stale))
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/weekly-analysis/generate') {
    const payload = await readBody(request)
    if (!validDate(payload.date) || typeof payload.memberId !== 'string') {
      sendJson(response, 400, { error: 'invalid weekly analysis payload' })
      return
    }
    if (rejectHistoricalWrite(response, payload.date)) return
    const member = selectMember.get(payload.memberId)
    if (!member) {
      sendJson(response, 404, { error: 'member not found' })
      return
    }
    const context = weeklyAnalysisContext(payload.date, member)
    const generated = await generateWeeklyAnalysis(context.modelContext)
    if (rejectHistoricalWrite(response, payload.date)) return
    const updatedAt = Date.now()
    upsertWeeklyAnalysis.run(
      payload.date,
      payload.memberId,
      JSON.stringify({ ...generated.analysis, _meta: { source: generated.source, model: noteModel } }),
      context.sourceHash,
      weeklyAnalysisVersion,
      updatedAt,
    )
    const saved = selectWeeklyAnalysis.get(payload.date, payload.memberId)
    const latestContext = weeklyAnalysisContext(payload.date, member)
    sendJson(response, 200, weeklyAnalysisView(saved, latestContext.sourceHash !== context.sourceHash))
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/notes') {
    const payload = await readBody(request)
    if (!validDate(payload.date) || typeof payload.content !== 'string' || payload.content.trim().length < 1 || payload.content.trim().length > 160) {
      sendJson(response, 400, { error: 'invalid note payload' })
      return
    }
    const date = payload.date
    if (rejectHistoricalWrite(response, date)) return
    upsertNote.run(date, payload.content.trim(), Date.now())
    sendJson(response, 200, noteView(date))
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/notes/generate') {
    const payload = await readBody(request)
    if (!validDate(payload.date)) {
      sendJson(response, 400, { error: 'invalid note date' })
      return
    }
    if (rejectHistoricalWrite(response, payload.date)) return
    const content = await generateNoteContent(payload.date)
    if (rejectHistoricalWrite(response, payload.date)) return
    upsertNote.run(payload.date, content, Date.now())
    sendJson(response, 200, noteView(payload.date))
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
    if (rejectHistoricalWrite(response, date)) return
    if (!selectNote.get(date)) upsertNote.run(date, '', Date.now())
    const existingLike = selectNoteLike.get(date, payload.memberId)
    if (existingLike) deleteNoteLike.run(date, payload.memberId)
    else insertNoteLike.run(date, payload.memberId, Date.now())
    sendJson(response, 200, { note: noteView(date), liked: !existingLike })
    return
  }

  const actionMatch = url.pathname.match(/^\/api\/actions\/([^/]+)$/)
  if (request.method === 'DELETE' && actionMatch) {
    const actionId = decodeURIComponent(actionMatch[1])
    const action = selectAction.get(actionId)
    if (action && rejectHistoricalWrite(response, action.date)) return
    deleteAction.run(actionId)
    sendEmpty(response)
    return
  }

  if (request.method === 'DELETE' && url.pathname === '/api/actions') {
    const memberId = url.searchParams.get('memberId')
    const date = url.searchParams.get('date')
    if (!memberId || !validDate(date)) {
      sendJson(response, 400, { error: 'memberId and date are required' })
      return
    }
    if (rejectHistoricalWrite(response, date)) return
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
