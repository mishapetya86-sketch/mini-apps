export type SlotStatus = 'FREE' | 'CONFIRMED' | 'BLOCKED_BY_BARBER'
export type BookingStatus = SlotStatus | 'CANCELLED'

export interface ServiceDto {
  id: number
  nameRu: string
  nameUz: string
  price: number
  durationMin: number
}

export interface BarberDto {
  id: number
  name: string
  nameRu: string | null
  nameUz: string | null
}

export interface BarberRecord extends BarberDto {
  telegramId: string | null
  isActive: boolean
  sortOrder: number
}

/** Nullable database fields are also optional for deployments straddling migrations. */
export interface BookingFields {
  id: number
  clientTelegramId: string
  clientName: string | null
  clientPhone: string | null
  clientLang?: 'uz' | 'ru' | null
  serviceId: number | null
  barberId: number | null
  reminderSentAt?: string | null
  clientConfirmedAt?: string | null
  startTime: string
  endTime: string
  finalPrice: number
  discountPercent: number
  status: BookingStatus
  note: string | null
  createdAt: string
}

export interface BookingDto extends BookingFields {
  service?: ServiceDto | null
  barber?: BarberDto | BarberRecord | null
}

/** Booking object mapped explicitly by getSlots; some Prisma columns are not returned. */
export interface SlotBookingDto {
  id: number
  clientTelegramId: string
  clientName: string | null
  clientPhone: string | null
  serviceId: number | null
  service: ServiceDto | null
  startTime: string
  endTime: string
  finalPrice: number
  discountPercent: number
  status: BookingStatus
  note: string | null
  barber: BarberDto | null
  clientLang?: 'uz' | 'ru' | null
  reminderSentAt?: string | null
  clientConfirmedAt?: string | null
}

export interface SlotOfferDto {
  canDiscount: boolean
  maxDiscountPercent: number
  bonus: string | null
  reason: string
}

export interface BarberSlotStatusDto {
  barberId: number
  barberName: string
  status: SlotStatus
}

export interface SlotDto {
  time: string
  startTimeIso: string
  status: SlotStatus
  booking: SlotBookingDto | null
  barber: BarberDto | null
  freeBarberIds: number[]
  /** Omitted when filtering by barberId. */
  barberStatuses?: BarberSlotStatusDto[]
  offer: SlotOfferDto
}

export interface DayOverviewDto {
  date: string
  timezone: 'Asia/Tashkent'
  slots: SlotDto[]
}

export interface SlotsQuery { date?: string; barberId?: number }
export interface BlockSlotRequest {
  barberId: number
  startTimeIso: string
  durationMin?: number
  note?: string
}

/** POST /bookings/block returns a created Booking row without relations. */
export type BlockResponse = BookingFields
/** DELETE /bookings/block/:id?barberId=N returns the deleted row with barber. */
export type UnblockResponse = BookingFields & { barber: BarberRecord }
/** PATCH /bookings/:id/cancel returns the updated row with full service/barber relations. */
export type CancelResponse = BookingFields & { service: ServiceDto | null; barber: BarberRecord | null }

export interface AlternativeSlotDto {
  startTimeIso: string
  time: string
  barberId: number
  barberName: string
  maxDiscountPercent: number
}
export type ConflictErrorBody =
  | { message: string; alternatives: AlternativeSlotDto[]; statusCode?: 409; error?: 'Conflict' }
  | { statusCode: 409; error: 'Conflict'; message: string }
export interface ValidationErrorBody { statusCode: 400; error: 'Bad Request'; message: string | string[] }
export interface AuthErrorBody { statusCode: 401 | 403; error: 'Unauthorized' | 'Forbidden'; message: string | string[] }
export interface HttpErrorBody { statusCode: number; error?: string; message: string | string[] | object }
export type ApiErrorBody = ConflictErrorBody | ValidationErrorBody | AuthErrorBody | HttpErrorBody
