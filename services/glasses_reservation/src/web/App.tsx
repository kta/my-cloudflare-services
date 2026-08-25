import { useEffect, useReducer, useState } from 'react'
import type { View } from './model'
import { customers, initialReservationState, reservationReducer } from './reservationReducer'

const slots = [
  '14:00 〜 15:30',
  '14:30 〜 16:00',
  '15:00 〜 16:30',
  '15:30 〜 17:00',
  '16:00 〜 17:30',
]
const purposes = ['検眼・カウンセリング', 'メガネの調整・フィッティング', 'コンタクト相談・購入']
const staff = ['鈴木 明日香', '田中 健一', '佐藤 美咲']
const views: [View, string][] = [
  ['home', 'ホーム'],
  ['booking', '新規予約'],
  ['ledger', '予約台帳'],
  ['list', '予約一覧'],
  ['customer', '顧客台帳'],
  ['dashboard', 'ダッシュボード'],
]

export function App({ initialView }: { initialView?: View } = {}) {
  const queryView = new URLSearchParams(window.location.search).get('view') as View | null
  const startView =
    initialView ?? (queryView && views.some(([view]) => view === queryView) ? queryView : 'home')
  const [state, dispatch] = useReducer(reservationReducer, {
    ...initialReservationState,
    view: startView,
  })
  const [menu, setMenu] = useState(false)
  const setView = (view: View) => {
    dispatch({ type: 'setView', view })
    setMenu(false)
    if (view === 'booking') dispatch({ type: 'openBooking' })
  }
  return (
    <div className="app">
      <header className={`app-header ${state.view === 'home' ? 'home-context' : ''}`}>
        <a
          className="brand"
          href="?view=home"
          aria-label="EYEX予約 ホーム"
          onClick={(e) => {
            e.preventDefault()
            setView('home')
          }}
        >
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>EYEX予約</span>
        </a>
        <span className="header-title">電話予約システム</span>
        <div className="header-tools">
          <button type="button">通話メモ</button>
          <a
            className="header-tool"
            href="?view=ledger"
            onClick={(e) => {
              e.preventDefault()
              setView('ledger')
            }}
          >
            ▣ 予約履歴
          </a>
          <button type="button" aria-label="メニュー" onClick={() => setMenu(true)}>
            ☰
          </button>
        </div>
      </header>
      <div className="app-shell">
        {state.view !== 'home' && state.view !== 'booking' && (
          <nav className="global-nav" aria-label="メインナビゲーション">
            {views.slice(1).map(([view, label]) => (
              <a
                key={view}
                href={`?view=${view}`}
                onClick={(e) => {
                  e.preventDefault()
                  setView(view)
                }}
              >
                {label}
              </a>
            ))}
          </nav>
        )}
        <main className="page-area">
          {state.notice && <div className="notice">{state.notice}</div>}
          {state.view === 'home' && <Home state={state} dispatch={dispatch} onView={setView} />}
          {state.view === 'booking' && (
            <Booking state={state} dispatch={dispatch} onView={setView} />
          )}
          {state.view === 'ledger' && <Ledger state={state} dispatch={dispatch} />}
          {state.view === 'list' && <List state={state} dispatch={dispatch} onView={setView} />}
          {state.view === 'customer' && <CustomerView state={state} dispatch={dispatch} />}
          {state.view === 'dashboard' && <Dashboard onView={setView} />}
        </main>
      </div>
      {menu && (
        <div className="menu-backdrop">
          <aside className="menu-drawer" role="dialog" aria-label="メインメニュー">
            <button type="button" aria-label="メニューを閉じる" onClick={() => setMenu(false)}>
              ×
            </button>
            <h2>メニュー</h2>
            {views.map(([view, label]) => (
              <a
                key={view}
                href={`?view=${view}`}
                onClick={(e) => {
                  e.preventDefault()
                  setView(view)
                }}
              >
                {label}
              </a>
            ))}
          </aside>
        </div>
      )}
    </div>
  )
}

function Home({
  state,
  dispatch,
  onView,
}: {
  state: ReturnType<typeof reservationReducer>
  dispatch: React.Dispatch<Parameters<typeof reservationReducer>[1]>
  onView: (v: View) => void
}) {
  return (
    <section className="home-page">
      <div className="home-inner">
        <div className="home-heading">
          <div>
            <p className="home-eyebrow">SMART RECEPTION / 2025.05.20</p>
            <h1>今日はどのご用件ですか？</h1>
            <p className="home-subtitle">お客様との会話を、次の一歩へつなげます。</p>
          </div>
          <div className="home-agent">
            <span className="home-avatar">鈴</span>
            <span>
              鈴木 明日香
              <br />
              <small>青山店・受付中</small>
            </span>
          </div>
        </div>
        <div className="home-date-strip">
          <button type="button" aria-label="前の日">
            ‹
          </button>
          <button type="button">
            月曜日<strong>19</strong>
          </button>
          <button type="button">
            火曜日<strong>20</strong>
          </button>
          <button type="button">
            水曜日<strong>21</strong>
          </button>
          <button type="button">
            木曜日<strong>22</strong>
          </button>
          <button type="button">
            金曜日<strong>23</strong>
          </button>
          <button type="button" aria-label="次の日">
            ›
          </button>
          <button
            type="button"
            aria-label="カレンダーを開く"
            aria-expanded={state.homeCalendarOpen}
            onClick={() => dispatch({ type: 'toggleHomeCalendar' })}
          >
            ▣
          </button>
        </div>
        <div className="home-actions">
          <button
            type="button"
            aria-label="新規予約"
            className="home-action primary"
            onClick={() => onView('booking')}
          >
            <span className="home-action-icon" aria-hidden="true">
              ＋
            </span>
            <span className="home-action-copy">
              <strong>新規予約</strong>
              <small>お電話での予約を受け付ける</small>
            </span>
            <span className="home-action-arrow" aria-hidden="true">
              →
            </span>
          </button>
          <button
            type="button"
            aria-label="予約変更"
            className="home-action primary"
            onClick={() => onView('list')}
          >
            <span className="home-action-icon" aria-hidden="true">
              ↻
            </span>
            <span className="home-action-copy">
              <strong>予約変更</strong>
              <small>日時や内容を変更する</small>
            </span>
            <span className="home-action-arrow" aria-hidden="true">
              →
            </span>
          </button>
          <button type="button" className="home-action utility" onClick={() => onView('list')}>
            <span className="home-action-icon" aria-hidden="true">
              ▤
            </span>
            <span className="home-action-copy">
              <strong>受付履歴</strong>
              <small>今日の受付状況を見る</small>
            </span>
            <span className="home-action-arrow" aria-hidden="true">
              →
            </span>
          </button>
          <button type="button" className="home-action utility" onClick={() => onView('list')}>
            <span className="home-action-icon" aria-hidden="true">
              ⌕
            </span>
            <span className="home-action-copy">
              <strong>予約を検索</strong>
              <small>予約情報を探す</small>
            </span>
            <span className="home-action-arrow" aria-hidden="true">
              →
            </span>
          </button>
          <button type="button" className="home-action utility" onClick={() => onView('customer')}>
            <span className="home-action-icon" aria-hidden="true">
              ♙
            </span>
            <span className="home-action-copy">
              <strong>顧客台帳</strong>
              <small>お客様の情報を確認する</small>
            </span>
            <span className="home-action-arrow" aria-hidden="true">
              →
            </span>
          </button>
        </div>
        <div className="home-foot">
          <span>
            本日の予約 <strong>6</strong>件
          </span>
          <span>受付担当: 鈴木 明日香</span>
          <span className="home-foot-links">ダッシュボード　予約台帳</span>
        </div>
        {state.homeCalendarOpen && (
          <div className="home-calendar-popover" role="dialog" aria-label="日付カレンダー">
            <strong>日付を選択</strong>
            <button type="button" onClick={() => dispatch({ type: 'setHomeDate', date: '19' })}>
              19日
            </button>
            <button type="button" onClick={() => dispatch({ type: 'setHomeDate', date: '20' })}>
              20日
            </button>
            <button type="button" onClick={() => dispatch({ type: 'setHomeDate', date: '21' })}>
              21日
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
function Booking({
  state,
  dispatch,
  onView,
}: {
  state: ReturnType<typeof reservationReducer>
  dispatch: React.Dispatch<Parameters<typeof reservationReducer>[1]>
  onView: (v: View) => void
}) {
  const [registration, setRegistration] = useState(false)
  const [regName, setRegName] = useState('')
  const [regPhone, setRegPhone] = useState('')
  const [queryName, setQueryName] = useState('')
  const [queryPhone, setQueryPhone] = useState('')
  useEffect(() => {
    if (state.draftCustomer) {
      setQueryName(state.draftCustomer.name)
      setQueryPhone(state.draftCustomer.phone)
    }
  }, [state.draftCustomer])
  const canSlots = Boolean(state.draft.date && state.draft.startTime && state.draft.purpose)
  return (
    <section className="booking-page">
      <div className="page-heading">
        <h1>電話予約入力</h1>
        <button type="button" onClick={() => onView('home')}>
          受付をやめてホームへ戻る
        </button>
      </div>
      <div className="booking-grid">
        <div className="booking-form">
          {registration ? (
            <>
              <h2>新規顧客登録</h2>
              <label>
                お名前
                <input
                  aria-label="登録氏名"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                />
              </label>
              <label>
                電話番号
                <input
                  aria-label="登録電話番号"
                  value={regPhone}
                  onChange={(e) => setRegPhone(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  dispatch({ type: 'registerCustomer', name: regName, phone: regPhone })
                  setRegistration(false)
                }}
              >
                顧客を登録する
              </button>
            </>
          ) : (
            <>
              <h2>予約内容を入力</h2>
              <label>
                お日にちはいつですか？
                <input
                  type="date"
                  aria-label="日付"
                  value={state.draft.date}
                  onChange={(e) =>
                    dispatch({ type: 'setAppointment', field: 'date', value: e.target.value })
                  }
                />
              </label>
              <label>
                お時間は何時からですか？
                <select
                  aria-label="開始時間"
                  value={state.draft.startTime}
                  onChange={(e) =>
                    dispatch({ type: 'setAppointment', field: 'startTime', value: e.target.value })
                  }
                >
                  <option value="">時間を選択</option>
                  <option value="14:00">14:00</option>
                  <option value="15:00">15:00</option>
                </select>
              </label>
              <label>
                お名前
                <input
                  aria-label="お名前"
                  value={queryName}
                  onChange={(e) => {
                    setQueryName(e.target.value)
                    dispatch({ type: 'setCustomerQuery', field: 'name', value: e.target.value })
                  }}
                />
              </label>
              <label>
                電話番号
                <input
                  aria-label="電話番号"
                  value={queryPhone}
                  onChange={(e) => {
                    setQueryPhone(e.target.value)
                    dispatch({ type: 'setCustomerQuery', field: 'phone', value: e.target.value })
                  }}
                />
              </label>
              {state.customerSuggestion && (
                <button
                  type="button"
                  className="suggestion"
                  onClick={() =>
                    dispatch({
                      type: 'selectCustomer',
                      customerId: state.customerSuggestion?.id ?? '',
                    })
                  }
                >
                  このお客様ですか？ {state.customerSuggestion.name}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const found = customers.find(
                    (c) =>
                      (queryName !== '' && c.name.includes(queryName)) ||
                      (queryPhone !== '' &&
                        c.phone.replaceAll('-', '').includes(queryPhone.replaceAll('-', ''))),
                  )
                  if (found) dispatch({ type: 'selectCustomer', customerId: found.id })
                  else setRegistration(true)
                }}
              >
                情報を検索
              </button>
              {state.draftCustomer && <p>{state.draftCustomer.name} 様</p>}
              <h3>ご希望・ご用件を伺います</h3>
              {purposes.map((purpose) => (
                <button
                  type="button"
                  key={purpose}
                  aria-pressed={state.draft.purpose === purpose}
                  onClick={() =>
                    dispatch({ type: 'setAppointment', field: 'purpose', value: purpose })
                  }
                >
                  {purpose}
                </button>
              ))}
              <h3>担当者のご要望はありますか？</h3>
              {staff.map((person) => (
                <button
                  type="button"
                  key={person}
                  onClick={() =>
                    dispatch({ type: 'setAppointment', field: 'staff', value: person })
                  }
                >
                  {person}
                </button>
              ))}
              {canSlots ? (
                <div className="slots">
                  {slots.map((slot) => (
                    <button
                      type="button"
                      className="slot-card"
                      key={slot}
                      onClick={() =>
                        dispatch({
                          type: 'selectSlot',
                          slot,
                          staff: staff[slots.indexOf(slot) % 3] ?? staff[0] ?? '鈴木 明日香',
                        })
                      }
                    >
                      {slot}
                    </button>
                  ))}
                </div>
              ) : (
                <p>日付・時間・ご用件を選ぶと候補を表示します</p>
              )}
              <button
                type="button"
                onClick={() =>
                  dispatch({ type: 'setNotice', notice: '入力内容を一時保存しました' })
                }
              >
                一時保存する
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  dispatch({ type: 'confirmReservation' })
                }}
              >
                予約を確定する
              </button>
            </>
          )}
        </div>
        <aside className="booking-side">
          <h3>予約可能な候補</h3>
          <p>{state.draft.selectedSlot || '条件を選択してください'}</p>
        </aside>
      </div>
      {state.view === 'booking' && (
        <aside className="recording-widget" aria-live="polite">
          <strong>{state.recordingPaused ? '録音を一時停止中' : '通話を記録中'}</strong>
          <span>00:00</span>
          <div className="recording-waveform" role="img" aria-label="音声波形">
            {[1, 2, 3, 4, 5, 6].map((bar) => (
              <i className="wave-bar" key={bar} />
            ))}
          </div>
          <button
            type="button"
            aria-label={state.recordingPaused ? '録音を再開' : '録音を一時停止'}
            aria-pressed={state.recordingPaused}
            onClick={() => dispatch({ type: 'setRecordPaused' })}
          >
            Ⅱ
          </button>
        </aside>
      )}
    </section>
  )
}

function Ledger({
  state,
  dispatch,
}: {
  state: ReturnType<typeof reservationReducer>
  dispatch: React.Dispatch<Parameters<typeof reservationReducer>[1]>
}) {
  const selected = state.reservations.find((r) => r.id === state.detailId)
  const [editing, setEditing] = useState(false)
  const columns = ['鈴木 明日香', '田中 健一', '佐藤 美咲', '山本 里奈', '検眼室 1', '検眼室 2']
  return (
    <section>
      <h1>予約台帳</h1>
      <div className="ledger-grid">
        {columns.map((column) => (
          <div className="grid-header" key={column}>
            {column}
            <small>{column.includes('室') ? '設備' : 'スタッフ'}</small>
          </div>
        ))}
        {state.reservations.map((r) => (
          <button
            type="button"
            key={r.id}
            onClick={() => {
              setEditing(false)
              dispatch({ type: 'openReservation', reservationId: r.id })
            }}
          >
            {r.time}
            <br />
            {r.name}
          </button>
        ))}
      </div>
      {selected && (
        <aside className="drawer" aria-label="予約詳細">
          {editing ? (
            <>
              <h2>予約内容を変更</h2>
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  dispatch({
                    type: 'saveReservationChange',
                    time: selected.time,
                    staff: selected.staff,
                  })
                }}
              >
                変更を保存
              </button>
            </>
          ) : (
            <>
              <h2>予約詳細</h2>
              <p>{selected.name} 様</p>
              <button type="button" onClick={() => setEditing(true)}>
                予約を変更
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => dispatch({ type: 'cancelReservation', reservationId: selected.id })}
          >
            キャンセル
          </button>
        </aside>
      )}
    </section>
  )
}
function List({
  state,
  dispatch,
  onView,
}: {
  state: ReturnType<typeof reservationReducer>
  dispatch: React.Dispatch<Parameters<typeof reservationReducer>[1]>
  onView: (v: View) => void
}) {
  const rows = state.reservations.filter(
    (r) =>
      (state.listStaff === 'すべて' || r.staff === state.listStaff) &&
      (state.listDate === 'すべて' || r.date.includes(state.listDate)),
  )
  const selected = state.reservations.find((r) => r.id === state.detailId)
  return (
    <section>
      <h1>予約一覧</h1>
      <select
        aria-label="担当者で絞り込み"
        value={state.listStaff}
        onChange={(e) => dispatch({ type: 'setListStaff', staff: e.target.value })}
      >
        <option>すべて</option>
        {staff.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <select
        aria-label="日付"
        value={state.listDate}
        onChange={(e) => dispatch({ type: 'setListDate', date: e.target.value })}
      >
        <option value="すべて">すべての日付</option>
        <option value="2025/05/20">2025/05/20（火）</option>
        <option value="2025/05/21">2025/05/21（水）</option>
      </select>
      <button type="button" onClick={() => onView('booking')}>
        ＋ 新しい予約
      </button>
      <table>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.time}</td>
              <td>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'openReservation', reservationId: r.id })}
                >
                  {r.name} 様
                </button>
              </td>
              <td>{r.staff}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {selected && (
        <aside className="drawer" aria-label="予約詳細">
          <h2>予約詳細</h2>
          <p>{selected.name} 様</p>
          <p>
            {selected.date} {selected.time}
          </p>
          <button
            type="button"
            onClick={() => dispatch({ type: 'cancelReservation', reservationId: selected.id })}
          >
            キャンセル
          </button>
        </aside>
      )}
    </section>
  )
}
function CustomerView({
  state,
  dispatch,
}: {
  state: ReturnType<typeof reservationReducer>
  dispatch: React.Dispatch<Parameters<typeof reservationReducer>[1]>
}) {
  const tabs: [string, string][] = [
    ['visit', '来店履歴'],
    ['glasses', 'メガネ情報'],
    ['contact', 'コンタクト情報'],
    ['billing', '会計履歴'],
  ]
  return (
    <section>
      <h1>顧客カルテ</h1>
      <button
        type="button"
        onClick={() => dispatch({ type: 'setNotice', notice: '顧客情報を編集しました' })}
      >
        顧客情報を編集
      </button>
      <button
        type="button"
        onClick={() => dispatch({ type: 'setNotice', notice: 'メモを更新しました' })}
      >
        メモを編集
      </button>
      <div role="tablist">
        {tabs.map(([id, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={state.customerTab === id}
            key={id}
            onClick={() => dispatch({ type: 'setCustomerTab', tab: id })}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        <h2>{tabs.find(([id]) => id === state.customerTab)?.[1]}</h2>
        <p>佐藤 みどり 様の情報を表示しています。</p>
      </div>
    </section>
  )
}
function Dashboard({ onView }: { onView: (v: View) => void }) {
  return (
    <section>
      <h1>ダッシュボード</h1>
      <div className="kpi-card">本日の予約数 12件</div>
      <button type="button" onClick={() => onView('list')}>
        予約一覧を見る
      </button>
    </section>
  )
}
