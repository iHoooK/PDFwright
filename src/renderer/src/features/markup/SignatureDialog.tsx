import { useRef, useState } from 'react'
import { Dialog } from '@renderer/components/Dialog'
import { Button } from '@renderer/components/controls'
import { t } from '@renderer/i18n'
import s from './markup.module.css'

const WIDTH = 480
const HEIGHT = 200
/** Холст рисуется вдвое плотнее экрана, чтобы подпись в PDF не была зубчатой. */
const DENSITY = 2
const INK = '#1b1b1b'

interface Props {
  open: boolean
  onClose: () => void
  onSave: (src: string) => void
}

/** Обрезает прозрачные поля вокруг росчерка и возвращает PNG data URL или null для пустого холста. */
function trimmedPng(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const { width, height } = canvas
  const data = ctx.getImageData(0, 0, width, height).data
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  const pad = 6 * DENSITY
  const x = Math.max(0, minX - pad)
  const y = Math.max(0, minY - pad)
  const w = Math.min(width, maxX + pad) - x
  const h = Math.min(height, maxY + pad) - y
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  out.getContext('2d')?.drawImage(canvas, x, y, w, h, 0, 0, w, h)
  return out.toDataURL('image/png')
}

/** Холст для подписи мышью или стилусом; результат — PNG с прозрачным фоном. */
export function SignatureDialog({ open, onClose, onSave }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [empty, setEmpty] = useState(true)

  const clear = (): void => {
    const canvas = canvasRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    setEmpty(true)
  }

  const point = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH * DENSITY,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT * DENSITY
    }
  }

  /** Перо стилуса меняет толщину от нажима, мышь рисует ровной линией. */
  const draw = (to: { x: number; y: number }, event: React.PointerEvent): void => {
    const ctx = canvasRef.current?.getContext('2d')
    const from = last.current ?? to
    if (!ctx) return
    ctx.strokeStyle = INK
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = (event.pointerType === 'pen' ? 1 + event.pressure * 3 : 2.4) * DENSITY
    ctx.beginPath()
    if (from.x === to.x && from.y === to.y) {
      // Щелчок без движения — точка (над «i», в инициалах): отрезок нулевой длины не рисуется.
      ctx.fillStyle = INK
      ctx.arc(to.x, to.y, ctx.lineWidth / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.stroke()
    }
    last.current = to
  }

  return (
    <Dialog
      open={open}
      title={t.markup.signatureTitle}
      onClose={onClose}
      width={WIDTH + 48}
      footer={
        <>
          <Button onClick={clear} disabled={empty}>
            {t.markup.signatureClear}
          </Button>
          <span style={{ flex: 1 }} />
          <Button onClick={onClose}>{t.markup.signatureCancel}</Button>
          <Button
            variant="primary"
            disabled={empty}
            onClick={() => {
              const canvas = canvasRef.current
              const src = canvas ? trimmedPng(canvas) : null
              if (src) onSave(src)
            }}
          >
            {t.markup.signatureSave}
          </Button>
        </>
      }
    >
      <p className="muted" style={{ margin: '0 0 10px' }}>
        {t.markup.signatureLead}
      </p>
      <canvas
        ref={canvasRef}
        className={s.signaturePad}
        width={WIDTH * DENSITY}
        height={HEIGHT * DENSITY}
        style={{ width: WIDTH, height: HEIGHT }}
        aria-label={t.markup.signatureTitle}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          last.current = null
          draw(point(event), event)
          setEmpty(false)
        }}
        onPointerMove={(event) => {
          if (event.buttons === 0) return
          draw(point(event), event)
        }}
        onPointerUp={() => {
          last.current = null
        }}
      />
    </Dialog>
  )
}
