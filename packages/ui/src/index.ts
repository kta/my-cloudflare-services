/*
 * 共有 UI。承認済みモック `docs/frontend/mockups/eye` は Apple HIG に従い
 * iPadOS の既定書体（SF Pro JP / ヒラギノ）で組まれているので、書体は自前で配らない。
 * 自己ホストの Web フォントを読むと、iPad では必ず system 書体が先に当たるため
 * 15MB 分が丸ごと無駄になる。theme.css の `--font-sans` の予備は総称に任せる。
 */
export { cn } from './cn'
export {
  Button,
  type ButtonVariant,
  buttonClass,
  Chip,
  disabledLook,
  Field,
  focusRing,
  focusRingOnPine,
  Notice,
  Select,
  Textarea,
  TextInput,
} from './components'
export { Dialog } from './dialog'
export { Keypad, type KeypadProps, PinField, type PinFieldProps, TryMeter } from './keypad'
export { UndoBar, type UndoBarProps } from './undo-bar'
