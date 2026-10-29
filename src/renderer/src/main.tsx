import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { isMac, platform } from './app/platform'
import { pdfContent } from './pdf-content/client'
import 'pdfjs-dist/web/pdf_viewer.css'
import './styles/base.css'

const container = document.getElementById('root')
if (!container) throw new Error('Контейнер #root не найден')

// Стили, которые отличаются на Mac, привязаны к [data-platform='darwin'].
document.documentElement.dataset.platform = platform
if (isMac) {
  // Отступ шапки под кнопки окна не нужен в полноэкранном режиме: кнопок там нет.
  window.pdfwright.onFullScreen((fullScreen) => {
    document.documentElement.toggleAttribute('data-fullscreen', fullScreen)
  })
}

// Worker правки содержимого создаётся при первой операции; при закрытии окна — останавливаем.
window.addEventListener('pagehide', () => {
  pdfContent.dispose()
})

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
