import type { BarberDto, DayOverviewDto, ServiceDto, SlotBookingDto, SlotDto, SlotStatus } from './types'

export const mockBarbers: BarberDto[] = [
  { id: 1, name: 'Jasur', nameRu: 'Жасур', nameUz: 'Jasur' },
  { id: 2, name: 'Bobur', nameRu: 'Бобур', nameUz: 'Bobur' },
  { id: 3, name: 'Sardor', nameRu: 'Сардор', nameUz: 'Sardor' },
]

export const mockServices: ServiceDto[] = [
  { id: 1, nameRu: 'Мужская стрижка', nameUz: 'Erkaklar soch turmagi', price: 100000, durationMin: 30 },
  { id: 2, nameRu: 'Стрижка + борода', nameUz: 'Soch turmagi + soqol', price: 150000, durationMin: 60 },
  { id: 3, nameRu: 'Детская стрижка', nameUz: 'Bolalar soch turmagi', price: 80000, durationMin: 30 },
]

interface MockBooking extends SlotBookingDto {
  createdAt: string
}

const sampleBookings: MockBooking[] = [
  {
    id: 101, clientTelegramId: '491003221', clientName: 'Тимур', clientPhone: '+998 90 123 45 67',
    serviceId: 2, service: mockServices[1], startTime: '', endTime: '', finalPrice: 127500, discountPercent: 15,
    status: 'CONFIRMED', note: 'Пожелание: покороче по бокам', barber: mockBarbers[0],
    createdAt: '2026-11-23T12:30:00.000Z',
  },
  {
    id: 102, clientTelegramId: '491003222', clientName: 'Azizbek', clientPhone: null,
    serviceId: 1, service: mockServices[0], startTime: '', endTime: '', finalPrice: 100000, discountPercent: 0,
    status: 'CONFIRMED', note: null, barber: mockBarbers[1],
    createdAt: '2026-11-23T13:00:00.000Z',
  },
  {
    id: 103, clientTelegramId: 'BARBER', clientName: null, clientPhone: null,
    serviceId: null, service: null, startTime: '', endTime: '', finalPrice: 0, discountPercent: 0,
    status: 'BLOCKED_BY_BARBER', note: 'Обед', barber: mockBarbers[0], createdAt: '2026-11-23T08:00:00.000Z',
  },
]

function tashkentIso(date: string, hour: number, minute: number) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, hour - 5, minute)).toISOString()
}

function timeMinutes(iso: string) { return new Date(iso).getTime() }

function makeBooking(id: number, date: string, start: string, end: string): SlotBookingDto {
  const item = sampleBookings.find((booking) => booking.id === id)!
  const { createdAt: _createdAt, ...booking } = item
  return { ...booking, startTime: tashkentIso(date, Number(start.slice(0, 2)), Number(start.slice(3))), endTime: tashkentIso(date, Number(end.slice(0, 2)), Number(end.slice(3))) }
}

export function mockDay(date: string, barberId?: number): DayOverviewDto {
  const appointments: SlotBookingDto[] = [
    makeBooking(101, date, '11:00', '12:00'),
    makeBooking(102, date, '13:00', '13:30'),
    makeBooking(103, date, '12:30', '13:00'),
  ]
  const slots: SlotDto[] = []
  for (let minutes = 10 * 60; minutes <= 20 * 60 + 30; minutes += 30) {
    const hour = Math.floor(minutes / 60)
    const minute = minutes % 60
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    const startTimeIso = tashkentIso(date, hour, minute)
    const start = timeMinutes(startTimeIso)
    const end = start + 30 * 60_000
    const statuses = mockBarbers.map((barber) => {
      const booking = appointments.find((item) => item.barber?.id === barber.id && timeMinutes(item.startTime) < end && timeMinutes(item.endTime) > start)
      return { barber, booking, status: (booking?.status ?? 'FREE') as SlotStatus }
    })
    const freeBarberIds = statuses.filter((state) => state.status === 'FREE').map((state) => state.barber.id)
    const selected = barberId ? statuses.find((state) => state.barber.id === barberId) : undefined
    const busy = selected ?? statuses.find((state) => state.booking)
    const status: SlotStatus = barberId ? selected?.status ?? 'FREE' : freeBarberIds.length ? 'FREE' : busy?.status ?? 'FREE'
    const shownBooking = status === 'FREE' ? null : busy?.booking ?? null
    const [year, month, day] = date.split('-').map(Number)
    const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()
    const inDeadHours = weekday >= 1 && weekday <= 4 && minutes >= 10 * 60 && minutes < 15 * 60
    const primeTime = (weekday === 5 && minutes >= 16 * 60) || weekday === 6 || weekday === 0
    const offer = inDeadHours
      ? { canDiscount: true, maxDiscountPercent: 15, bonus: 'Free hair wash & styling', reason: 'Dead hours (Mon-Thu 10:00-14:59 Asia/Tashkent)' }
      : primeTime
        ? { canDiscount: false, maxDiscountPercent: 0, bonus: 'Free coffee or tea', reason: 'Prime time (Fri from 16:00, Sat, Sun Asia/Tashkent)' }
        : { canDiscount: false, maxDiscountPercent: 0, bonus: null, reason: 'No discount for this time. Move to Mon-Thu 10:00-15:00 (Asia/Tashkent) for up to 15% off.' }
    slots.push({
      time, startTimeIso, status, booking: shownBooking,
      barber: barberId ? selected?.barber ?? null : null,
      freeBarberIds,
      ...(!barberId ? { barberStatuses: statuses.map(({ barber, status: slotStatus }) => ({ barberId: barber.id, barberName: barber.name, status: slotStatus })) } : {}),
      offer,
    })
  }
  return { date, timezone: 'Asia/Tashkent', slots }
}
