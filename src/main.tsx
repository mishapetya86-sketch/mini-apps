import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './ui/App'
import { applyTelegramTheme, initializeTelegram } from './lib/telegram'
import './ui/styles.css'
import './ui/schedule.css'
import './ui/aggregate.css'
import './ui/actions.css'
import './ui/actions-theme.css'
import './ui/touch.css'

initializeTelegram()
applyTelegramTheme()
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
