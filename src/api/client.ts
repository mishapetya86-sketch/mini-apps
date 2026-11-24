import { initData } from '../lib/telegram'
import type {
  ApiErrorBody, BarberDto, BlockResponse, BlockSlotRequest, CancelResponse,
  DayOverviewDto, ServiceDto, SlotsQuery, UnblockResponse,
} from './types'

export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody) {
    const message = body && typeof body === 'object' && 'message' in body ? String(body.message) : 'Request failed'
    super(message)
  }
}

const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  const data = initData()
  if (data) headers.set('x-telegram-init-data', data)
  if (import.meta.env.DEV && import.meta.env.VITE_DEV_ADMIN_KEY) headers.set('x-admin-key', import.meta.env.VITE_DEV_ADMIN_KEY)
  const response = await fetch(`${base}${path}`, { ...init, headers })
  const payload: unknown = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(response.status, payload as ApiErrorBody)
  return payload as T
}

export const api = {
  services: () => request<ServiceDto[]>('/bookings/services'),
  barbers: () => request<BarberDto[]>('/bookings/barbers'),
  day: (query: SlotsQuery) => {
    const params = new URLSearchParams()
    if (query.date) params.set('date', query.date)
    if (query.barberId !== undefined) params.set('barberId', String(query.barberId))
    return request<DayOverviewDto>(`/bookings/slots?${params}`)
  },
  overview: (query: SlotsQuery) => {
    const params = new URLSearchParams()
    if (query.date) params.set('date', query.date)
    if (query.barberId !== undefined) params.set('barberId', String(query.barberId))
    return request<DayOverviewDto>(`/bookings/day-overview?${params}`)
  },
  block: (body: BlockSlotRequest) => request<BlockResponse>('/bookings/block', { method: 'POST', body: JSON.stringify(body) }),
  unblock: (id: number, barberId: number) => request<UnblockResponse>(`/bookings/block/${id}?barberId=${barberId}`, { method: 'DELETE' }),
  cancel: (id: number) => request<CancelResponse>(`/bookings/${id}/cancel`, { method: 'PATCH' }),
}
