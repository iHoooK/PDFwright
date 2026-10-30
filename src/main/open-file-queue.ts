/**
 * Файлы, которые macOS передаёт событием open-file: «Открыть в программе» и
 * двойной щелчок в Finder, перетаскивание на значок в Dock. При запуске с
 * файлом событие приходит раньше, чем готовы окна, поэтому пути копятся здесь
 * и забираются вместе с аргументами запуска; после подключения обработчика
 * каждый новый путь сразу уходит ему.
 */
export class OpenFileQueue {
  private pending: string[] = []
  private handler: ((path: string) => void) | null = null

  push(path: string): void {
    if (this.handler) this.handler(path)
    else if (!this.pending.includes(path)) this.pending.push(path)
  }

  /** Накопленные пути по порядку прихода; очередь пустеет. */
  take(): string[] {
    const paths = this.pending
    this.pending = []
    return paths
  }

  /** Подключает обработчик: сначала он получает накопленные пути, затем новые. */
  attach(handler: (path: string) => void): void {
    this.handler = handler
    for (const path of this.take()) handler(path)
  }
}
