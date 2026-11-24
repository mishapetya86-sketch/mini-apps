import type { Language } from '../i18n'
import type { SlotBookingDto, SlotDto } from '../api/types'

const TASHKENT = 'Asia/Tashkent'
const SLOT_MS = 30 * 60 * 1000

export function formatMoney(amount: number, _lang: Language): string {
  const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount).replace(/,/g, '\u2009')
  return `${number} so'm`
}

export function formatTashkentTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TASHKENT, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso))
}

export interface MergedSlot { slot: SlotDto; booking: SlotBookingDto | null; spanSlots: number }

/** Collapse the API's repeated booking-on-each-overlapping-slot response into one card. */
export function mergeSlots(slots: SlotDto[]): MergedSlot[] {
  const merged: MergedSlot[] = []
  const seen = new Set<number>()
  for (let index = 0; index < slots.length;) {
    const slot = slots[index]
    const booking = slot.booking
    if (booking && seen.has(booking.id)) { index += 1; continue }
    const spanSlots = booking ? Math.max(1, Math.round((Date.parse(booking.endTime) - Date.parse(booking.startTime)) / SLOT_MS)) : 1
    if (booking) seen.add(booking.id)
    merged.push({ slot, booking, spanSlots })
    index += booking ? Math.min(spanSlots, slots.length - index) : 1
  }
  return merged
}

export function confirmedBookingIds(slots: SlotDto[]): Set<number> {
  return new Set(slots.flatMap(({ booking }) => booking?.status === 'CONFIRMED' ? [booking.id] : []))
}

export function findNewBookings(previousIds: Set<number>, slots: SlotDto[]): SlotBookingDto[] {
  const found = new Map<number, SlotBookingDto>()
  for (const { booking } of slots) {
    if (booking?.status === 'CONFIRMED' && !previousIds.has(booking.id)) found.set(booking.id, booking)
  }
  return [...found.values()]
}
