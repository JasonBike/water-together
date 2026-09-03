import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

type ActionType = 'fetch' | 'drink' | 'restroom'
type Gender = 'female' | 'male' | 'secret'
type CupCapacity = 250 | 350 | 500 | 750

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
}

type AppData = {
  currentUser: string | null
  members: Member[]
  actions: WaterAction[]
}

const SESSION_KEY = 'gulu-diary-session-v1'
const EMOJIS = ['🐰', '🐻', '🐱', '🐶', '🦊', '🐼', '🐹', '🐣']
const COLORS = ['#f8c8cc', '#b9dff0', '#f7d59b', '#cfdcb4', '#d9c9ef', '#f4bd9f']
const CUP_OPTIONS: Array<{ value: CupCapacity; label: string; note: string }> = [
  { value: 250, label: '小杯', note: '250 ml' },
  { value: 350, label: '刚刚好', note: '350 ml' },
  { value: 500, label: '大杯', note: '500 ml' },
  { value: 750, label: '超大杯', note: '750 ml' },
]
const GENDER_OPTIONS: Array<{ value: Gender; label: string; emoji: string }> = [
  { value: 'female', label: '女生', emoji: '♀' },
  { value: 'male', label: '男生', emoji: '♂' },
  { value: 'secret', label: '保密', emoji: '♡' },
]

const emptyData: AppData = {
  currentUser: null,
  members: [],
  actions: [],
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

function greeting() {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深啦'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 19) return '下午好'
  return '晚上好'
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

function WaterRhythmChart({ actions }: { actions: WaterAction[] }) {
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
      grid: { top: 25, right: 22, bottom: 32, left: 38, containLabel: true },
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
          name: '接水',
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
          name: '喝水',
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
          name: '上厕所',
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
          <h2>今天的水站节奏</h2>
        </div>
        <div className="chart-legend" aria-label="图例">
          <span><i className="chart-legend__dot chart-legend__dot--fetch" />接水</span>
          <span><i className="chart-legend__dot chart-legend__dot--drink" />喝水</span>
          <span><i className="chart-legend__dot chart-legend__dot--restroom" />上厕所</span>
        </div>
      </div>
      <p className="chart-subtitle">按小时看接水、喝水和上厕所集中在哪些时段</p>
      <div className="chart-canvas" ref={chartRef} role="img" aria-label="当天接水、喝水和上厕所次数的小时折线图" />
      <div className="chart-footer">
        {peakHour >= 0 ? <span>今天最活跃的时段：<strong>{String(peakHour).padStart(2, '0')}:00 左右</strong></span> : <span>记录后会显示你的饮水高峰时段</span>}
        <span>接水 {fetchByHour.reduce((sum, count) => sum + count, 0)} 次 · 喝水 {drinkByHour.reduce((sum, count) => sum + count, 0)} 次 · 上厕所 {restroomByHour.reduce((sum, count) => sum + count, 0)} 次</span>
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
            <span>只能选择今天或之前</span>
            <button type="button" onClick={() => onChange(maxDate)}>回到今天</button>
          </div>
        </div>
      )}
    </div>
  )
}

function LoginScreen({ onLogin, serverError = '' }: { onLogin: (profile: LoginProfile) => void; serverError?: string }) {
  const [nickname, setNickname] = useState('')
  const [gender, setGender] = useState<Gender>('secret')
  const [cupCapacity, setCupCapacity] = useState<CupCapacity>(350)
  const [emoji, setEmoji] = useState(EMOJIS[0])
  const [error, setError] = useState('')

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
            <label htmlFor="nickname">你的昵称</label>
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
                  <span>每杯大约能装多少水？</span>
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
          </form>
          {serverError && <p className="server-error" role="alert">{serverError}</p>}
          <p className="privacy-note"><span aria-hidden="true">⌁</span> 数据保存在小水站服务器里，换设备也能继续记录</p>
        </div>
      </section>
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
        <p>可以是恋人、室友，或者总忘记喝水的朋友。</p>
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

function EmptyTimeline() {
  return (
    <div className="empty-timeline">
      <div className="empty-cup" aria-hidden="true">
        <span>˙ᵕ˙</span>
      </div>
      <div>
        <strong>还没有咕噜动态</strong>
        <p>接好第一杯水，今天的故事就开始啦。</p>
      </div>
    </div>
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

  useEffect(() => {
    let active = true
    apiRequest<{ members: Member[]; actions: WaterAction[] }>('/api/bootstrap')
      .then((payload) => {
        if (!active) return
        const savedUser = localStorage.getItem(SESSION_KEY)
        setData({ currentUser: savedUser, members: payload.members, actions: payload.actions })
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

  const dayActions = useMemo(
    () => data.actions.filter((item) => item.date === selectedDate),
    [data.actions, selectedDate],
  )
  const selectedMember = data.members.find((member) => member.id === selectedMemberId)
    ?? data.members.find((member) => member.name === data.currentUser)
    ?? data.members[0]
  const currentUserMember = data.members.find((member) => member.name === data.currentUser) ?? selectedMember
  const canRecord = selectedMember?.id === currentUserMember?.id
  const selectedActions = selectedMember
    ? dayActions.filter((item) => item.memberId === selectedMember.id)
    : []
  const fetchCount = selectedMember ? countOf(dayActions, selectedMember.id, 'fetch') : 0
  const drinkCount = selectedMember ? countOf(dayActions, selectedMember.id, 'drink') : 0
  const restroomCount = selectedMember ? countOf(dayActions, selectedMember.id, 'restroom') : 0
  const progress = Math.min(100, Math.round((fetchCount / 8) * 100))
  const isToday = selectedDate === localDateKey()
  const summaryRows = useMemo(() => {
    if (!selectedMember) return []
    return Array.from({ length: 7 }, (_, index) => {
      const date = shiftDate(selectedDate, index - 6)
      const actions = data.actions.filter((item) => item.date === date && item.memberId === selectedMember.id)
      const fetch = actions.filter((item) => item.type === 'fetch').length
      const drink = actions.filter((item) => item.type === 'drink').length
      const restroom = actions.filter((item) => item.type === 'restroom').length
      return {
        date,
        fetch,
        drink,
        restroom,
        volume: fetch * selectedMember.cupCapacity,
      }
    })
  }, [data.actions, selectedDate, selectedMember])
  const summaryFetchTotal = summaryRows.reduce((total, row) => total + row.fetch, 0)
  const summaryRestroomTotal = summaryRows.reduce((total, row) => total + row.restroom, 0)
  const summaryVolumeTotal = summaryRows.reduce((total, row) => total + row.volume, 0)

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

  function record(type: ActionType) {
    if (!selectedMember || !canRecord) return
    const now = new Date()
    const action: WaterAction = {
      id: uid('action'),
      memberId: selectedMember.id,
      type,
      date: selectedDate,
      time: now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
      createdAt: Date.now(),
    }
    apiRequest<WaterAction>('/api/actions', {
      method: 'POST',
      body: JSON.stringify(action),
    }).then((savedAction) => {
      setData((previous) => ({ ...previous, actions: [...previous.actions, savedAction] }))
      setLastAction(savedAction)
      setActionBurst({ type, id: savedAction.id })
      window.setTimeout(() => {
        setActionBurst((current) => current?.id === savedAction.id ? null : current)
      }, 720)
      setRequestError('')
    }).catch(() => {
      setRequestError('这次记录没有保存成功，请稍后再试')
    })
  }

  async function undoLastAction() {
    if (!lastAction) return
    try {
      await apiRequest<void>(`/api/actions/${encodeURIComponent(lastAction.id)}`, { method: 'DELETE' })
      setData((previous) => ({
        ...previous,
        actions: previous.actions.filter((item) => item.id !== lastAction.id),
      }))
      setLastAction(null)
      setActionBurst(null)
    } catch {
      setRequestError('撤销没有保存成功，请稍后再试')
    }
  }

  function resetDay() {
    if (!canRecord || !selectedActions.length) return
    setShowResetConfirm(true)
  }

  async function confirmResetDay() {
    if (!selectedMember) return
    const memberId = selectedMember.id
    try {
      await apiRequest<void>(`/api/actions?memberId=${encodeURIComponent(memberId)}&date=${encodeURIComponent(selectedDate)}`, { method: 'DELETE' })
      setData((previous) => ({
        ...previous,
        actions: previous.actions.filter((item) => item.date !== selectedDate || item.memberId !== memberId),
      }))
      setLastAction(null)
      setShowResetConfirm(false)
    } catch {
      setRequestError('重置没有保存成功，请稍后再试')
    }
  }

  if (isLoading) return <AppLoading />
  if (!data.currentUser) return <LoginScreen onLogin={login} serverError={requestError} />
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
                  <span className="card-kicker"><span>✦</span> {selectedMember.name} 的今日水站</span>
                  <h2>今天接了几杯水？</h2>
                </div>
                <div className="hydrate-card__tools">
                  <div className="capacity-display" aria-label={`每杯容量 ${selectedMember.cupCapacity} 毫升`}>
                    <span className="capacity-display__cup" aria-hidden="true">🥛</span>
                    <span className="capacity-display__copy">
                      <small>我的水杯容量</small>
                      <strong>{selectedMember.cupCapacity}<em> ml</em></strong>
                      <small>每杯 · 接水目标 8 次</small>
                    </span>
                  </div>
                  <button
                    className="reset-button reset-button--card"
                    onClick={resetDay}
                    disabled={!canRecord || !selectedActions.length}
                    title={!canRecord ? '只能重置当前登录账号的记录' : '清空当前日期自己的记录'}
                  >
                    重置本日
                  </button>
                  {!canRecord && <span className="readonly-badge">只读</span>}
                </div>
              </div>

              <div className="hydrate-overview">
                <div className="progress-wrap">
                  <div
                    className="progress-ring"
                    style={{ '--progress': `${progress * 3.6}deg` } as React.CSSProperties}
                  >
                    <div className="progress-ring__inside">
                      <span className="progress-drop">💧</span>
                      <strong>{fetchCount}<small>/ 8</small></strong>
                      <span>接水次数</span>
                    </div>
                  </div>
                  <p>{progress >= 100 ? '接水目标达成，想喝还可以继续接！' : progress >= 50 ? '已经过半，继续保持呀' : '慢慢来，接一杯就算数'}</p>
                </div>

                <div className="action-zone">
                  <p className="action-zone__hint">轻轻点一下，记下这一刻</p>
                  <div className="action-grid">
                    <button className={`water-action water-action--fetch ${actionBurst?.type === 'fetch' ? 'water-action--burst' : ''}`} onClick={() => record('fetch')} disabled={!canRecord} title={!canRecord ? '只能记录当前登录账号' : undefined}>
                      <span className="water-action__icon"><span>＋</span>🚰</span>
                      <span className="water-action__copy">
                        <small>刚刚去</small>
                        <strong>接水啦</strong>
                      </span>
                      <span className="water-action__count">{fetchCount}<small> 次</small></span>
                      {actionBurst?.type === 'fetch' && <span className="water-action__particles" key={actionBurst.id} aria-hidden="true"><i>✦</i><i>💧</i><i>·</i></span>}
                    </button>
                    <button className={`water-action water-action--drink ${actionBurst?.type === 'drink' ? 'water-action--burst' : ''}`} onClick={() => record('drink')} disabled={!canRecord} title={!canRecord ? '只能记录当前登录账号' : undefined}>
                      <span className="water-action__icon"><span>＋</span>🥛</span>
                      <span className="water-action__copy">
                        <small>咕噜咕噜</small>
                        <strong>喝水啦</strong>
                      </span>
                      <span className="water-action__count">{drinkCount}<small> 次</small></span>
                      {actionBurst?.type === 'drink' && <span className="water-action__particles" key={actionBurst.id} aria-hidden="true"><i>♡</i><i>✦</i><i>·</i></span>}
                    </button>
                    <button className={`water-action water-action--restroom ${actionBurst?.type === 'restroom' ? 'water-action--burst' : ''}`} onClick={() => record('restroom')} disabled={!canRecord} title={!canRecord ? '只能记录当前登录账号' : undefined}>
                      <span className="water-action__icon"><span>＋</span>🚻</span>
                      <span className="water-action__copy">
                        <small>轻松一下</small>
                        <strong>上厕所啦</strong>
                      </span>
                      <span className="water-action__count">{restroomCount}<small> 次</small></span>
                      {actionBurst?.type === 'restroom' && <span className="water-action__particles" key={actionBurst.id} aria-hidden="true"><i>✦</i><i>◌</i><i>·</i></span>}
                    </button>
                  </div>
                  <div className="cup-trail" aria-label={`今日接水进度 ${fetchCount}/8`}>
                    {Array.from({ length: 8 }).map((_, index) => (
                      <span key={index} className={index < fetchCount ? 'is-full' : ''}>
                        {index < fetchCount ? '●' : '○'}
                      </span>
                    ))}
                    <small>{fetchCount >= 8 ? '接够啦，喝水不限次' : `再接 ${8 - fetchCount} 次就收集满啦`}</small>
                  </div>
                </div>
              </div>
            </section>

            <WaterRhythmChart actions={selectedActions} />

          </div>

          <aside className="dashboard-side">
            <section className="side-notes" aria-label="温馨提醒和今日小纸条">
              <section className="love-note-card">
                <span className="tape" aria-hidden="true" />
                <span className="note-doodle note-doodle--heart">♡</span>
                <span className="note-doodle note-doodle--spark">✦</span>
                <p>今日小纸条</p>
                <blockquote>“水要慢慢喝，<br />喜欢要一直在。”</blockquote>
                <div className="note-footer">
                  <span className="mini-avatars">
                    {data.members.slice(0, 3).map((member) => <i key={member.id} style={{ background: member.color }}>{member.emoji}</i>)}
                  </span>
                  <span>一起好好生活</span>
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
                      <span className="team-name"><strong>{member.name}</strong><small>{member.id === currentUserMember?.id ? '本人' : '成员'}</small></span>
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
                <div><strong>{summaryFetchTotal}</strong><span>接水次数</span></div>
                <div><strong>{summaryVolumeTotal}<small> ml</small></strong><span>估算饮水量</span></div>
                <div><strong>{summaryRestroomTotal}</strong><span>上厕所次数</span></div>
              </div>
              <p className="summary-note">按 {selectedMember.cupCapacity} ml / 杯估算，每接一杯就记入容量。</p>
              <div className="summary-list">
                {summaryRows.map((row) => (
                  <div className={`summary-row ${row.date === selectedDate ? 'is-selected' : ''}`} key={row.date}>
                    <div className="summary-date">
                      <strong>{row.date === localDateKey() ? '今天' : formatMonthDay(row.date)}</strong>
                      <small>{formatWeekday(row.date)}</small>
                    </div>
                    <div className="summary-row__counts">
                      <span><i>🚰</i>{row.fetch}</span>
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

      {lastAction && (
        <div className="toast" key={lastAction.id} role="status">
          <span>{lastAction.type === 'fetch' ? '🚰' : lastAction.type === 'drink' ? '💧' : '🚻'}</span>
          <div><strong>记好啦！</strong><small>{lastAction.type === 'fetch' ? '接水次数 +1' : lastAction.type === 'drink' ? '喝水次数 +1' : '上厕所次数 +1'}</small></div>
          <button onClick={undoLastAction}>撤销</button>
          <button className="toast-close" aria-label="关闭提示" onClick={() => setLastAction(null)}>×</button>
        </div>
      )}

      {showAddMember && <AddMemberModal onClose={() => setShowAddMember(false)} onAdd={addMember} />}
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
