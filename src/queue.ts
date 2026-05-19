import type { AdfiniaPayload } from './types'
import type { KVStore } from './storage'
import type { Transport } from './transport'

const QUEUE_KEY = 'adfinia:queue'
const DEFAULT_MAX_QUEUE = 1000

export interface QueueConfig {
  store: KVStore
  transport: Transport
  flushAt: number
  flushIntervalMs: number
  maxQueueSize?: number
  debug: (message: string, extra?: unknown) => void
}

/**
 * Persistent event queue with exponential-backoff retries.
 *
 * - Events buffer in-memory and on `KVStore` so a page close / app crash
 *   doesn't lose them.
 * - `flush()` returns when the in-flight batch resolves (ok or permanent
 *   drop). On 5xx / network failure, the batch stays in the queue and the
 *   scheduler retries with backoff.
 * - The 5s interval flushes any pending events; 50 events triggers an
 *   immediate flush.
 */
export class EventQueue {
  private buffer: AdfiniaPayload[]
  private timer: ReturnType<typeof setTimeout> | null = null
  private retryDelayMs = 0
  private inflight = false
  private destroyed = false
  private readonly maxQueueSize: number

  constructor(private cfg: QueueConfig) {
    this.maxQueueSize = cfg.maxQueueSize ?? DEFAULT_MAX_QUEUE
    this.buffer = this.loadFromStore()
    this.scheduleNext()
  }

  enqueue(payload: AdfiniaPayload): void {
    if (this.destroyed) return
    this.buffer.push(payload)
    if (this.buffer.length > this.maxQueueSize) {
      const dropped = this.buffer.length - this.maxQueueSize
      this.buffer.splice(0, dropped)
      this.cfg.debug(`queue overflow — dropped ${dropped} oldest event(s)`)
    }
    this.persist()
    if (this.buffer.length >= this.cfg.flushAt) {
      void this.flush()
    }
  }

  async flush(): Promise<void> {
    if (this.destroyed) return
    if (this.inflight) return
    if (this.buffer.length === 0) return

    this.inflight = true
    // Capture the slice we're sending; new events arriving during the
    // request remain in the buffer (we splice on success).
    const sending = this.buffer.slice(0, Math.min(this.buffer.length, this.cfg.flushAt))
    const sendingCount = sending.length

    try {
      const result = await this.cfg.transport.send(sending)
      if (result.ok) {
        this.buffer.splice(0, sendingCount)
        this.persist()
        this.retryDelayMs = 0
        this.cfg.debug(`flushed ${sendingCount} event(s)`)
      } else if (result.permanent) {
        // 4xx — payload is bad. Drop these events; keep going.
        this.buffer.splice(0, sendingCount)
        this.persist()
        this.cfg.debug(
          `dropped ${sendingCount} event(s) on permanent failure status=${result.status ?? 'n/a'}`,
        )
      } else {
        // Transient — schedule retry with exponential backoff (1s..30s).
        this.retryDelayMs =
          this.retryDelayMs === 0 ? 1000 : Math.min(this.retryDelayMs * 2, 30_000)
        this.cfg.debug(
          `retrying in ${this.retryDelayMs}ms (status=${result.status ?? 'network'})`,
        )
      }
    } finally {
      this.inflight = false
      this.scheduleNext()
    }
  }

  /**
   * Final best-effort flush — used during page unload via `sendBeacon`.
   * Returns the buffered payloads so the caller can fire them with the
   * appropriate transport.
   */
  drainAll(): AdfiniaPayload[] {
    const drained = this.buffer.slice()
    this.buffer = []
    this.persist()
    return drained
  }

  destroy(): void {
    this.destroyed = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private scheduleNext(): void {
    if (this.destroyed) return
    if (this.timer) clearTimeout(this.timer)
    const delay = this.retryDelayMs > 0 ? this.retryDelayMs : this.cfg.flushIntervalMs
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, delay)
    // Don't keep Node's event loop alive on the SDK's account.
    if (typeof (this.timer as { unref?: () => void }).unref === 'function') {
      ;(this.timer as { unref?: () => void }).unref!()
    }
  }

  private loadFromStore(): AdfiniaPayload[] {
    const raw = this.cfg.store.get(QUEUE_KEY)
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as AdfiniaPayload[]
      if (Array.isArray(parsed)) return parsed
    } catch {
      /* corrupt — start fresh */
    }
    return []
  }

  private persist(): void {
    if (this.buffer.length === 0) {
      this.cfg.store.remove(QUEUE_KEY)
    } else {
      this.cfg.store.set(QUEUE_KEY, JSON.stringify(this.buffer))
    }
  }
}
