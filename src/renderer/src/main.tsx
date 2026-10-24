import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import 'pdfjs-dist/web/pdf_viewer.css'
import './styles/base.css'

const container = document.getElementById('root')
if (!container) throw new Error('Контейнер #root не найден')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
