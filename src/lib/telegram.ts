export interface TelegramUser {
  id: number
  language_code?: string
  first_name?: string
  last_name?: string
  username?: string
}

export interface TelegramWebApp {
  initData: string
  initDataUnsafe?: { user?: TelegramUser }
  colorScheme?: 'light' | 'dark'
  themeParams?: Record<string, string>
  ready(): void
  expand(): void
  HapticFeedback?: { notificationOccurred(type: 'success' | 'error' | 'warning'): void }
  MainButton?: { show(): void; hide(): void; setText(text: string): void; onClick(fn: () => void): void; offClick(fn: () => void): void }
  BackButton?: { show(): void; hide(): void; onClick(fn: () => void): void; offClick(fn: () => void): void }
}

declare global { interface Window { Telegram?: { WebApp?: TelegramWebApp } } }

export const telegram = () => window.Telegram?.WebApp
export const initData = () => telegram()?.initData ?? ''
export const telegramLanguage = (): 'ru' | 'uz' => telegram()?.initDataUnsafe?.user?.language_code?.toLowerCase().startsWith('uz') ? 'uz' : 'ru'

export function initializeTelegram() {
  telegram()?.ready()
  telegram()?.expand()
}

export function applyTelegramTheme() {
  const app = telegram()
  const root = document.documentElement
  root.dataset.theme = app?.colorScheme ?? 'dark'
  const map: Record<string, string> = {
    '--tg-bg': 'bg_color', '--tg-text': 'text_color', '--tg-hint': 'hint_color',
    '--tg-secondary': 'secondary_bg_color', '--tg-button': 'button_color', '--tg-button-text': 'button_text_color',
  }
  for (const [css, key] of Object.entries(map)) {
    const value = app?.themeParams?.[key]
    if (value) root.style.setProperty(css, value)
  }
}
