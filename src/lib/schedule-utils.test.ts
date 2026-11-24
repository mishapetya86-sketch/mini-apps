import { describe, expect, it } from 'vitest'
import { mockDay } from '../api/mock'
import { findNewBookings, formatMoney, formatTashkentTime, mergeSlots } from './schedule-utils'

describe('schedule formatting', () => {
  it('formats integer UZS with a thin-space thousands separator', () => {
    expect(formatMoney(85_000, 'ru')).toBe('85\u2009000 so\'m')
  })

  it('formats an ISO instant in Asia/Tashkent', () => {
    expect(formatTashkentTime('2026-11-24T05:00:00.000Z')).toBe('10:00')
  })
})

describe('slot booking merging', () => {
  it('renders a 60-minute booking once across its repeated half-hour slots', () => {
    const slots = mockDay('2026-11-24', 1).slots
    const merged = mergeSlots(slots)
    const booking = merged.find((item) => item.booking?.id === 101)
    expect(booking?.spanSlots).toBe(2)
    expect(merged.filter((item) => item.booking?.id === 101)).toHaveLength(1)
  })
})

describe('new booking diff', () => {
  it('returns newly confirmed bookings once even when they span multiple slots', () => {
    const slots = mockDay('2026-11-24', 1).slots
    const previous = new Set<number>()
    const newlySeen = findNewBookings(previous, slots)
    expect(newlySeen.map((booking) => booking.id)).toContain(101)
    expect(newlySeen.filter((booking) => booking.id === 101)).toHaveLength(1)
    expect(findNewBookings(new Set(newlySeen.map((booking) => booking.id)), slots)).toHaveLength(0)
  })
})
