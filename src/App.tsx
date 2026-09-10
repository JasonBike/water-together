import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

type ActionType = 'fetch' | 'drink' | 'restroom'
type DrinkKind = 'water' | 'milkTea' | 'coffee' | 'beverage'
type Gender = 'female' | 'male' | 'secret'
type CupCapacity = number

type Member = {
  id: string
  name: string
  emoji: string
  color: string
  gender: Gender
  cupCapacity: CupCapacity
}

type LoginProfile = {
  nickname: string
  gender: Gender
  cupCapacity: CupCapacity
  emoji: string
}

type WaterAction = {
  id: string
  memberId: string
  type: ActionType
  date: string
  time: string
  createdAt: number
  drinkKind?: DrinkKind
  volume?: number
}

type Nudge = {
  id: string
  fromMemberId: string
  toMemberId: string
  date: string
  time: string
  createdAt: number
}

type DailyNote = {
  date: string
  content: string
  likes: number
  updatedAt: number | null
}

type NoteLike = {
  date: string
  memberId: string
}

type WeeklyAnalysisContent = {
  headline: string
  riskLevel: '低风险' | '需关注' | '明显异动' | '数据不足'
  confidence: '低' | '中' | '高'
  todayAssessment: string
  trendAssessment: string
  anomalies: string[]
  healthPossibilities: string[]
  actions: string[]
  missingInformation: string[]
  warningSigns: string[]
  dataBoundary: string
}

type WeeklyAnalysisReport = {
  date: string
  memberId: string
  analysis: WeeklyAnalysisContent
  generatedBy?: 'model' | 'fallback' | 'unknown'
  analysisVersion: number
  updatedAt: number
  stale: boolean
}

type AppData = {
  currentUser: string | null
  members: Member[]
  actions: WaterAction[]
  nudges: Nudge[]
  notes: DailyNote[]
  noteLikes: NoteLike[]
}

const SESSION_KEY = 'gulu-diary-session-v1'
const EMOJIS = ['🐰', '🐻', '🐱', '🐶', '🦊', '🐼', '🐹', '🐣', '🐧']
const COLORS = ['#f8c8cc', '#b9dff0', '#f7d59b', '#cfdcb4', '#d9c9ef', '#f4bd9f']
const CUP_OPTIONS: Array<{ value: CupCapacity; label: string; note: string }> = [
  { value: 250, label: '小杯', note: '250 ml' },
  { value: 350, label: '刚刚好', note: '350 ml' },
  { value: 500, label: '大杯', note: '500 ml' },
  { value: 750, label: '超大杯', note: '750 ml' },
]
const DRINK_OPTIONS: Array<{ value: DrinkKind; label: string; emoji: string; capacities: number[] }> = [
  { value: 'water', label: '水', emoji: '💧', capacities: [250, 350, 500, 750] },
  { value: 'milkTea', label: '奶茶', emoji: '🧋', capacities: [350, 500, 700] },
  { value: 'coffee', label: '咖啡', emoji: '☕', capacities: [240, 350, 500] },
  { value: 'beverage', label: '饮料', emoji: '🥤', capacities: [330, 500, 600] },
]
const GENDER_OPTIONS: Array<{ value: Gender; label: string; emoji: string }> = [
  { value: 'female', label: '女生', emoji: '♀' },
  { value: 'male', label: '男生', emoji: '♂' },
  { value: 'secret', label: '保密', emoji: '♡' },
]
const DEFAULT_NOTE = '水要慢慢喝，\n喜欢要一直在。'

const emptyData: AppData = {
  currentUser: null,
  members: [],
  actions: [],
  nudges: [],
  notes: [],
  noteLikes: [],
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  if (!response.ok) {
    throw new Error(`API ${response.status}`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateFromKey(key: string) {
  return new Date(`${key}T12:00:00`)
}

function shiftDate(key: string, offset: number) {
  const date = dateFromKey(key)
  date.setDate(date.getDate() + offset)
  return localDateKey(date)
}

function formatDate(key: string) {
  const date = dateFromKey(key)
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date)
}

function formatMonthDay(key: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(dateFromKey(key))
}

function formatWeekday(key: string) {
  return new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(dateFromKey(key))
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function countOf(actions: WaterAction[], memberId: string, type: ActionType) {
  return actions.filter((item) => item.memberId === memberId && item.type === type).length
}

function daysWithRecords(actions: WaterAction[], memberId: string, fromDate: string, days: number) {
  return Array.from({ length: days }, (_, index) => shiftDate(fromDate, -index))
    .filter((date) => actions.some((item) => item.memberId === memberId && item.date === date)).length
}

function cupLevel(fetchTotal: number) {
  if (fetchTotal >= 50) return { level: 4, name: '水之守护者', emoji: '🌈', progress: 100 }
  if (fetchTotal >= 25) return { level: 3, name: '闪闪水手', emoji: '⭐', progress: ((fetchTotal - 25) / 25) * 100 }
  if (fetchTotal >= 10) return { level: 2, name: '小小水手', emoji: '🌱', progress: ((fetchTotal - 10) / 15) * 100 }
  return { level: 1, name: '新手水滴', emoji: '💧', progress: (fetchTotal / 10) * 100 }
}


function greeting() {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深啦'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 19) return '下午好'
  return '晚上好'
}

function hydrationMood(fetchCount: number) {
  if (fetchCount <= 0) return { emoji: '🫧', message: '小水滴在等你' }
  if (fetchCount < 4) return { emoji: '🌱', message: '好习惯发芽啦' }
  if (fetchCount < 8) return { emoji: '🐳', message: '水杯快装满啦' }
  return { emoji: '🌈', message: '今日补水满格' }
}

function noteMilestoneKey(preparedCups: number, drinkCount: number) {
  if (preparedCups >= 10) return 'together-100'
  if (preparedCups >= 8) return 'prepared-8'
  if (preparedCups >= 5) return 'together-50'
  if (preparedCups >= 4) return 'prepared-4'
  if (preparedCups >= 1) return 'prepared-1'
  if (drinkCount >= 1) return 'drink-1'
  return 'start'
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`} aria-label="咕噜日记">
      <span className="brand__mark" aria-hidden="true">
        <svg viewBox="0 0 54 54" role="img">
          <path d="M27 5C21 13 13 21 13 32a14 14 0 0 0 28 0C41 21 33 13 27 5Z" fill="currentColor" />
          <path d="M19 31c2.4-1.8 4.7-1.2 6.1 1 1.5-2.2 3.8-2.8 6.2-1 3.7 2.8.2 7-6.2 10.3C18.8 38 15.3 33.8 19 31Z" fill="#fffaf3" />
          <circle cx="36.5" cy="15.5" r="4.5" fill="#fffaf3" opacity=".8" />
        </svg>
      </span>
      <span className="brand__text">
        <strong>咕噜日记</strong>
        {!compact && <small>WATER TOGETHER</small>}
      </span>
    </div>
  )
}

function ArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={direction === 'left' ? 'm14.5 6-6 6 6 6' : 'm9.5 6 6 6-6 6'} />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function WaterRhythmChart({ actions, date }: { actions: WaterAction[]; date: string }) {
  const chartRef = useRef<HTMLDivElement>(null)
  const chartHours = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'))
  const fetchByHour = Array.from({ length: 24 }, () => 0)
  const drinkByHour = Array.from({ length: 24 }, () => 0)
  const restroomByHour = Array.from({ length: 24 }, () => 0)

  actions.forEach((action) => {
    const hour = Number(action.time.match(/^\d{1,2}/)?.[0] ?? new Date(action.createdAt).getHours())
    if (hour < 0 || hour > 23) return
    if (action.type === 'fetch') fetchByHour[hour] += 1
    else if (action.type === 'drink') drinkByHour[hour] += 1
    else restroomByHour[hour] += 1
  })

  const fetchPeak = Math.max(...fetchByHour)
  const drinkPeak = Math.max(...drinkByHour)
  const restroomPeak = Math.max(...restroomByHour)
  const peakValue = Math.max(fetchPeak, drinkPeak, restroomPeak)
  const peakHour = peakValue > 0
    ? [
      { value: fetchPeak, hour: fetchByHour.indexOf(fetchPeak) },
      { value: drinkPeak, hour: drinkByHour.indexOf(drinkPeak) },
      { value: restroomPeak, hour: restroomByHour.indexOf(restroomPeak) },
    ].filter((item) => item.value === peakValue).map((item) => item.hour).sort((a, b) => a - b)[0] ?? -1
    : -1

  useEffect(() => {
    if (!chartRef.current) return
    const chart = echarts.init(chartRef.current)
    chart.setOption({
      animationDuration: 500,
      animationEasing: 'cubicOut',
      grid: { top: 50, right: 22, bottom: 32, left: 38, containLabel: true },
      legend: {
        top: 0,
        right: 3,
        selectedMode: 'multiple',
        itemWidth: 12,
        itemHeight: 12,
        itemGap: 18,
        icon: 'circle',
        inactiveColor: '#bdc6c5',
        textStyle: { color: '#536970', fontSize: 14, fontWeight: 600 },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(255, 254, 250, .97)',
        borderColor: '#e6e2da',
        borderWidth: 1,
        textStyle: { color: '#5d6b70', fontSize: 12 },
        axisPointer: { type: 'line', lineStyle: { color: '#cbdfe2', type: 'dashed' } },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: chartHours,
        axisLine: { lineStyle: { color: '#e6eceb' } },
        axisTick: { show: false },
        axisLabel: { color: '#6f8085', fontSize: 11, interval: 2, formatter: (value: string) => `${value}点` },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        min: 0,
        splitLine: { lineStyle: { color: '#edf0ed', type: 'dashed' } },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#75868a', fontSize: 11 },
      },
      series: [
        {
          name: '杯数',
          type: 'line',
          smooth: true,
          showSymbol: true,
          symbol: 'circle',
          symbolSize: 7,
          data: fetchByHour,
          lineStyle: { width: 3, color: '#78bfd7' },
          itemStyle: { color: '#78bfd7', borderColor: '#fffefa', borderWidth: 2 },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(120, 191, 215, .25)' }, { offset: 1, color: 'rgba(120, 191, 215, .02)' }]) },
        },
        {
          name: '喝水次数',
          type: 'line',
          smooth: true,
          showSymbol: true,
          symbol: 'circle',
          symbolSize: 7,
          data: drinkByHour,
          lineStyle: { width: 3, color: '#e1a0a4' },
          itemStyle: { color: '#e1a0a4', borderColor: '#fffefa', borderWidth: 2 },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(225, 160, 164, .18)' }, { offset: 1, color: 'rgba(225, 160, 164, .02)' }]) },
        },
        {
          name: '上厕所次数',
          type: 'line',
          smooth: true,
          showSymbol: true,
          symbol: 'circle',
          symbolSize: 7,
          data: restroomByHour,
          lineStyle: { width: 3, color: '#aa97cf' },
          itemStyle: { color: '#aa97cf', borderColor: '#fffefa', borderWidth: 2 },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(170, 151, 207, .17)' }, { offset: 1, color: 'rgba(170, 151, 207, .02)' }]) },
        },
      ],
    })
    const resize = () => chart.resize()
    window.addEventListener('resize', resize)
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    resizeObserver?.observe(chartRef.current)
    return () => {
      window.removeEventListener('resize', resize)
      resizeObserver?.disconnect()
      chart.dispose()
    }
  }, [actions])

  return (
    <section className="chart-card">
      <div className="card-heading card-heading--inline">
        <div>
          <span className="card-kicker"><span>⌁</span> DAILY RHYTHM</span>
          <h2>{date === localDateKey() ? '今天的水站节奏' : `${formatMonthDay(date)} 的水站节奏`}</h2>
        </div>
      </div>
      <div className="chart-canvas" ref={chartRef} role="img" aria-label={`${date === localDateKey() ? '当天' : formatMonthDay(date)}杯数、喝水次数和上厕所次数的小时折线图`} />
      <div className="chart-footer">
        {peakHour >= 0 ? <span>{date === localDateKey() ? '今天' : '当天'}最活跃的时段：<strong>{String(peakHour).padStart(2, '0')}:00 左右</strong></span> : <span>记录后会显示你的饮水高峰时段</span>}
        <span>杯数 {fetchByHour.reduce((sum, count) => sum + count, 0)} 杯 · 喝水次数 {drinkByHour.reduce((sum, count) => sum + count, 0)} 次 · 上厕所次数 {restroomByHour.reduce((sum, count) => sum + count, 0)} 次</span>
      </div>
    </section>
  )
}

type DatePickerProps = {
  value: string
  maxDate: string
  onChange: (date: string) => void
}

function DatePicker({ value, maxDate, onChange }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const [viewDate, setViewDate] = useState(() => dateFromKey(value))
  const pickerRef = useRef<HTMLDivElement>(null)
  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstDay = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cellCount = Math.ceil((firstDay + daysInMonth) / 7) * 7
  const monthLabel = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(viewDate)
  const isCurrentMonth = year === dateFromKey(maxDate).getFullYear() && month === dateFromKey(maxDate).getMonth()

  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  function toggle() {
    if (!open) setViewDate(dateFromKey(value))
    setOpen((current) => !current)
  }

  function moveMonth(offset: number) {
    const next = new Date(year, month + offset, 1, 12)
    setViewDate(next)
  }

  return (
    <div className="date-switcher__center" ref={pickerRef}>
      <button
        type="button"
        className="date-switcher__trigger"
        onClick={toggle}
        aria-label="选择日期"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <strong>{value === maxDate ? '今天' : formatDate(value).split('周')[0]}</strong>
        <span>{formatDate(value)}</span>
        <em aria-hidden="true">▦</em>
      </button>
      {open && (
        <div className="date-popover" role="dialog" aria-label="日期选择器">
          <div className="date-popover__header">
            <button type="button" onClick={() => moveMonth(-1)} aria-label="上个月">‹</button>
            <strong>{monthLabel}</strong>
            <button type="button" onClick={() => moveMonth(1)} disabled={isCurrentMonth} aria-label="下个月">›</button>
          </div>
          <div className="date-popover__weekdays" aria-hidden="true">
            {['一', '二', '三', '四', '五', '六', '日'].map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div className="date-popover__grid">
            {Array.from({ length: cellCount }, (_, index) => {
              const day = index - firstDay + 1
              if (day < 1 || day > daysInMonth) return <span className="date-popover__blank" key={`blank-${index}`} />
              const date = localDateKey(new Date(year, month, day, 12))
              const isFuture = date > maxDate
              const isSelected = date === value
              const isToday = date === maxDate
              return (
                <button
                  type="button"
                  key={date}
                  className={`${isSelected ? 'is-selected' : ''} ${isToday ? 'is-today' : ''}`}
                  disabled={isFuture}
                  onClick={() => onChange(date)}
                  aria-label={date}
                  aria-pressed={isSelected}
                >
                  {day}
                </button>
              )
            })}
          </div>
          <div className="date-popover__footer">
            <button type="button" onClick={() => onChange(maxDate)}>回到今天</button>
          </div>
        </div>
      )}
    </div>
  )
}

function LoginScreen({ onLogin, onDeleteAccount, serverError = '', members = [] }: { onLogin: (profile: LoginProfile) => void; onDeleteAccount: (member: Member) => Promise<void>; serverError?: string; members?: Member[] }) {
  const [isRegistering, setIsRegistering] = useState(members.length === 0)
  const [nickname, setNickname] = useState('')
  const [gender, setGender] = useState<Gender>('secret')
  const [cupCapacity, setCupCapacity] = useState<CupCapacity>(350)
  const [emoji, setEmoji] = useState(EMOJIS[0])
  const [error, setError] = useState('')
  const [accountToDelete, setAccountToDelete] = useState<Member | null>(null)

  function selectAccount(member: Member) {
    onLogin({
      nickname: member.name,
      gender: member.gender,
      cupCapacity: member.cupCapacity,
      emoji: member.emoji,
    })
  }

  function startRegister() {
    setIsRegistering(true)
    setNickname('')
    setGender('secret')
    setCupCapacity(350)
    setEmoji(EMOJIS[0])
    setError('')
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const name = nickname.trim()
    if (!name) {
      setError('先告诉我怎么称呼你吧')
      return
    }
    if (name.length > 12) {
      setError('昵称短一点会更可爱哦（最多 12 个字）')
      return
    }
    if (members.some((member) => member.name === name)) {
      setError('这个昵称已经注册啦，直接点击上面的账号卡片登录吧')
      return
    }
    onLogin({ nickname: name, gender, cupCapacity, emoji })
  }

  return (
    <main className="login-page">
      <div className="login-doodle login-doodle--one">✦</div>
      <div className="login-doodle login-doodle--two">♡</div>
      <section className="login-card">
        <div className="login-visual">
          <div className="login-visual__copy">
            <span className="eyebrow">OUR TINY RITUAL</span>
            <h1>小口喝水，<br />大口喜欢你。</h1>
            <p>和重要的人一起，把平凡的每一杯水<br />变成值得收藏的小事。</p>
          </div>
          <div className="cup-scene" aria-hidden="true">
            <span className="steam steam--one">♡</span>
            <span className="steam steam--two">~</span>
            <div className="cup cup--blue">
              <span className="cup__face">•ᴗ•</span>
            </div>
            <div className="cup cup--pink">
              <span className="cup__face">•ﻌ•</span>
            </div>
            <div className="puddle" />
            <span className="scene-flower">✿</span>
            <span className="scene-heart">♥</span>
          </div>
          <div className="visual-note">
            <span>“</span> 今天也要互相提醒喝水呀 <span>”</span>
          </div>
        </div>

        <div className="login-form-wrap">
          <Logo />
          <div className="login-form-copy">
            <h2>欢迎来到我们的小水站</h2>
            <p>不需要密码，留下昵称，选好你的专属小设置就可以开始。</p>
          </div>
          <form className="login-form" onSubmit={submit}>
            {!isRegistering && members.length > 0 && (
              <div className="account-picker">
                <div className="account-picker__heading">
                  <label>选择已有账号</label>
                </div>
                <div className="account-picker__list">
                  {members.map((member) => (
                    <button
                      type="button"
                      key={member.id}
                      onClick={() => selectAccount(member)}
                    >
                      <span style={{ background: member.color }}>{member.emoji}</span>
                      <strong>{member.name}</strong>
                      <span className="account-delete-button" role="button" onClick={(event) => { event.stopPropagation(); setAccountToDelete(member) }} aria-label={`删除账号 ${member.name}`}>×</span>
                    </button>
                  ))}
                </div>
                <button type="button" className="register-button" onClick={startRegister}>注册新账号</button>
              </div>
            )}
            {isRegistering && <div className="register-mode-heading"><strong>注册一个新账号</strong><button type="button" onClick={() => setIsRegistering(false)}>返回账号选择</button></div>}
            {isRegistering && <label htmlFor="nickname">你的昵称</label>}
            {isRegistering && <>
            <div className={`nickname-field ${error ? 'nickname-field--error' : ''}`}>
              <span aria-hidden="true">☺</span>
              <input
                id="nickname"
                value={nickname}
                onChange={(event) => {
                  setNickname(event.target.value)
                  setError('')
                }}
                placeholder="比如：小兔、阿布……"
                autoComplete="nickname"
                autoFocus
              />
            </div>
            <div className="field-message" aria-live="polite">{error || '昵称会成为你在小水站里的名字'}</div>
            <div className="login-settings">
              <div className="login-setting-block">
                <div className="login-setting-heading capacity-heading">
                  <label>我的水杯容量</label>
                  <strong>{cupCapacity} ml / 杯</strong>
                </div>
                <div className="capacity-picker">
                  {CUP_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      className={cupCapacity === option.value ? 'is-picked' : ''}
                      onClick={() => setCupCapacity(option.value)}
                    >
                      <strong>{option.label}</strong>
                      <small>{option.note}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="login-setting-block login-setting-row">
                <div className="login-setting-heading">
                  <label>我的性别</label>
                  <span>只用于称呼和小队展示</span>
                </div>
                <div className="gender-picker">
                  {GENDER_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      className={gender === option.value ? 'is-picked' : ''}
                      onClick={() => setGender(option.value)}
                    >
                      <span>{option.emoji}</span>{option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="login-setting-block">
                <div className="login-setting-heading">
                  <label>选一个固定头像</label>
                  <span>让大家一眼认出你</span>
                </div>
                <div className="avatar-picker">
                  {EMOJIS.map((item) => (
                    <button
                      type="button"
                      className={emoji === item ? 'is-picked' : ''}
                      key={item}
                      onClick={() => setEmoji(item)}
                      aria-label={`选择头像 ${item}`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button className="primary-button" type="submit">
              开始记录 <span aria-hidden="true">→</span>
            </button>
            </>}
          </form>
          {serverError && <p className="server-error" role="alert">{serverError}</p>}
          <p className="privacy-note"><span aria-hidden="true">⌁</span> 数据保存在小水站服务器里，换设备也能继续记录</p>
        </div>
      </section>
      {accountToDelete && <DeleteAccountModal member={accountToDelete} onClose={() => setAccountToDelete(null)} onConfirm={async () => { await onDeleteAccount(accountToDelete); setAccountToDelete(null) }} />}
    </main>
  )
}

type AddMemberModalProps = {
  onClose: () => void
  onAdd: (name: string, emoji: string) => void
}

function AddMemberModal({ onClose, onAdd }: AddMemberModalProps) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState(EMOJIS[1])
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus()
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  function submit(event: FormEvent) {
    event.preventDefault()
    const cleanName = name.trim()
    if (cleanName) onAdd(cleanName.slice(0, 12), emoji)
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="member-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-member-title"
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="关闭">×</button>
        <span className="modal-drop">💧</span>
        <h2 id="add-member-title">邀请一位喝水搭子</h2>
        <form onSubmit={submit}>
          <label htmlFor="member-name">TA 的昵称</label>
          <input
            id="member-name"
            className="modal-input"
            value={name}
            maxLength={12}
            onChange={(event) => setName(event.target.value)}
            placeholder="输入一个可爱的昵称"
          />
          <label>选一个小头像</label>
          <div className="emoji-picker">
            {EMOJIS.map((item) => (
              <button
                type="button"
                className={emoji === item ? 'is-picked' : ''}
                key={item}
                onClick={() => setEmoji(item)}
                aria-label={`选择头像 ${item}`}
              >
                {item}
              </button>
            ))}
          </div>
          <button className="primary-button" type="submit" disabled={!name.trim()}>加入小水站</button>
        </form>
      </div>
    </div>
  )
}

type ResetConfirmModalProps = {
  dateLabel: string
  actionCount: number
  onClose: () => void
  onConfirm: () => void
}

function ResetConfirmModal({ dateLabel, actionCount, onClose, onConfirm }: ResetConfirmModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    dialogRef.current?.querySelector<HTMLButtonElement>('.reset-modal__cancel')?.focus()
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="reset-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-record-title"
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="关闭">×</button>
        <span className="reset-modal__icon" aria-hidden="true">↺</span>
        <span className="reset-modal__eyebrow">A FRESH LITTLE START</span>
        <h2 id="reset-record-title">要把这一天重新开始吗？</h2>
        <p>{dateLabel}现在有 <strong>{actionCount}</strong> 条咕噜动态</p>
        <div className="reset-modal__scope"><span>⌁</span> 只清空当前日期，其他日期的记录不会受影响</div>
        <div className="reset-modal__actions">
          <button className="reset-modal__cancel" onClick={onClose}>先不清空</button>
          <button className="reset-modal__confirm" onClick={onConfirm}>确认重置</button>
        </div>
      </div>
    </div>
  )
}

type CupCapacityModalProps = {
  capacity: CupCapacity
  onClose: () => void
  onSave: (capacity: CupCapacity) => Promise<void>
}

function CupCapacityModal({ capacity, onClose, onSave }: CupCapacityModalProps) {
  const [draft, setDraft] = useState(capacity)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    await onSave(draft)
    setSaving(false)
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="member-modal capacity-modal" role="dialog" aria-modal="true" aria-labelledby="capacity-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="关闭">×</button>
        <span className="modal-drop">🥛</span>
        <h2 id="capacity-modal-title">选择我的水杯</h2>
        <p>选一个最接近的容量，记录会更轻松。</p>
        <form onSubmit={submit}>
          <div className="capacity-picker capacity-picker--modal">
            {CUP_OPTIONS.map((option) => (
              <button type="button" key={option.value} className={draft === option.value ? 'is-picked' : ''} onClick={() => setDraft(option.value)}>
                <strong>{option.label}</strong>
                <small>{option.note}</small>
              </button>
            ))}
          </div>
          <button className="primary-button" type="submit" disabled={saving}>{saving ? '保存中…' : `使用 ${draft} ml`}</button>
        </form>
      </div>
    </div>
  )
}

type DrinkPickerModalProps = {
  cupCapacity: CupCapacity
  onClose: () => void
  onConfirm: (kind: DrinkKind, volume: number) => void
}

function DrinkPickerModal({ cupCapacity, onClose, onConfirm }: DrinkPickerModalProps) {
  const [kind, setKind] = useState<DrinkKind>('water')
  const selectedDrink = DRINK_OPTIONS.find((option) => option.value === kind) ?? DRINK_OPTIONS[0]
  const defaultCapacity = selectedDrink.value === 'water' && selectedDrink.capacities.includes(cupCapacity)
    ? cupCapacity
    : selectedDrink.capacities[Math.min(1, selectedDrink.capacities.length - 1)]
  const [volume, setVolume] = useState(defaultCapacity)

  function selectKind(nextKind: DrinkKind) {
    setKind(nextKind)
    const next = DRINK_OPTIONS.find((option) => option.value === nextKind) ?? DRINK_OPTIONS[0]
    setVolume(next.value === 'water' && next.capacities.includes(cupCapacity)
      ? cupCapacity
      : next.capacities[Math.min(1, next.capacities.length - 1)])
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="member-modal drink-modal" role="dialog" aria-modal="true" aria-labelledby="drink-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="关闭">×</button>
        <span className="modal-drop drink-modal__drop">{selectedDrink.emoji}</span>
        <h2 id="drink-modal-title">准备什么饮品？</h2>
        <p>选好类型和容量，再去享受这一杯。</p>
        <div className="drink-kind-picker">
          {DRINK_OPTIONS.map((option) => (
            <button type="button" key={option.value} className={kind === option.value ? 'is-picked' : ''} onClick={() => selectKind(option.value)}>
              <span>{option.emoji}</span><strong>{option.label}</strong>
            </button>
          ))}
        </div>
        <div className="drink-volume-picker">
          <label>容量</label>
          <div>
            {selectedDrink.capacities.map((option) => (
              <button type="button" key={option} className={volume === option ? 'is-picked' : ''} onClick={() => setVolume(option)}>{option} ml</button>
            ))}
          </div>
        </div>
        <button className="primary-button" type="button" onClick={() => onConfirm(kind, volume)}>准备一杯 · {volume} ml</button>
      </div>
    </div>
  )
}

type DeleteAccountModalProps = {
  member: Member
  onClose: () => void
  onConfirm: () => void
}

function DeleteAccountModal({ member, onClose, onConfirm }: DeleteAccountModalProps) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="member-modal delete-account-modal" role="dialog" aria-modal="true" aria-labelledby="delete-account-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="关闭">×</button>
        <span className="modal-drop delete-account-modal__drop">{member.emoji}</span>
        <h2 id="delete-account-title">要删除「{member.name}」吗？</h2>
        <p>这个账号的全部记录都会一起消失，不能恢复。</p>
        <div className="delete-account-modal__scope"><span>⌁</span> 接水、喝水、上厕所、提醒和点赞关系都会删除</div>
        <div className="delete-account-modal__actions">
          <button className="delete-account-modal__cancel" onClick={onClose}>先留着</button>
          <button className="delete-account-modal__confirm" onClick={onConfirm}>确认删除</button>
        </div>
      </div>
    </div>
  )
}

type WeeklyAnalysisCardProps = {
  report: WeeklyAnalysisReport | null
  loading: boolean
  generating: boolean
  canGenerate: boolean
  isToday: boolean
  memberName: string
  onGenerate: () => void
}

function WeeklyAnalysisCard({ report, loading, generating, canGenerate, isToday, memberName, onGenerate }: WeeklyAnalysisCardProps) {
  const analysis = report?.analysis
  const issueState = analysis?.riskLevel === '低风险' ? 'clear' : analysis?.riskLevel === '数据不足' ? 'insufficient' : 'alert'
  const issueItems = analysis
    ? issueState === 'clear'
      ? []
      : issueState === 'insufficient'
        ? ['有效记录不足，暂时不能可靠判断今天是否正常或是否存在异动。']
        : analysis.anomalies
    : []
  const updatedAt = report
    ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(report.updatedAt))
    : ''

  return (
    <section className="weekly-analysis-card" aria-labelledby="weekly-analysis-title">
      <div className="weekly-analysis-heading">
        <div>
          <span className="card-kicker"><span>🫧</span> WATER CHECK-IN</span>
          <h2 id="weekly-analysis-title">近 7 日小水滴报告</h2>
          <p>{memberName} 的喝水节奏 · 今天和最近 7 天一起看</p>
        </div>
        <button type="button" onClick={onGenerate} disabled={!canGenerate || generating} title={!canGenerate ? '只能由本人生成当天分析' : undefined}>
          {generating ? '小水滴思考中…' : report ? '再分析一次' : '开始看看'}
        </button>
      </div>

      {loading ? (
        <div className="weekly-analysis-empty" role="status">正在读取分析…</div>
      ) : !analysis ? (
        <div className="weekly-analysis-empty">
          <span>🩺</span>
          <div>
            <strong>{isToday && canGenerate ? '还没有今天的个人分析' : '这个日期还没有保存分析'}</strong>
            <p>{isToday && canGenerate ? '将结合 14 天记录，判断今天是否偏离近期节奏。' : '历史日期与其他成员页面只读，不能补生成。'}</p>
          </div>
        </div>
      ) : (
        <div className="weekly-analysis-content" aria-live="polite">
          {report?.stale && <div className="weekly-analysis-stale">记录已经变化，这份分析需要刷新。</div>}
          <div className="weekly-analysis-verdict">
            <span className={`weekly-risk weekly-risk--${analysis.riskLevel === '低风险' ? 'low' : analysis.riskLevel === '数据不足' ? 'unknown' : 'watch'}`}>{analysis.riskLevel}</span>
            <div>
              <h3>{analysis.headline}</h3>
              <small>判断置信度：{analysis.confidence} · 更新于 {updatedAt} · {report?.generatedBy === 'model' ? '大模型生成' : report?.generatedBy === 'fallback' ? '本地规则兜底' : '已保存报告'}</small>
            </div>
          </div>
          {report?.generatedBy === 'fallback' && <div className="weekly-analysis-model-warning">当前未连接到大模型，本次显示的是本地规则兜底结果；点击“再分析一次”会再次尝试请求大模型。</div>}

          <section className={`weekly-analysis-issues weekly-analysis-issues--${issueState}`} aria-label="主要问题">
            <h3><span>{issueState === 'clear' ? '✓' : issueState === 'insufficient' ? '?' : '!'}</span> 主要问题</h3>
            {issueState === 'clear' ? (
              <p className="weekly-analysis-no-issue">未发现明显问题，今天的记录与个人近期节奏基本一致。</p>
            ) : (
              <ul>{issueItems.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
            )}
          </section>

          <div className="weekly-analysis-summary-grid">
            <article>
              <span>01</span>
              <div><h3>今天的状态</h3><p>{analysis.todayAssessment}</p></div>
            </article>
            <article>
              <span>02</span>
              <div><h3>近 7 日趋势</h3><p>{analysis.trendAssessment}</p></div>
            </article>
          </div>

          <div className="weekly-analysis-detail-grid">
            <article>
              <h3><span>⌁</span> 异动观察</h3>
              <ul>{analysis.anomalies.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
            </article>
            <article>
              <h3><span>🩺</span> 可能原因</h3>
              <ul>{analysis.healthPossibilities.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
            </article>
            <article>
              <h3><span>✓</span> 建议行动</h3>
              <ul>{analysis.actions.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
            </article>
            <article>
              <h3><span>🌟</span> 需要及时留意</h3>
              <ul>{analysis.warningSigns.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
            </article>
          </div>

          <details className="weekly-analysis-missing">
            <summary>影响判断准确度的缺失信息</summary>
            <p>{analysis.missingInformation.join('、')}</p>
          </details>
          <p className="weekly-analysis-boundary">以上判断基于自报打卡，不能替代医生诊断；准备容量不等于实际摄入量，上厕所次数也未区分排尿和排便。</p>
        </div>
      )}
    </section>
  )
}

function AppLoading() {
  return (
    <main className="app-loading">
      <Logo />
      <span>正在打开小水站…</span>
    </main>
  )
}

export default function App() {
  const [data, setData] = useState<AppData>(emptyData)
  const [isLoading, setIsLoading] = useState(true)
  const [requestError, setRequestError] = useState('')
  const [selectedDate, setSelectedDate] = useState(localDateKey)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [showAddMember, setShowAddMember] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [lastAction, setLastAction] = useState<WaterAction | null>(null)
  const [actionBurst, setActionBurst] = useState<{ type: ActionType; id: string } | null>(null)
  const [nudgeNotice, setNudgeNotice] = useState<string | null>(null)
  const [milestone, setMilestone] = useState<{ title: string; message: string; emoji: string } | null>(null)
  const [isEditingNote, setIsEditingNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [isGeneratingNote, setIsGeneratingNote] = useState(false)
  const [showCapacityEditor, setShowCapacityEditor] = useState(false)
  const [showDrinkPicker, setShowDrinkPicker] = useState(false)
  const [weeklyAnalysisReport, setWeeklyAnalysisReport] = useState<WeeklyAnalysisReport | null>(null)
  const [isLoadingWeeklyAnalysis, setIsLoadingWeeklyAnalysis] = useState(false)
  const [isGeneratingWeeklyAnalysis, setIsGeneratingWeeklyAnalysis] = useState(false)
  const noteMilestoneRef = useRef<{ date: string; key: string } | null>(null)
  const noteRefreshTimerRef = useRef<number | null>(null)
  const noteGenerationRef = useRef(false)
  const noteManualLockRef = useRef<string | null>(null)
  const weeklyAnalysisGenerationRef = useRef(false)
  const weeklyAnalysisViewKeyRef = useRef('')
  const weeklyAnalysisAutoAttemptKeyRef = useRef('')

  useEffect(() => {
    let active = true
    apiRequest<{ members: Member[]; actions: WaterAction[]; nudges: Nudge[]; notes: DailyNote[]; noteLikes: NoteLike[] }>('/api/bootstrap')
      .then((payload) => {
        if (!active) return
        const savedUser = localStorage.getItem(SESSION_KEY)
        setData({
          currentUser: savedUser,
          members: payload.members,
          actions: payload.actions,
          nudges: payload.nudges || [],
          notes: payload.notes || [],
          noteLikes: payload.noteLikes || [],
        })
      })
      .catch(() => {
        if (active) setRequestError('小水站还没有启动，请先运行 npm run start')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (selectedMemberId && data.members.some((member) => member.id === selectedMemberId)) return
    const ownMember = data.members.find((member) => member.name === data.currentUser)
    setSelectedMemberId(ownMember?.id ?? data.members[0]?.id ?? null)
  }, [data.currentUser, data.members, selectedMemberId])

  useEffect(() => {
    setIsEditingNote(false)
    setNoteDraft('')
    setShowCapacityEditor(false)
    setShowDrinkPicker(false)
    setShowResetConfirm(false)
    setLastAction(null)
  }, [selectedDate])

  const dayActions = useMemo(
    () => data.actions.filter((item) => item.date === selectedDate),
    [data.actions, selectedDate],
  )
  const selectedMember = data.members.find((member) => member.id === selectedMemberId)
    ?? data.members.find((member) => member.name === data.currentUser)
    ?? data.members[0]
  const currentUserMember = data.members.find((member) => member.name === data.currentUser) ?? selectedMember
  const isToday = selectedDate === localDateKey()
  const isOwnView = selectedMember?.id === currentUserMember?.id
  const canRecord = isOwnView && isToday
  const selectedActions = selectedMember
    ? dayActions.filter((item) => item.memberId === selectedMember.id)
    : []
  const fetchCount = selectedMember ? countOf(dayActions, selectedMember.id, 'fetch') : 0
  const drinkCount = selectedMember ? countOf(dayActions, selectedMember.id, 'drink') : 0
  const restroomCount = selectedMember ? countOf(dayActions, selectedMember.id, 'restroom') : 0
  const progress = Math.min(100, Math.round((fetchCount / 8) * 100))
  const summaryRows = useMemo(() => {
    if (!selectedMember) return []
    return Array.from({ length: 7 }, (_, index) => {
      const date = shiftDate(selectedDate, index - 6)
      const actions = data.actions.filter((item) => item.date === date && item.memberId === selectedMember.id)
      const fetch = actions.filter((item) => item.type === 'fetch').length
      const drink = actions.filter((item) => item.type === 'drink').length
      const restroom = actions.filter((item) => item.type === 'restroom').length
      const preparedVolume = actions.reduce(
        (total, item) => item.type === 'fetch' ? total + (item.volume || selectedMember.cupCapacity) : total,
        0,
      )
      return {
        date,
        fetch,
        drink,
        restroom,
        volume: preparedVolume,
      }
    })
  }, [data.actions, selectedDate, selectedMember])
  const summaryFetchTotal = summaryRows.reduce((total, row) => total + row.fetch, 0)
  const summaryRestroomTotal = summaryRows.reduce((total, row) => total + row.restroom, 0)
  const summaryVolumeTotal = summaryRows.reduce((total, row) => total + row.volume, 0)
  const recordDays = selectedMember ? daysWithRecords(data.actions, selectedMember.id, selectedDate, 7) : 0
  const memberFetchTotal = selectedMember ? countOf(data.actions, selectedMember.id, 'fetch') : 0
  const cupProgress = cupLevel(memberFetchTotal)
  const coupleFetchCount = data.actions.filter((item) => item.date === selectedDate && item.type === 'fetch').length
  const coupleDrinkCount = data.actions.filter((item) => item.date === selectedDate && item.type === 'drink').length
  const coupleTarget = 10
  const coupleProgress = Math.min(100, Math.round((coupleFetchCount / coupleTarget) * 100))
  const mood = hydrationMood(fetchCount)
  const nudgeCount = selectedMember ? data.nudges.filter((nudge) => nudge.toMemberId === selectedMember.id).length : 0
  const currentNote = data.notes.find((note) => note.date === selectedDate)
  const noteContent = currentNote?.content || DEFAULT_NOTE
  const noteLikeCount = currentNote?.likes || 0
  const noteLiked = currentUserMember
    ? data.noteLikes.some((like) => like.date === selectedDate && like.memberId === currentUserMember.id)
    : false
  weeklyAnalysisViewKeyRef.current = `${selectedDate}:${selectedMember?.id || ''}`

  useEffect(() => {
    if (!data.currentUser || !selectedMember) return
    let active = true
    setIsLoadingWeeklyAnalysis(true)
    setWeeklyAnalysisReport(null)
    apiRequest<WeeklyAnalysisReport | null>(`/api/weekly-analysis?date=${encodeURIComponent(selectedDate)}&memberId=${encodeURIComponent(selectedMember.id)}`)
      .then((report) => {
        if (active) setWeeklyAnalysisReport(report)
      })
      .catch(() => {
        if (active) setRequestError('近 7 日分析暂时没有读取成功，请稍后再试')
      })
      .finally(() => {
        if (active) setIsLoadingWeeklyAnalysis(false)
      })
    return () => { active = false }
  }, [data.currentUser, selectedDate, selectedMember?.id])

  useEffect(() => {
    if (!data.currentUser || isLoadingWeeklyAnalysis || weeklyAnalysisReport || !canRecord || isGeneratingWeeklyAnalysis || weeklyAnalysisGenerationRef.current) return
    const viewKey = `${selectedDate}:${selectedMember?.id || ''}`
    if (weeklyAnalysisAutoAttemptKeyRef.current === viewKey) return
    weeklyAnalysisAutoAttemptKeyRef.current = viewKey
    generateWeeklyHealthAnalysis()
  }, [canRecord, data.currentUser, isGeneratingWeeklyAnalysis, isLoadingWeeklyAnalysis, selectedDate, selectedMember?.id, weeklyAnalysisReport])

  useEffect(() => {
    if (!weeklyAnalysisReport?.stale || !canRecord || isGeneratingWeeklyAnalysis || weeklyAnalysisGenerationRef.current) return
    const timer = window.setTimeout(() => generateWeeklyHealthAnalysis(), 90_000)
    return () => window.clearTimeout(timer)
  }, [canRecord, isGeneratingWeeklyAnalysis, weeklyAnalysisReport?.stale])

  useEffect(() => {
    if (!data.currentUser || !isToday || currentNote || isGeneratingNote || noteGenerationRef.current) return
    let active = true
    const requestedMilestoneKey = noteMilestoneKey(coupleFetchCount, coupleDrinkCount)
    noteGenerationRef.current = true
    setIsGeneratingNote(true)
    apiRequest<DailyNote>('/api/notes/generate', {
      method: 'POST',
      body: JSON.stringify({ date: selectedDate }),
    }).then((generatedNote) => {
      if (!active) return
      noteMilestoneRef.current = { date: selectedDate, key: requestedMilestoneKey }
      setData((previous) => ({ ...previous, notes: [...previous.notes, generatedNote] }))
    }).catch(() => {
      if (active) setRequestError('小纸条暂时没有生成成功，请稍后重试')
    }).finally(() => {
      noteGenerationRef.current = false
      if (active) setIsGeneratingNote(false)
    })
    return () => { active = false }
  }, [coupleDrinkCount, coupleFetchCount, currentNote, data.currentUser, isGeneratingNote, isToday, selectedDate])

  useEffect(() => {
    if (!data.currentUser || !isToday || !currentNote || isGeneratingNote || noteGenerationRef.current || noteManualLockRef.current === selectedDate) return
    const nextKey = noteMilestoneKey(coupleFetchCount, coupleDrinkCount)
    const previous = noteMilestoneRef.current
    if (!previous || previous.date !== selectedDate) {
      noteMilestoneRef.current = { date: selectedDate, key: nextKey }
      return
    }
    if (previous.key === nextKey) return
    noteMilestoneRef.current = { date: selectedDate, key: nextKey }
    if (noteRefreshTimerRef.current) window.clearTimeout(noteRefreshTimerRef.current)
    noteRefreshTimerRef.current = window.setTimeout(() => {
      noteRefreshTimerRef.current = null
      if (noteGenerationRef.current) return
      noteGenerationRef.current = true
      setIsGeneratingNote(true)
      apiRequest<DailyNote>('/api/notes/generate', {
        method: 'POST',
        body: JSON.stringify({ date: selectedDate }),
      }).then((generatedNote) => {
        setData((previousData) => ({
          ...previousData,
          notes: previousData.notes.some((note) => note.date === selectedDate)
            ? previousData.notes.map((note) => note.date === selectedDate ? generatedNote : note)
            : [...previousData.notes, generatedNote],
        }))
        setRequestError('')
      }).catch(() => {
        setRequestError('小纸条暂时没有生成成功，请稍后重试')
      }).finally(() => {
        noteGenerationRef.current = false
        setIsGeneratingNote(false)
      })
    }, 1_200)
  }, [coupleDrinkCount, coupleFetchCount, currentNote, data.currentUser, isGeneratingNote, isToday, selectedDate])

  useEffect(() => () => {
    if (noteRefreshTimerRef.current) {
      window.clearTimeout(noteRefreshTimerRef.current)
      noteRefreshTimerRef.current = null
    }
  }, [selectedDate])

  async function login(profile: LoginProfile) {
    try {
      const existing = data.members.find((member) => member.name === profile.nickname)
      const member = await apiRequest<Member>('/api/members', {
        method: 'POST',
        body: JSON.stringify({
          id: existing?.id || uid('member'),
          name: profile.nickname,
          emoji: profile.emoji,
          color: existing?.color || COLORS[data.members.length % COLORS.length],
          gender: profile.gender,
          cupCapacity: profile.cupCapacity,
          createdAt: Date.now(),
        }),
      })
      setData((previous) => ({
        ...previous,
        currentUser: profile.nickname,
        members: previous.members.some((item) => item.id === member.id)
          ? previous.members.map((item) => item.id === member.id ? member : item)
          : [...previous.members, member],
      }))
      setSelectedMemberId(member.id)
      localStorage.setItem(SESSION_KEY, profile.nickname)
      setRequestError('')
    } catch {
      setRequestError('登录信息暂时没保存成功，请检查服务是否启动')
    }
  }

  async function deleteAccount(member: Member) {
    try {
      await apiRequest<void>(`/api/members/${encodeURIComponent(member.id)}`, { method: 'DELETE' })
      setData((previous) => ({
        ...previous,
        members: previous.members.filter((item) => item.id !== member.id),
        actions: previous.actions.filter((item) => item.memberId !== member.id),
        nudges: previous.nudges.filter((nudge) => nudge.fromMemberId !== member.id && nudge.toMemberId !== member.id),
        noteLikes: previous.noteLikes.filter((like) => like.memberId !== member.id),
      }))
      setRequestError('')
    } catch {
      setRequestError('账号暂时没有删除成功，请稍后再试')
      throw new Error('delete account failed')
    }
  }

  function logout() {
    setData((previous) => ({ ...previous, currentUser: null }))
    setSelectedMemberId(null)
    localStorage.removeItem(SESSION_KEY)
  }

  async function addMember(name: string, emoji: string) {
    const existing = data.members.find((member) => member.name === name)
    if (existing) {
      setSelectedMemberId(existing.id)
      setShowAddMember(false)
      return
    }
    const member: Member = {
      id: uid('member'),
      name,
      emoji,
      color: COLORS[data.members.length % COLORS.length],
      gender: 'secret',
      cupCapacity: 350,
    }
    try {
      const savedMember = await apiRequest<Member>('/api/members', {
        method: 'POST',
        body: JSON.stringify({ ...member, cupCapacity: member.cupCapacity, createdAt: Date.now() }),
      })
      setData((previous) => ({ ...previous, members: [...previous.members, savedMember] }))
      setShowAddMember(false)
    } catch {
      setRequestError('这位搭子暂时没有加入成功，请稍后再试')
    }
  }

  function record(type: ActionType, drinkKind?: DrinkKind, volume?: number) {
    if (!selectedMember || !canRecord || selectedDate !== localDateKey()) return
    const now = new Date()
    const action: WaterAction = {
      id: uid('action'),
      memberId: selectedMember.id,
      type,
      date: selectedDate,
      time: now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
      createdAt: Date.now(),
      ...(drinkKind ? { drinkKind, volume } : {}),
    }
    apiRequest<WaterAction>('/api/actions', {
      method: 'POST',
      body: JSON.stringify(action),
    }).then((savedAction) => {
      setData((previous) => ({ ...previous, actions: [...previous.actions, savedAction] }))
      markWeeklyAnalysisStale()
      setLastAction(savedAction)
      setActionBurst({ type, id: savedAction.id })
      window.setTimeout(() => {
        setActionBurst((current) => current?.id === savedAction.id ? null : current)
      }, 720)
      setRequestError('')
      navigator.vibrate?.(10)
      const nextFetchCount = countOf(data.actions, selectedMember.id, 'fetch') + (type === 'fetch' ? 1 : 0)
      const milestones: Record<number, { title: string; message: string; emoji: string }> = {
        1: { title: '第一杯，开喝！', message: '今天的好习惯已经种下啦。', emoji: '💧' },
        4: { title: '半程小水手', message: '已经接到一半，和自己击个掌。', emoji: '🌱' },
        8: { title: '今日准备满啦！', message: '想喝还可以继续准备，喝水不限次。', emoji: '⭐' },
        25: { title: '闪闪水手', message: '你和水杯已经很熟练啦。', emoji: '✨' },
        50: { title: '水之守护者', message: '这份坚持值得一朵彩虹。', emoji: '🌈' },
      }
      if (type === 'fetch' && milestones[nextFetchCount]) {
        const nextMilestone = milestones[nextFetchCount]
        setMilestone(nextMilestone)
        window.setTimeout(() => setMilestone((current) => current === nextMilestone ? null : current), 2600)
      }
    }).catch(() => {
      setRequestError('这次记录没有保存成功，请稍后再试')
    })
  }

  function recordPreparedDrink(kind: DrinkKind, volume: number) {
    setShowDrinkPicker(false)
    record('fetch', kind, volume)
  }

  async function sendNudge() {
    if (isOwnView || !isToday || !selectedMember || !currentUserMember) return
    const now = new Date()
    const nudge: Nudge = {
      id: uid('nudge'),
      fromMemberId: currentUserMember.id,
      toMemberId: selectedMember.id,
      date: selectedDate,
      time: now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
      createdAt: Date.now(),
    }
    try {
      const savedNudge = await apiRequest<Nudge>('/api/nudges', {
        method: 'POST',
        body: JSON.stringify(nudge),
      })
      setData((previous) => ({ ...previous, nudges: [...previous.nudges, savedNudge] }))
      setNudgeNotice(`已给 ${selectedMember.name} 送去一颗小水滴`)
      navigator.vibrate?.(8)
      window.setTimeout(() => setNudgeNotice(null), 2400)
    } catch {
      setRequestError('提醒暂时没有送达，请稍后再试')
    }
  }

  function startNoteEdit() {
    if (!isToday) return
    setNoteDraft(noteContent)
    setIsEditingNote(true)
  }

  async function saveNote() {
    const content = noteDraft.trim()
    if (!content || !isToday || selectedDate !== localDateKey()) return
    try {
      const savedNote = await apiRequest<DailyNote>('/api/notes', {
        method: 'POST',
        body: JSON.stringify({ date: selectedDate, content }),
      })
      setData((previous) => ({
        ...previous,
        notes: previous.notes.some((note) => note.date === selectedDate)
          ? previous.notes.map((note) => note.date === selectedDate ? savedNote : note)
          : [...previous.notes, savedNote],
      }))
      noteManualLockRef.current = selectedDate
      setIsEditingNote(false)
      setRequestError('')
    } catch {
      setRequestError('小纸条暂时没有保存成功，请稍后再试')
    }
  }

  async function generateNote() {
    if (!isToday || selectedDate !== localDateKey() || isGeneratingNote || noteGenerationRef.current) return
    if (noteRefreshTimerRef.current) {
      window.clearTimeout(noteRefreshTimerRef.current)
      noteRefreshTimerRef.current = null
    }
    const requestedMilestoneKey = noteMilestoneKey(coupleFetchCount, coupleDrinkCount)
    const wasManualLocked = noteManualLockRef.current === selectedDate
    noteManualLockRef.current = null
    noteGenerationRef.current = true
    setIsGeneratingNote(true)
    try {
      const generatedNote = await apiRequest<DailyNote>('/api/notes/generate', {
        method: 'POST',
        body: JSON.stringify({ date: selectedDate }),
      })
      setData((previous) => ({
        ...previous,
        notes: previous.notes.some((note) => note.date === selectedDate)
          ? previous.notes.map((note) => note.date === selectedDate ? generatedNote : note)
          : [...previous.notes, generatedNote],
      }))
      if (selectedDate === localDateKey()) noteMilestoneRef.current = { date: selectedDate, key: requestedMilestoneKey }
      setIsEditingNote(false)
      setRequestError('')
    } catch {
      if (wasManualLocked) noteManualLockRef.current = selectedDate
      setRequestError('小纸条暂时没有生成成功，请稍后重试')
    } finally {
      noteGenerationRef.current = false
      setIsGeneratingNote(false)
    }
  }

  function markWeeklyAnalysisStale() {
    setWeeklyAnalysisReport((current) => current ? { ...current, stale: true } : current)
  }

  async function generateWeeklyHealthAnalysis() {
    if (!data.currentUser || !selectedMember || !canRecord || selectedDate !== localDateKey() || weeklyAnalysisGenerationRef.current) return
    const requestKey = `${selectedDate}:${selectedMember.id}`
    weeklyAnalysisGenerationRef.current = true
    setIsGeneratingWeeklyAnalysis(true)
    try {
      const report = await apiRequest<WeeklyAnalysisReport>('/api/weekly-analysis/generate', {
        method: 'POST',
        body: JSON.stringify({ date: selectedDate, memberId: selectedMember.id }),
      })
      if (weeklyAnalysisViewKeyRef.current === requestKey) setWeeklyAnalysisReport(report)
      setRequestError('')
    } catch {
      if (weeklyAnalysisViewKeyRef.current === requestKey) setRequestError('近 7 日分析暂时没有生成成功，请稍后重试')
    } finally {
      weeklyAnalysisGenerationRef.current = false
      setIsGeneratingWeeklyAnalysis(false)
    }
  }

  async function toggleNoteLike() {
    if (!currentUserMember || !isToday || selectedDate !== localDateKey()) return
    try {
      const result = await apiRequest<{ note: DailyNote; liked: boolean }>(`/api/notes/${encodeURIComponent(selectedDate)}/like`, {
        method: 'POST',
        body: JSON.stringify({ memberId: currentUserMember.id }),
      })
      setData((previous) => ({
        ...previous,
        notes: previous.notes.some((note) => note.date === selectedDate)
          ? previous.notes.map((note) => note.date === selectedDate ? result.note : note)
          : [...previous.notes, result.note],
        noteLikes: result.liked
          ? [...previous.noteLikes, { date: selectedDate, memberId: currentUserMember.id }]
          : previous.noteLikes.filter((like) => !(like.date === selectedDate && like.memberId === currentUserMember.id)),
      }))
      navigator.vibrate?.(8)
    } catch {
      setRequestError('点赞暂时没有保存成功，请稍后再试')
    }
  }

  async function saveCapacity(nextCapacity: CupCapacity) {
    if (!canRecord || !currentUserMember) return
    try {
      const savedMember = await apiRequest<Member>('/api/members', {
        method: 'POST',
        body: JSON.stringify({
          ...currentUserMember,
          cupCapacity: nextCapacity,
          createdAt: Date.now(),
        }),
      })
      setData((previous) => ({ ...previous, members: previous.members.map((member) => member.id === savedMember.id ? savedMember : member) }))
      markWeeklyAnalysisStale()
      setShowCapacityEditor(false)
      setRequestError('')
    } catch {
      setRequestError('水杯容量暂时没有保存成功，请稍后再试')
    }
  }

  async function undoLastAction() {
    if (!lastAction || lastAction.date !== localDateKey()) return
    try {
      await apiRequest<void>(`/api/actions/${encodeURIComponent(lastAction.id)}`, { method: 'DELETE' })
      setData((previous) => ({
        ...previous,
        actions: previous.actions.filter((item) => item.id !== lastAction.id),
      }))
      markWeeklyAnalysisStale()
      setLastAction(null)
      setActionBurst(null)
    } catch {
      setRequestError('撤销没有保存成功，请稍后再试')
    }
  }

  function resetDay() {
    if (!canRecord || !selectedActions.length || selectedDate !== localDateKey()) return
    setShowResetConfirm(true)
  }

  async function confirmResetDay() {
    if (!selectedMember || !canRecord || selectedDate !== localDateKey()) return
    const memberId = selectedMember.id
    try {
      await apiRequest<void>(`/api/actions?memberId=${encodeURIComponent(memberId)}&date=${encodeURIComponent(selectedDate)}`, { method: 'DELETE' })
      setData((previous) => ({
        ...previous,
        actions: previous.actions.filter((item) => item.date !== selectedDate || item.memberId !== memberId),
      }))
      markWeeklyAnalysisStale()
      setLastAction(null)
      setShowResetConfirm(false)
    } catch {
      setRequestError('重置没有保存成功，请稍后再试')
    }
  }

  if (isLoading) return <AppLoading />
  if (!data.currentUser) return <LoginScreen onLogin={login} onDeleteAccount={deleteAccount} serverError={requestError} members={data.members} />
  if (!selectedMember) return null

  return (
    <div className="app-shell">
      <header className="topbar">
        <Logo compact />
        <div className="topbar__right">
          <span className="today-chip"><span>●</span> 今天也要喝水</span>
          <div className="profile-chip">
            <span className="profile-chip__avatar" style={{ background: currentUserMember?.color }}>{currentUserMember?.emoji}</span>
            <span className="profile-chip__identity"><strong>{data.currentUser}</strong><small>当前登录</small></span>
          </div>
          <button className="logout-button" onClick={logout}>退出</button>
        </div>
      </header>

      <main className="dashboard">
        {requestError && <div className="server-error server-error--dashboard" role="alert">{requestError}</div>}
        <section className="welcome-row">
          <div>
            <span className="eyebrow eyebrow--blue">DAILY HYDRATION</span>
            <h1>{greeting()}，{data.currentUser} <span aria-hidden="true">☁️</span></h1>
            <p>{isToday ? '把今天的每一口水，都变成软乎乎的小确幸。' : '翻开过去的一页，看看那天喝了多少水。'}</p>
          </div>
          <div className="date-controls">
            <div className="date-switcher" aria-label="选择日期">
              <button onClick={() => setSelectedDate((date) => shiftDate(date, -1))} aria-label="前一天">
                <ArrowIcon direction="left" />
              </button>
              <DatePicker value={selectedDate} maxDate={localDateKey()} onChange={setSelectedDate} />
              <button
                onClick={() => setSelectedDate((date) => shiftDate(date, 1))}
                disabled={isToday}
                aria-label="后一天"
              >
                <ArrowIcon direction="right" />
              </button>
            </div>
            {!isToday && (
              <button className="today-return" onClick={() => setSelectedDate(localDateKey())}>
                回到今天
              </button>
            )}
          </div>
        </section>

        <section className="member-strip" aria-label="小水站成员">
          <div className="member-strip__content">
            <div className="member-strip__list">
              {data.members.map((member) => (
                <button
                  className={`member-tab ${member.id === selectedMember.id ? 'member-tab--active' : ''}`}
                  key={member.id}
                  onClick={() => setSelectedMemberId(member.id)}
                  aria-pressed={member.id === selectedMember.id}
                  style={{ '--member-color': member.color } as React.CSSProperties}
                >
                  <span className="member-tab__avatar">{member.emoji}</span>
                  <span>{member.name}</span>
                </button>
              ))}
            </div>
          </div>
          <button className="add-member-button" onClick={() => setShowAddMember(true)}>
            <PlusIcon /> 邀请搭子
          </button>
        </section>

        <div className="dashboard-grid">
          <div className="dashboard-main">
            <section className="hydrate-card">
              <div className="card-heading">
                <div>
                  <span className="card-kicker"><span>✦</span> {selectedMember.name} 的{isToday ? '今日水站' : `${formatMonthDay(selectedDate)} 水站`}</span>
                  <h2>{isToday ? '今天的喝水记录' : '历史记录（仅查看）'}</h2>
                </div>
                <div className="hydrate-card__tools">
                  <div
                    className={`capacity-display ${canRecord ? 'capacity-display--interactive' : ''}`}
                    aria-label={`每杯容量 ${selectedMember.cupCapacity} 毫升`}
                    role={canRecord ? 'button' : undefined}
                    tabIndex={canRecord ? 0 : undefined}
                    onClick={canRecord ? () => setShowCapacityEditor(true) : undefined}
                    onKeyDown={canRecord ? (event) => { if (event.key === 'Enter' || event.key === ' ') setShowCapacityEditor(true) } : undefined}
                  >
                    <span className="capacity-display__cup" aria-hidden="true">🥛</span>
                    <span className="capacity-display__copy">
                      <strong>{selectedMember.cupCapacity}<em> ml</em></strong>
                      <small>每日目标 8 杯</small>
                    </span>
                  </div>
                  <button
                    className="reset-button reset-button--card"
                    onClick={resetDay}
                    disabled={!canRecord || !selectedActions.length}
                    title={!isToday ? '历史数据仅供查看' : !isOwnView ? '只能重置当前登录账号的记录' : '清空今天自己的记录'}
                  >
                    重置本日
                  </button>
                  {!isToday && <span className="readonly-badge">历史只读</span>}
                  {isToday && !isOwnView && <span className="readonly-badge">只读</span>}
                  {isToday && !isOwnView && <button className="nudge-button" onClick={sendNudge}><span>💌</span>提醒 TA</button>}
                  {isOwnView && nudgeCount > 0 && <span className="nudge-count">收到 {nudgeCount} 次提醒</span>}
                </div>
                </div>
              <div className="hydrate-overview">
                <div className="progress-wrap">
                  <div
                    className={`progress-ring ${actionBurst ? 'progress-ring--pulse' : ''}`}
                    style={{ '--progress': `${progress * 3.6}deg` } as React.CSSProperties}
                  >
                    <div className="progress-ring__inside">
                      <span className="progress-drop">💧</span>
                      <strong>{fetchCount}</strong>
                      <span className="progress-mood" aria-live="polite"><span aria-hidden="true">{mood.emoji}</span> {mood.message}</span>
                      <span>杯数</span>
                    </div>
                  </div>
                </div>

                <div className="action-zone">
                  <div className="action-grid">
                    <button className={`water-action water-action--fetch ${actionBurst?.type === 'fetch' ? 'water-action--burst' : ''}`} onClick={() => setShowDrinkPicker(true)} disabled={!canRecord} title={!isToday ? '历史数据仅供查看' : !isOwnView ? '只能记录当前登录账号' : undefined}>
                      <span className="water-action__icon"><span>＋</span>🥤</span>
                      <span className="water-action__copy">
                        <small>准备一杯饮品</small>
                        <strong>杯数</strong>
                      </span>
                      <span className="water-action__count">{fetchCount}<small> 杯</small></span>
                      {actionBurst?.type === 'fetch' && <span className="water-action__particles" key={actionBurst.id} aria-hidden="true"><i>✦</i><i>💧</i><i>·</i></span>}
                    </button>
                    <button className={`water-action water-action--drink ${actionBurst?.type === 'drink' ? 'water-action--burst' : ''}`} onClick={() => record('drink')} disabled={!canRecord} title={!isToday ? '历史数据仅供查看' : !isOwnView ? '只能记录当前登录账号' : undefined}>
                      <span className="water-action__icon"><span>＋</span>🥛</span>
                      <span className="water-action__copy">
                        <small>每喝一次点一下</small>
                        <strong>喝水次数</strong>
                      </span>
                      <span className="water-action__count">{drinkCount}<small> 次</small></span>
                      {actionBurst?.type === 'drink' && <span className="water-action__particles" key={actionBurst.id} aria-hidden="true"><i>♡</i><i>✦</i><i>·</i></span>}
                    </button>
                    <button className={`water-action water-action--restroom ${actionBurst?.type === 'restroom' ? 'water-action--burst' : ''}`} onClick={() => record('restroom')} disabled={!canRecord} title={!isToday ? '历史数据仅供查看' : !isOwnView ? '只能记录当前登录账号' : undefined}>
                      <span className="water-action__icon"><span>＋</span>🚻</span>
                      <span className="water-action__copy">
                        <small>每去一次点一下</small>
                        <strong>上厕所次数</strong>
                      </span>
                      <span className="water-action__count">{restroomCount}<small> 次</small></span>
                      {actionBurst?.type === 'restroom' && <span className="water-action__particles" key={actionBurst.id} aria-hidden="true"><i>✦</i><i>◌</i><i>·</i></span>}
                    </button>
                  </div>
                  <div className="cup-trail" aria-label={`${isToday ? '今日' : formatMonthDay(selectedDate)}杯数 ${fetchCount}/8`}>
                    {Array.from({ length: 8 }).map((_, index) => (
                      <span key={index} className={index < fetchCount ? 'is-full' : ''}>
                        {index < fetchCount ? '●' : '○'}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="pair-progress">
                <div className="pair-progress__top">
                  <span><span className="pair-progress__heart">♡</span> {isToday ? '我们今天的杯数' : `${formatMonthDay(selectedDate)} 的杯数`}</span>
                  <strong>{coupleFetchCount}<small> / {coupleTarget} 杯</small></strong>
                </div>
                <div className="pair-progress__bar"><span style={{ width: `${coupleProgress}%` }} /></div>
                <div className="pair-progress__bottom">
                  <span className="mini-avatars">
                    {data.members.slice(0, 4).map((member) => <i key={member.id} style={{ background: member.color }}>{member.emoji}</i>)}
                  </span>
                  <span>{coupleProgress >= 100 ? '双倍补水完成！' : '共同进度'}</span>
                  <span>喝水 {coupleDrinkCount} 次</span>
                </div>
              </div>
              <div className="cup-growth">
                <span className="cup-growth__emoji">{cupProgress.emoji}</span>
                <div className="cup-growth__copy">
                  <div><strong>水杯成长 Lv.{cupProgress.level}</strong><small>{cupProgress.name}</small></div>
                <div className="cup-growth__bar"><span style={{ width: `${cupProgress.progress}%` }} /></div>
                </div>
              </div>
            </section>

            <WaterRhythmChart actions={selectedActions} date={selectedDate} />

            <WeeklyAnalysisCard
              report={weeklyAnalysisReport}
              loading={isLoadingWeeklyAnalysis}
              generating={isGeneratingWeeklyAnalysis}
              canGenerate={canRecord}
              isToday={isToday}
              memberName={selectedMember.name}
              onGenerate={generateWeeklyHealthAnalysis}
            />

          </div>

          <aside className="dashboard-side">
            <section className="side-notes" aria-label="温馨提醒和今日小纸条">
              <section className="love-note-card">
                <span className="tape" aria-hidden="true" />
                <span className="note-doodle note-doodle--heart">♡</span>
                <span className="note-doodle note-doodle--spark">✦</span>
                <div className="note-heading">
                  <p>{isToday ? '今日小纸条' : `${formatMonthDay(selectedDate)} 小纸条`}</p>
                  <div className="note-heading__actions">
                    <button type="button" className="note-generate-button" onClick={generateNote} disabled={!isToday || isGeneratingNote} title={!isToday ? '历史数据仅供查看' : '关键进度会自动更新，也可以手动换一句'}>{isGeneratingNote ? '生成中…' : '✦ 换一句'}</button>
                    <button type="button" className="note-edit-button" onClick={startNoteEdit} disabled={!isToday} title={!isToday ? '历史数据仅供查看' : undefined}>✎ 编辑</button>
                  </div>
                </div>
                {isEditingNote ? (
                  <div className="note-editor">
                    <textarea value={noteDraft} maxLength={160} onChange={(event) => setNoteDraft(event.target.value)} autoFocus />
                    <div className="note-editor__actions">
                      <button type="button" onClick={() => setIsEditingNote(false)}>取消</button>
                      <button type="button" onClick={saveNote} disabled={!noteDraft.trim()}>保存</button>
                    </div>
                  </div>
                ) : (
                  <blockquote aria-live="polite">“{noteContent}”</blockquote>
                )}
                <div className="note-footer">
                  <span className="mini-avatars">
                    {data.members.slice(0, 3).map((member) => <i key={member.id} style={{ background: member.color }}>{member.emoji}</i>)}
                  </span>
                  <button type="button" className={`note-like-button ${noteLiked ? 'is-liked' : ''}`} onClick={toggleNoteLike} aria-pressed={noteLiked} disabled={!isToday} title={!isToday ? '历史数据仅供查看' : undefined}>
                    <span>{noteLiked ? '♥' : '♡'}</span> {noteLikeCount}
                  </button>
                </div>
              </section>
              <section className="tip-card">
                <span>☀️</span>
                <div>
                  <strong>温柔提醒</strong>
                  <p>久坐后起来接杯水，也让眼睛休息一下吧。</p>
                </div>
              </section>
            </section>
            <section className="team-card">
              <div className="side-heading">
                <div>
                  <span className="card-kicker"><span>⌁</span> OUR TEAM</span>
                  <h2>我们的小水队</h2>
                </div>
                <span className="member-total">{data.members.length} 人</span>
              </div>
              <div className="team-list">
                {data.members.map((member) => {
                  const memberFetchCount = countOf(dayActions, member.id, 'fetch')
                  const memberDrinkCount = countOf(dayActions, member.id, 'drink')
                  const memberRestroomCount = countOf(dayActions, member.id, 'restroom')
                  return (
                    <button key={member.id} onClick={() => setSelectedMemberId(member.id)} className={member.id === selectedMember.id ? 'is-active' : ''}>
                      <span className="team-avatar" style={{ background: member.color }}>{member.emoji}</span>
                      <span className="team-name"><strong>{member.name}</strong></span>
                      <span className="team-stats">
                        <b><i>🚰</i>{memberFetchCount}</b>
                        <b><i>💧</i>{memberDrinkCount}</b>
                        <b><i>🚻</i>{memberRestroomCount}</b>
                      </span>
                    </button>
                  )
                })}
              </div>
              <button className="team-add" onClick={() => setShowAddMember(true)}><PlusIcon /> 添加新成员</button>
            </section>

            <section className="summary-card">
              <div className="side-heading">
                <div>
                  <span className="card-kicker"><span>▦</span> WATER RECAP</span>
                  <h2>近 7 日汇总</h2>
                </div>
                <span className="member-total summary-member">{selectedMember.name}</span>
              </div>
              <div className="summary-total">
                <div><strong>{summaryFetchTotal}</strong><span>杯数</span></div>
                <div><strong>{summaryVolumeTotal}<small> ml</small></strong><span>估算饮水量</span></div>
                <div><strong>{summaryRestroomTotal}</strong><span>上厕所次数</span></div>
              </div>
              <div className="summary-streak"><span>🌿</span> 过去 7 天有 <strong>{recordDays} 天</strong> 记得来小水站</div>
              <div className="summary-heatmap" aria-label="近七日杯数热力图">
                {summaryRows.map((row) => {
                  const intensity = Math.min(4, row.fetch)
                  return (
                    <button
                      type="button"
                      key={row.date}
                      className={`heatmap-cell heatmap-cell--${intensity} ${row.date === selectedDate ? 'is-selected' : ''}`}
                      onClick={() => setSelectedDate(row.date)}
                      title={`${formatMonthDay(row.date)}：准备 ${row.fetch} 杯`}
                      aria-label={`${formatMonthDay(row.date)}，准备 ${row.fetch} 杯`}
                    >
                      <span>{row.date === localDateKey() ? '今' : formatMonthDay(row.date).replace('/', ' / ')}</span>
                    </button>
                  )
                })}
              </div>
              <div className="summary-list">
                {summaryRows.map((row) => (
                  <div className={`summary-row ${row.date === selectedDate ? 'is-selected' : ''}`} key={row.date}>
                    <div className="summary-date">
                      <strong>{row.date === localDateKey() ? '今天' : formatMonthDay(row.date)}</strong>
                      <small>{formatWeekday(row.date)}</small>
                    </div>
                    <div className="summary-row__counts">
                      <span><i>🥤</i>{row.fetch}</span>
                      <span><i>💧</i>{row.drink}</span>
                      <span><i>🚻</i>{row.restroom}</span>
                    </div>
                    <strong className="summary-volume">{row.volume}<small> ml</small></strong>
                  </div>
                ))}
              </div>
            </section>

          </aside>
        </div>
      </main>

      {milestone && (
        <div className="milestone-pop" role="status">
          <span className="milestone-pop__spark" aria-hidden="true">✦</span>
          <span className="milestone-pop__emoji">{milestone.emoji}</span>
          <div><strong>{milestone.title}</strong><small>{milestone.message}</small></div>
          <span className="milestone-pop__spark milestone-pop__spark--right" aria-hidden="true">✦</span>
        </div>
      )}

      {nudgeNotice && <div className="nudge-toast" role="status"><span>💌</span>{nudgeNotice}</div>}

      {lastAction && (
        <div className="toast" key={lastAction.id} role="status">
          <span>{lastAction.type === 'fetch' ? '🚰' : lastAction.type === 'drink' ? '💧' : '🚻'}</span>
          <div><strong>记好啦！</strong><small>{lastAction.type === 'fetch' ? '杯数 +1' : lastAction.type === 'drink' ? '喝水次数 +1' : '上厕所次数 +1'}</small></div>
          <button onClick={undoLastAction}>撤销</button>
          <button className="toast-close" aria-label="关闭提示" onClick={() => setLastAction(null)}>×</button>
        </div>
      )}

      {showAddMember && <AddMemberModal onClose={() => setShowAddMember(false)} onAdd={addMember} />}
      {showCapacityEditor && canRecord && (
        <CupCapacityModal
          capacity={currentUserMember.cupCapacity}
          onClose={() => setShowCapacityEditor(false)}
          onSave={saveCapacity}
        />
      )}
      {showDrinkPicker && canRecord && (
        <DrinkPickerModal
          cupCapacity={currentUserMember.cupCapacity}
          onClose={() => setShowDrinkPicker(false)}
          onConfirm={recordPreparedDrink}
        />
      )}
      {showResetConfirm && (
        <ResetConfirmModal
          dateLabel={isToday ? '今天' : formatDate(selectedDate)}
          actionCount={selectedActions.length}
          onClose={() => setShowResetConfirm(false)}
          onConfirm={confirmResetDay}
        />
      )}
    </div>
  )
}
