import { focusRingOnPine } from '@app/ui'

export function StartBar({
  mode,
  action,
  onAction,
  showWorkPrefix = true,
}: {
  mode: string
  action?: string
  onAction?: () => void
  showWorkPrefix?: boolean
}) {
  return (
    <header className="flex h-16 shrink-0 items-center bg-pine px-6 text-on-pine">
      <div>
        <p className="text-bar font-bold">EYEX 銀座店</p>
        <p className="text-note opacity-90">{showWorkPrefix ? `業務を始める　${mode}` : mode}</p>
      </div>
      {action && (
        <button
          type="button"
          onClick={onAction}
          className={`ml-auto min-h-12 rounded-card px-3 text-lead font-semibold ${focusRingOnPine}`}
        >
          {action}
        </button>
      )}
    </header>
  )
}
