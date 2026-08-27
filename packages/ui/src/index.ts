/*
 * theme.css が名乗る書体を自前で配る。承認済みモックは全画面 IBM Plex Sans JP
 * で組まれており、これが読み込まれていないと和文が system-ui に落ちて字面が
 * まるごと別物になる。ここで読むので、コンポーネントを使うアプリは何もしなくてよい。
 * 必要なウェイトだけを読む（400 本文 / 500 中間 / 600 見出し / 700 太字）。
 */
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource/ibm-plex-sans-jp/400.css'
import '@fontsource/ibm-plex-sans-jp/500.css'
import '@fontsource/ibm-plex-sans-jp/600.css'
import '@fontsource/ibm-plex-sans-jp/700.css'

export { cn } from './cn'
export {
  Button,
  type ButtonVariant,
  buttonClass,
  Card,
  Chip,
  Field,
  focusRing,
  Notice,
  Select,
  Textarea,
  TextInput,
} from './components'
export { Dialog } from './dialog'
