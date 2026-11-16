import { Component, forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { Loader2, X, type LucideIcon } from 'lucide-react'

/*
 * Shared primitives. Every panel uses these instead of styling raw elements, so
 * controls look and behave the same everywhere and follow the theme tokens.
 */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-button text-button-fg hover:bg-button-hover',
  secondary: 'bg-button2 text-fg hover:bg-button2-hover',
  ghost: 'bg-transparent text-fg hover:bg-hover',
  danger: 'bg-error/90 text-white hover:bg-error'
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  icon?: LucideIcon
  size?: 'sm' | 'md'
  busy?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', icon: Icon, size = 'md', busy, className = '', children, disabled, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || busy}
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[2px] whitespace-nowrap disabled:cursor-default disabled:opacity-50 ${
        size === 'sm' ? 'h-[22px] px-2 text-ui-xs' : 'h-[26px] px-3 text-ui-sm'
      } ${BUTTON_STYLES[variant]} ${className}`}
      {...rest}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : Icon ? <Icon size={size === 'sm' ? 12 : 14} /> : null}
      {children}
    </button>
  )
})

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon
  label: string
  active?: boolean
  size?: number
}

export function IconButton({ icon: Icon, label, active, size = 16, className = '', ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`no-drag inline-flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-fg hover:bg-hover disabled:cursor-default disabled:opacity-40 ${
        active ? 'bg-hover' : ''
      } ${className}`}
      {...rest}
    >
      <Icon size={size} strokeWidth={1.6} />
    </button>
  )
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className = '', ...rest }, ref) {
  return (
    <input
      ref={ref}
      spellCheck={false}
      className={`selectable h-[26px] w-full rounded-[2px] border border-input-border bg-input px-2 text-ui text-fg outline-none placeholder:text-muted focus:border-focus ${className}`}
      {...rest}
    />
  )
})

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`h-[26px] cursor-pointer rounded-[2px] border border-input-border bg-input px-1.5 text-ui text-fg outline-none focus:border-focus ${className}`}
      {...rest}
    >
      {children}
    </select>
  )
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 py-1">
      <input type="checkbox" className="mt-[3px] h-[14px] w-[14px] cursor-pointer accent-[var(--vs-accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="text-ui text-fg">{label}</span>
        {description && <span className="block text-ui-sm text-muted">{description}</span>}
      </span>
    </label>
  )
}

export function SectionHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-[35px] shrink-0 items-center justify-between pr-2 pl-5 text-ui-xs font-normal tracking-wide text-fg uppercase">
      <span className="truncate">{title}</span>
      <div className="flex items-center gap-0.5">{children}</div>
    </div>
  )
}

export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={`animate-spin text-muted ${className}`} />
}

export function EmptyState({ icon: Icon, title, children }: { icon?: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
      {Icon && <Icon size={32} strokeWidth={1.2} className="text-muted" />}
      <div className="text-ui text-fg">{title}</div>
      {children && <div className="text-ui-sm text-muted">{children}</div>}
    </div>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'error' | 'warning' | 'info' }) {
  const tones = {
    neutral: 'bg-badge text-fg',
    success: 'bg-success/20 text-success',
    error: 'bg-error/20 text-error',
    warning: 'bg-warning/20 text-warning',
    info: 'bg-info/20 text-info'
  }
  return <span className={`inline-flex h-[16px] items-center rounded-[8px] px-1.5 text-ui-xs leading-none ${tones[tone]}`}>{children}</span>
}

export function Modal({ title, onClose, children, footer, width = 440 }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="max-w-[92vw] rounded-[4px] border border-line-strong bg-sidebar shadow-[0_8px_24px_var(--vs-shadow)]"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-[35px] items-center justify-between border-b border-line pr-2 pl-4">
          <span className="text-ui font-semibold text-fg-strong">{title}</span>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="px-4 py-3 text-ui">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-2.5">{footer}</div>}
      </div>
    </div>
  )
}

export interface MenuItem {
  label: string
  icon?: LucideIcon
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  separator?: boolean
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  useEffect(() => {
    const el = ref.current
    if (el) {
      const r = el.getBoundingClientRect()
      setPos({ x: Math.min(x, window.innerWidth - r.width - 4), y: Math.min(y, window.innerHeight - r.height - 4) })
    }
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [x, y, onClose])
  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-[200px] rounded-[4px] border border-line-strong bg-sidebar py-1 shadow-[0_4px_16px_var(--vs-shadow)]"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="my-1 border-t border-line-strong" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            className={`flex h-[24px] w-full cursor-pointer items-center gap-2 px-3 text-left text-ui hover:bg-selected-focus disabled:cursor-default disabled:opacity-40 ${it.danger ? 'text-error' : 'text-fg'}`}
            onClick={() => {
              onClose()
              it.onClick()
            }}
          >
            <span className="flex w-4 justify-center">{it.icon && <it.icon size={14} strokeWidth={1.6} />}</span>
            {it.label}
          </button>
        )
      )}
    </div>
  )
}

/** Keeps one broken pane from taking down the whole window. */
export class PaneBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error(`[${this.props.name}]`, error)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex flex-col items-start gap-2 p-4 text-ui-sm">
        <span className="text-error">The {this.props.name} hit an error: {this.state.error.message}</span>
        <Button size="sm" variant="secondary" onClick={() => this.setState({ error: null })}>
          Reload {this.props.name}
        </Button>
      </div>
    )
  }
}

/** Drag handle for resizable panes. */
export function Resizer({ direction, onResize, onEnd }: { direction: 'horizontal' | 'vertical'; onResize: (delta: number) => void; onEnd?: () => void }) {
  const start = useRef(0)
  return (
    <div
      className={`group relative z-10 shrink-0 ${direction === 'horizontal' ? 'w-[4px] -mx-[2px] cursor-col-resize' : 'h-[4px] -my-[2px] cursor-row-resize'}`}
      onMouseDown={(e) => {
        e.preventDefault()
        start.current = direction === 'horizontal' ? e.clientX : e.clientY
        const move = (ev: MouseEvent) => {
          const pos = direction === 'horizontal' ? ev.clientX : ev.clientY
          onResize(pos - start.current)
          start.current = pos
        }
        const up = () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          document.body.style.cursor = ''
          onEnd?.()
        }
        document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }}
    >
      <div className={`absolute bg-focus opacity-0 transition-opacity group-hover:opacity-100 ${direction === 'horizontal' ? 'inset-y-0 left-[1px] w-[2px]' : 'inset-x-0 top-[1px] h-[2px]'}`} />
    </div>
  )
}
