import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { pdfContent } from './pdf-content/client'
import 'pdfjs-dist/web/pdf_viewer.css'
import './styles/base.css'

const container = document.getElementById('root')
if (!container) throw new Error('Контейнер #root не найден')

// Worker правки содержимого создаётся при первой операции; при закрытии окна — останавливаем.
window.addEventListener('pagehide', () => {
  pdfContent.dispose()
})

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
