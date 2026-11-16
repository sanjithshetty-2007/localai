import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import '@/editor/monaco'
import App from './App'
import { useApp } from './store/app'

// Handle for automated end-to-end tests (renderer-only state; grants no extra privileges).
;(window as unknown as { __localcode: typeof useApp }).__localcode = useApp

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
