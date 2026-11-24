import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Check, Clock3, Phone, Scissors, Sparkles, UserRound, X } from 'lucide-react'
import { api, ApiError } from '../api/client'
import { mockBarbers, mockDay } from '../api/mock'
import type { BarberDto, DayOverviewDto, SlotDto, SlotBookingDto } from '../api/types'
import { strings, type Language } from '../i18n'
import { initData, telegram, telegramLanguage } from '../lib/telegram'
import { confirmedBookingIds, findNewBookings, formatMoney, formatTashkentTime, mergeSlots } from '../lib/schedule-utils'

const mockEnabled = import.meta.env.DEV && import.meta.env.VITE_MOCK === 'true'
const zone = 'Asia/Tashkent'

function tashkentDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

function shiftDate(date: string, by: number) {
  const [year, month, day] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + by, 12))
  return shifted.toISOString().slice(0, 10)
}

function dateLabel(date: string, lang: Language) {
  const [year, month, day] = date.split('-').map(Number)
  return new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'uz-UZ', { timeZone: zone, day: 'numeric', month: 'long' }).format(new Date(Date.UTC(year, month - 1, day, 12)))
}

function dayName(date: string, lang: Language) {
  const [year, month, day] = date.split('-').map(Number)
  return new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'uz-UZ', { timeZone: zone, weekday: 'long' }).format(new Date(Date.UTC(year, month - 1, day, 12)))
}

function bookingTime(booking: SlotBookingDto) {
  return `${formatTashkentTime(booking.startTime)} — ${formatTashkentTime(booking.endTime)}`
}

function useMinuteClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function bookingFrom(slot: SlotDto): SlotBookingDto | null { return slot.booking }

interface ScheduleSnapshot {
  overview: DayOverviewDto
  barbers: BarberDto[]
  isOwner: boolean
  masterDays: Record<number, DayOverviewDto>
}

type SheetState =
  | { kind: 'block'; slot: SlotDto; barberIds: number[] }
  | { kind: 'unblock'; booking: SlotBookingDto }
  | { kind: 'details'; booking: SlotBookingDto }
  | null

function updateDayBooking(day: DayOverviewDto | null, barberId: number, replacement: SlotBookingDto | null, previous?: SlotBookingDto): DayOverviewDto | null {
  if (!day) return day
  const target = replacement ?? previous
  if (!target) return day
  const start = Date.parse(target.startTime)
  const end = Date.parse(target.endTime)
  return {
    ...day,
    slots: day.slots.map((slot) => {
      const time = Date.parse(slot.startTimeIso)
      if (time < start || time >= end) return slot
      const free = new Set(slot.freeBarberIds)
      if (replacement) free.delete(barberId)
      else free.add(barberId)
      const nextStatus: SlotDto['status'] = replacement && replacement.status !== 'CANCELLED' ? replacement.status : 'FREE'
      const activeReplacement = replacement?.status === 'CANCELLED' ? null : replacement
      const barberStatuses = slot.barberStatuses?.map((item) => item.barberId === barberId
        ? { ...item, status: nextStatus }
        : item)
      const aggregateStatus = free.size ? 'FREE' as const : barberStatuses?.find((item) => item.status !== 'FREE')?.status ?? nextStatus
      return {
        ...slot,
        status: barberStatuses ? aggregateStatus : nextStatus,
        booking: barberStatuses ? (aggregateStatus === 'FREE' ? null : activeReplacement ?? slot.booking) : activeReplacement,
        freeBarberIds: [...free],
        ...(barberStatuses ? { barberStatuses } : {}),
      }
    }),
  }
}

export default function App() {
  const [lang, setLang] = useState<Language>(telegramLanguage())
  const [date, setDate] = useState(() => tashkentDate())
  const [barbers, setBarbers] = useState<BarberDto[]>([])
  const [day, setDay] = useState<DayOverviewDto | null>(null)
  const [masterDays, setMasterDays] = useState<Record<number, DayOverviewDto>>({})
  const [isOwner, setIsOwner] = useState(false)
  const [selectedBarber, setSelectedBarber] = useState<number | 'all' | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<'access' | 'network' | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [sheet, setSheet] = useState<SheetState>(null)
  const [blockDuration, setBlockDuration] = useState(30)
  const [blockNote, setBlockNote] = useState('')
  const [blockTargetId, setBlockTargetId] = useState<number | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [highlightedBookings, setHighlightedBookings] = useState<Set<number>>(new Set())
  const now = useMinuteClock()
  const nowRow = useRef<HTMLDivElement>(null)
  const pollingRef = useRef(false)
  const actionBusyRef = useRef(false)
  const previousBookingsRef = useRef<{ date: string; ids: Set<number> } | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const highlightTimerRef = useRef<number | null>(null)
  const t = strings[lang]
  const today = tashkentDate(now)
  const isToday = date === today
  const timeFormatter = useMemo(() => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), [])

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(''), 3500)
  }, [])

  const fetchSnapshot = useCallback(async (): Promise<ScheduleSnapshot> => {
    if (mockEnabled) {
      const mock = mockDay(date, 1)
      return { overview: mock, barbers: mockBarbers, isOwner: false, masterDays: { 1: mock } }
    }
    if (!import.meta.env.VITE_API_BASE_URL) throw new Error('API base URL is not configured')
    const [overview, list] = await Promise.all([api.day({ date }), api.barbers()])
    const owner = overview.slots[0]?.barber == null
    const entries = owner
      ? await Promise.all(list.map(async (barber) => [barber.id, await api.day({ date, barberId: barber.id })] as const))
      : []
    return { overview, barbers: list, isOwner: owner, masterDays: Object.fromEntries(entries) }
  }, [date])

  const applySnapshot = useCallback((snapshot: ScheduleSnapshot) => {
    setDay(snapshot.overview)
    setBarbers(snapshot.barbers)
    setIsOwner(snapshot.isOwner)
    setMasterDays(snapshot.masterDays)
    setSelectedBarber((current) => snapshot.isOwner ? current ?? 'all' : null)
  }, [])

  const loadDay = useCallback(async () => {
    setLoading(true)
    setFailure(null)
    try {
      const snapshot = await fetchSnapshot()
      applySnapshot(snapshot)
      const allSlots = snapshot.isOwner ? Object.values(snapshot.masterDays).flatMap((item) => item.slots) : snapshot.overview.slots
      previousBookingsRef.current = { date, ids: confirmedBookingIds(allSlots) }
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) setFailure('access')
      else setFailure('network')
    } finally { setLoading(false) }
  }, [applySnapshot, date, fetchSnapshot, retryKey])

  const pollDay = useCallback(async () => {
    if (mockEnabled || loading || failure || actionBusyRef.current || document.visibilityState === 'hidden' || pollingRef.current) return
    pollingRef.current = true
    try {
      const snapshot = await fetchSnapshot()
      if (actionBusyRef.current) return
      const allSlots = snapshot.isOwner ? Object.values(snapshot.masterDays).flatMap((item) => item.slots) : snapshot.overview.slots
      const previous = previousBookingsRef.current
      const fresh = previous?.date === date ? findNewBookings(previous.ids, allSlots) : []
      previousBookingsRef.current = { date, ids: confirmedBookingIds(allSlots) }
      applySnapshot(snapshot)
      if (fresh.length) {
        const booking = fresh[0]
        const serviceName = lang === 'ru' ? booking.service?.nameRu : booking.service?.nameUz
        const message = `${t.newBooking}: ${serviceName ?? ''}, ${formatTashkentTime(booking.startTime)}${booking.discountPercent ? `, −${booking.discountPercent}%` : ''}`
        showToast(message)
        setHighlightedBookings(new Set(fresh.map((item) => item.id)))
        if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current)
        highlightTimerRef.current = window.setTimeout(() => setHighlightedBookings(new Set()), 5000)
        telegram()?.HapticFeedback?.notificationOccurred('success')
      }
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) setFailure('access')
      else setFailure('network')
    } finally { pollingRef.current = false }
  }, [applySnapshot, date, failure, fetchSnapshot, lang, loading, showToast, t.newBooking])

  useEffect(() => { void loadDay() }, [loadDay])
  useEffect(() => {
    if (mockEnabled || loading || failure) return
    const interval = window.setInterval(() => { void pollDay() }, 5000)
    const onVisibility = () => { if (document.visibilityState === 'visible') void pollDay() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
    }
  }, [failure, loading, pollDay])
  useEffect(() => { if (!loading && isToday) nowRow.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [loading, date, isToday])
  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current)
  }, [])
  useEffect(() => {
    if (!sheet) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !actionBusy) setSheet(null) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [actionBusy, sheet])

  const selectedDay = selectedBarber && selectedBarber !== 'all' ? masterDays[selectedBarber] ?? day : day
  const summaryBookings = useMemo(() => {
    const sourceDays = isOwner && selectedBarber === 'all' ? Object.values(masterDays) : selectedDay ? [selectedDay] : []
    const unique = new Map<number, SlotBookingDto>()
    for (const item of sourceDays.flatMap((source) => source.slots)) {
      const booking = bookingFrom(item)
      if (booking?.status === 'CONFIRMED') unique.set(booking.id, booking)
    }
    return [...unique.values()]
  }, [isOwner, masterDays, selectedBarber, selectedDay])

  const selectedName = selectedBarber && selectedBarber !== 'all' ? barbers.find((barber) => barber.id === selectedBarber)?.[lang === 'ru' ? 'nameRu' : 'nameUz'] ?? barbers.find((barber) => barber.id === selectedBarber)?.name : null

  const optimisticallyChange = (barberId: number, replacement: SlotBookingDto | null, previous?: SlotBookingDto) => {
    setDay((current) => updateDayBooking(current, barberId, replacement, previous))
    setMasterDays((current) => {
      const target = current[barberId]
      return target ? { ...current, [barberId]: updateDayBooking(target, barberId, replacement, previous)! } : current
    })
  }

  const friendlyActionError = (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.status === 409) return t.conflict
      if (error.status === 400) return t.validation
      if (error.status >= 500) return t.serverError
    }
    return t.actionError
  }

  const finishAction = async (message: string, shouldRefresh: boolean) => {
    setSheet(null)
    setConfirmCancel(false)
    showToast(message)
    telegram()?.HapticFeedback?.notificationOccurred('success')
    if (shouldRefresh) await loadDay()
  }

  const submitBlock = async () => {
    if (sheet?.kind !== 'block' || blockTargetId === null || actionBusy) return
    const targetBarber = barbers.find((barber) => barber.id === blockTargetId)
    const { slot } = sheet
    const previousDay = day
    const previousMasters = masterDays
    const booking: SlotBookingDto = {
      id: -Date.now(), clientTelegramId: 'BARBER', clientName: null, clientPhone: null,
      serviceId: null, service: null, startTime: slot.startTimeIso,
      endTime: new Date(Date.parse(slot.startTimeIso) + blockDuration * 60_000).toISOString(),
      finalPrice: 0, discountPercent: 0, status: 'BLOCKED_BY_BARBER', note: blockNote.trim() || null,
      barber: targetBarber ?? slot.barber,
    }
    setActionBusy(true)
    actionBusyRef.current = true
    optimisticallyChange(blockTargetId, booking)
    try {
      if (!mockEnabled) await api.block({ barberId: blockTargetId, startTimeIso: slot.startTimeIso, durationMin: blockDuration, ...(blockNote.trim() ? { note: blockNote.trim() } : {}) })
      setBlockNote('')
      setBlockDuration(30)
      await finishAction(t.blockedSuccess, !mockEnabled)
    } catch (error) {
      setDay(previousDay)
      setMasterDays(previousMasters)
      const message = friendlyActionError(error)
      await loadDay()
      showToast(message)
    } finally { actionBusyRef.current = false; setActionBusy(false) }
  }

  const submitUnblock = async () => {
    if (sheet?.kind !== 'unblock' || actionBusy) return
    const { booking } = sheet
    const barberId = booking.barber?.id ?? (typeof selectedBarber === 'number' ? selectedBarber : null)
    if (barberId === null) return
    const previousDay = day
    const previousMasters = masterDays
    setActionBusy(true)
    actionBusyRef.current = true
    optimisticallyChange(barberId, null, booking)
    try {
      if (!mockEnabled) await api.unblock(booking.id, barberId)
      await finishAction(t.unblockedSuccess, !mockEnabled)
    } catch (error) {
      setDay(previousDay)
      setMasterDays(previousMasters)
      const message = friendlyActionError(error)
      await loadDay()
      showToast(message)
    } finally { actionBusyRef.current = false; setActionBusy(false) }
  }

  const submitCancel = async () => {
    if (sheet?.kind !== 'details' || actionBusy) return
    const { booking } = sheet
    const barberId = booking.barber?.id ?? (typeof selectedBarber === 'number' ? selectedBarber : null)
    if (barberId === null) return
    const previousDay = day
    const previousMasters = masterDays
    setActionBusy(true)
    actionBusyRef.current = true
    optimisticallyChange(barberId, null, booking)
    try {
      if (!mockEnabled) await api.cancel(booking.id)
      await finishAction(t.cancelledSuccess, !mockEnabled)
    } catch (error) {
      setDay(previousDay)
      setMasterDays(previousMasters)
      const message = friendlyActionError(error)
      await loadDay()
      showToast(message)
    } finally { actionBusyRef.current = false; setActionBusy(false) }
  }

  const openBlockSheet = (slot: SlotDto, barberIds: number[]) => {
    const selectedId = typeof selectedBarber === 'number' ? selectedBarber : barberIds.length === 1 ? barberIds[0] : null
    setBlockTargetId(selectedId)
    setBlockDuration(30)
    setBlockNote('')
    setSheet({ kind: 'block', slot, barberIds })
  }

  const openBookingSheet = (booking: SlotBookingDto) => {
    setConfirmCancel(false)
    setSheet({ kind: booking.status === 'BLOCKED_BY_BARBER' ? 'unblock' : 'details', booking })
  }

  if (!mockEnabled && !initData() && !failure && loading) return <main className="state-screen"><div className="brand-mark"><Scissors size={22} /></div><p className="overline">SAVDO<span>AI</span></p><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-copy" /><div className="skeleton skeleton-panel" /></main>
  if (failure) return <main className="state-screen"><div className="brand-mark"><Scissors size={22} /></div><p className="overline">SAVDO<span>AI</span></p><h1>{failure === 'access' ? t.authTitle : t.errorTitle}</h1><p>{failure === 'access' ? t.authText : t.errorText}</p>{failure === 'network' && <button className="retry" onClick={() => setRetryKey((key) => key + 1)}>{t.retry}</button>}<LanguageSwitch lang={lang} setLang={setLang} /></main>

  const slots = selectedDay?.slots ?? []
  const currentMins = Number(timeFormatter.format(now).slice(0, 2)) * 60 + Number(timeFormatter.format(now).slice(3))
  const showAll = isOwner && selectedBarber === 'all'
  const displayBookings = summaryBookings
  const revenue = displayBookings.reduce((sum, booking) => sum + booking.finalPrice, 0)
  const discountCount = displayBookings.filter((booking) => booking.discountPercent > 0).length

  const renderSingleRows = () => {
    return mergeSlots(slots).map(({ slot, booking, spanSlots }) => {
      const startMin = Number(slot.time.slice(0, 2)) * 60 + Number(slot.time.slice(3))
      const atNow = isToday && currentMins >= startMin && currentMins < startMin + 30
      const past = startMin + 30 <= currentMins && isToday
      return <div className={`timeline-row ${past ? 'past' : ''} ${booking ? `row-${booking.status.toLowerCase()}` : 'row-free'}`} key={slot.startTimeIso} ref={atNow ? nowRow : undefined} style={{ minHeight: `${spanSlots * 70}px` }}>
        {atNow && <div className="now-marker"><i />{t.now}</div>}
        <div className="time-cell">{slot.time}</div>
        {booking ? <BookingBlock booking={booking} lang={lang} t={t} highlighted={highlightedBookings.has(booking.id)} onClick={() => openBookingSheet(booking)} /> : <button className="free-slot" type="button" disabled={past} onClick={() => openBlockSheet(slot, slot.freeBarberIds)}><span>{t.free}</span><span className="block-affordance">{t.block}</span></button>}
      </div>
    })
  }

  return <main className="app-shell schedule-app">
    <header className="topbar"><a className="wordmark" href="#"><span className="brand-mark"><Scissors size={17} /></span>SAVDO<span>AI</span></a><div className="top-actions"><span className="live"><i /> {mockEnabled ? 'DEMO' : 'LIVE'}</span><LanguageSwitch lang={lang} setLang={setLang} /></div></header>
    <section className="welcome schedule-welcome"><p className="overline">{t.eyebrow} <span className="date-label">· {dateLabel(date, lang).toLocaleUpperCase(lang === 'ru' ? 'ru-RU' : 'uz-UZ')}</span></p><h1>{t.title}<br /><em>{mockEnabled ? t.fakeName : selectedName ?? (telegram()?.initDataUnsafe?.user?.first_name ?? '')}</em></h1><p className="welcome-sub">{dayName(date, lang)} · {dateLabel(date, lang)}</p>
      <div className="date-control"><button className={`date-pill ${date === today ? 'selected' : ''}`} onClick={() => setDate(today)}><CalendarDays size={15} />{t.today}</button><button className={`date-pill ${date === shiftDate(today, 1) ? 'selected' : ''}`} onClick={() => setDate(shiftDate(today, 1))}>{t.tomorrow}</button><label className="date-picker" aria-label={t.chooseDate}><input type="date" value={date} min={today} onChange={(event) => event.target.value && setDate(event.target.value)} /><CalendarDays size={16} /></label></div>
    </section>
    {isOwner && <nav className="master-switcher" aria-label={t.barber}><button className={`master-chip ${selectedBarber === 'all' ? 'selected' : ''}`} onClick={() => setSelectedBarber('all')}>{t.all}</button>{barbers.map((barber) => <button key={barber.id} className={`master-chip ${selectedBarber === barber.id ? 'selected' : ''}`} onClick={() => setSelectedBarber(barber.id)}><UserRound size={13} />{barber[lang === 'ru' ? 'nameRu' : 'nameUz'] ?? barber.name}</button>)}</nav>}
    <section className="summary"><article className="summary-card"><span className="summary-icon"><Scissors size={16} /></span><strong>{displayBookings.length}</strong><span>{t.bookings}</span><small><Check size={12} /> {t.discounted}: {discountCount}</small></article><article className="summary-card revenue-card"><span className="summary-icon"><Sparkles size={16} /></span><strong>{formatMoney(revenue, lang)}</strong><span>{t.expected}</span><small className="muted">UZS</small></article></section>
    <section className="schedule-section"><div className="section-heading"><div><p className="overline">{date}</p><h2>{t.schedule}{selectedName ? ` · ${selectedName}` : ''}</h2></div><span className="hours"><Clock3 size={14} /> 10:00 — 21:00</span></div>
      {loading ? <div className="loading-list" aria-label="Loading">{Array.from({ length: 5 }, (_, index) => <div className="skeleton skeleton-slot" key={index} />)}</div> : slots.length ? <div className={`timeline ${showAll ? 'aggregate-timeline' : ''}`}>{showAll ? slots.map((slot) => <AggregateRow key={slot.startTimeIso} slot={slot} barbers={barbers} masterDays={masterDays} highlightedBookings={highlightedBookings} lang={lang} isToday={isToday} now={now} t={t} onFree={() => openBlockSheet(slot, slot.freeBarberIds)} onBooking={openBookingSheet} />) : renderSingleRows()}</div> : <div className="empty-state"><div className="empty-art"><div className="sun-glow" /><div className="empty-icon"><CalendarDays size={25} /></div></div><h3>{t.emptyTitle}</h3><p>{t.emptyText}</p></div>}
    </section>
    <footer><span className="mock-badge"><i /> {mockEnabled ? 'DEMO · MOCK РЕЖИМ' : 'SAVDOAI'}</span><span>ТАШКЕНТ · UTC+5</span></footer>
    {toast && <div className="toast" role="status"><span>{toast}</span><button aria-label="Close" onClick={() => setToast('')}><X size={15} /></button></div>}
    {sheet && <div className="sheet-backdrop" onMouseDown={() => !actionBusy && setSheet(null)}><section className="action-sheet" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div className="sheet-handle" /><button className="sheet-close" aria-label="Close" onClick={() => !actionBusy && setSheet(null)}><X size={17} /></button>
      {sheet.kind === 'block' && <>
        <p className="overline">{sheet.slot.time} · {date}</p><h2>{t.blockTitle}</h2>
        {sheet.barberIds.length > 1 && <label className="field-label">{t.barber}<select value={blockTargetId ?? ''} onChange={(event) => setBlockTargetId(Number(event.target.value))}><option value="">{lang === 'ru' ? 'Выберите мастера' : 'Ustani tanlang'}</option>{sheet.barberIds.map((id) => { const barber = barbers.find((item) => item.id === id); return <option value={id} key={id}>{barber?.[lang === 'ru' ? 'nameRu' : 'nameUz'] ?? barber?.name ?? id}</option> })}</select></label>}
        <div className="field-label">{t.duration}<div className="choice-row">{[30, 60, 90].map((minutes) => <button key={minutes} className={blockDuration === minutes ? 'choice selected' : 'choice'} onClick={() => setBlockDuration(minutes)}>{minutes} {lang === 'ru' ? 'мин' : 'daq'}</button>)}</div></div>
        <div className="field-label">{t.noteLabel}<input maxLength={120} value={blockNote} placeholder={t.notePlaceholder} onChange={(event) => setBlockNote(event.target.value)} /><div className="quick-row"><button onClick={() => setBlockNote(t.quickLunch)}>{t.quickLunch}</button><button onClick={() => setBlockNote(t.walkin)}>{t.walkin}</button><button onClick={() => setBlockNote(t.shortBreak)}>{t.shortBreak}</button></div></div>
        <button className="primary-action" disabled={actionBusy || blockTargetId === null} onClick={() => void submitBlock()}>{actionBusy ? '…' : t.saveBlock}</button>
      </>}
      {sheet.kind === 'unblock' && <><p className="overline">{bookingTime(sheet.booking)}</p><h2>{t.unblock}</h2><p className="sheet-copy">{sheet.booking.note || t.blocked}{sheet.booking.barber ? ` · ${sheet.booking.barber.name}` : ''}</p><button className="primary-action" disabled={actionBusy} onClick={() => void submitUnblock()}>{actionBusy ? '…' : t.unblock}</button></>}
      {sheet.kind === 'details' && <><p className="overline">{t.details}</p><h2>{lang === 'ru' ? sheet.booking.service?.nameRu : sheet.booking.service?.nameUz}</h2><div className="details-list"><Detail label={t.client} value={sheet.booking.clientName || '—'} /><Detail label={t.price} value={formatMoney(sheet.booking.finalPrice, lang)} /><Detail label={t.discount} value={`${sheet.booking.discountPercent}%`} /><Detail label={t.barber} value={sheet.booking.barber?.[lang === 'ru' ? 'nameRu' : 'nameUz'] ?? sheet.booking.barber?.name ?? '—'} /><Detail label={lang === 'ru' ? 'Время' : 'Vaqt'} value={bookingTime(sheet.booking)} />{sheet.booking.clientTelegramId && <Detail label={t.telegramId} value={sheet.booking.clientTelegramId} />}{sheet.booking.note && <Detail label={t.noteLabel} value={sheet.booking.note} />}{sheet.booking.clientConfirmedAt && <Detail label={t.confirmed} value={formatTashkentTime(sheet.booking.clientConfirmedAt)} />}</div>
        {sheet.booking.clientPhone ? <a className="call-action" href={`tel:${sheet.booking.clientPhone}`}><Phone size={16} />{t.call}</a> : <p className="sheet-copy">{t.noPhone}</p>}
        {confirmCancel ? <div className="confirm-box"><p>{t.cancelConfirm}</p><button className="danger-action" disabled={actionBusy} onClick={() => void submitCancel()}>{actionBusy ? '…' : t.confirmCancel}</button><button className="secondary-action" onClick={() => setConfirmCancel(false)}>{t.keepBooking}</button></div> : <button className="danger-action" disabled={actionBusy} onClick={() => setConfirmCancel(true)}>{t.cancelBooking}</button>}
      </>}
    </section></div>}
  </main>
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="detail-row"><span>{label}</span><strong>{value}</strong></div>
}

function LanguageSwitch({ lang, setLang }: { lang: Language; setLang: (lang: Language) => void }) {
  return <div className="language-switch"><button className={lang === 'ru' ? 'active' : ''} onClick={() => setLang('ru')}>РУ</button><button className={lang === 'uz' ? 'active' : ''} onClick={() => setLang('uz')}>UZ</button></div>
}

function BookingBlock({ booking, lang, t, highlighted, onClick }: { booking: SlotBookingDto; lang: Language; t: typeof strings.ru; highlighted: boolean; onClick: () => void }) {
  const blocked = booking.status === 'BLOCKED_BY_BARBER'
  const serviceName = lang === 'ru' ? booking.service?.nameRu : booking.service?.nameUz
  const confirmTime = booking.clientConfirmedAt ? new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(booking.clientConfirmedAt)) : ''
  return <article className={`booking-block ${blocked ? 'blocked' : ''} ${highlighted ? 'new-booking' : ''}`} role="button" tabIndex={0} onClick={onClick} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick() } }}>
    <div className="booking-topline"><strong>{bookingTime(booking)}</strong><span className="booking-badges">{!blocked && booking.clientConfirmedAt && <span className="client-confirmed-mark" title={t.confirmed} aria-label={t.confirmed}><Check size={12} /></span>}{blocked ? <span className="state-tag">{t.blocked}</span> : booking.discountPercent > 0 ? <span className="discount-tag">−{booking.discountPercent}%</span> : null}</span></div>
    <h3>{blocked ? booking.note || t.block : serviceName ?? '—'}</h3>
    {!blocked && <div className="booking-meta"><span>{booking.clientName || '—'}{booking.clientPhone ? ` · ${booking.clientPhone}` : ''}</span><span>{formatMoney(booking.finalPrice, lang)}</span></div>}
    {!blocked && booking.barber && <div className="booking-master">{booking.barber[lang === 'ru' ? 'nameRu' : 'nameUz'] ?? booking.barber.name}</div>}
    {!blocked && booking.note && <div className="booking-note">{booking.note}</div>}
    {!blocked && booking.clientConfirmedAt && <div className="booking-confirmed"><Check size={11} /> {t.confirmed} · {confirmTime}</div>}
  </article>
}

function AggregateRow({ slot, barbers, masterDays, highlightedBookings, lang, isToday, now, t, onFree, onBooking }: { slot: SlotDto; barbers: BarberDto[]; masterDays: Record<number, DayOverviewDto>; highlightedBookings: Set<number>; lang: Language; isToday: boolean; now: Date; t: typeof strings.ru; onFree: () => void; onBooking: (booking: SlotBookingDto) => void }) {
  const mins = Number(slot.time.slice(0, 2)) * 60 + Number(slot.time.slice(3))
  const nowLabel = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  const nowMins = Number(nowLabel.slice(0, 2)) * 60 + Number(nowLabel.slice(3))
  const past = isToday && mins + 30 <= nowMins
  const names = (slot.barberStatuses ?? []).filter((item) => item.status !== 'FREE').map((item) => barbers.find((barber) => barber.id === item.barberId)?.[lang === 'ru' ? 'nameRu' : 'nameUz'] ?? item.barberName)
  const bookingStarts = Object.entries(masterDays).flatMap(([id, day]) => {
    const booking = day.slots.find((item) => item.time === slot.time)?.booking
    return booking?.startTime === slot.startTimeIso ? [{ id: Number(id), booking }] : []
  })
  const atNow = isToday && nowMins >= mins && nowMins < mins + 30
  return <div className={`timeline-row aggregate-row ${past ? 'past' : ''}`}><div className="time-cell">{slot.time}</div><div className="aggregate-slot">{atNow && <div className="now-marker"><i />{t.now}</div>}{slot.freeBarberIds.length ? <button className="aggregate-free" disabled={past} onClick={onFree}>{t.free} · {slot.freeBarberIds.length}/{barbers.length} <span className="block-affordance">{t.block}</span></button> : <span className="aggregate-busy">{names.join(', ') || t.block}</span>}{bookingStarts.map(({ id, booking }) => <button type="button" className={`aggregate-booking ${booking.status === 'BLOCKED_BY_BARBER' ? 'blocked' : ''} ${highlightedBookings.has(booking.id) ? 'new-booking' : ''}`} key={`${id}-${booking.id}`} onClick={() => onBooking(booking)}><strong>{barbers.find((barber) => barber.id === id)?.[lang === 'ru' ? 'nameRu' : 'nameUz'] ?? booking.barber?.name}</strong><span>{booking.status === 'BLOCKED_BY_BARBER' ? booking.note || t.blocked : `${lang === 'ru' ? booking.service?.nameRu : booking.service?.nameUz} · ${booking.clientName || '—'}`}</span>{booking.status === 'CONFIRMED' && <small>{formatMoney(booking.finalPrice, lang)}{booking.discountPercent ? ` · −${booking.discountPercent}%` : ''}</small>}</button>)}{names.length > 0 && slot.freeBarberIds.length > 0 && <small className="aggregate-names">{names.join(', ')} · {t.bookings}</small>}</div></div>
}
