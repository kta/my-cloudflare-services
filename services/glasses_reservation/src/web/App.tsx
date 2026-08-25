import type { Dispatch, ReactNode } from 'react'
import { useEffect, useReducer, useState } from 'react'
import type { View } from './model'
import { initialReservationState, reservationReducer } from './reservationReducer'

const slots = [
  { time: '14:00 〜 15:30', duration: '90 分', room: '検眼室 1', staff: '鈴木 明日香' },
  { time: '14:30 〜 16:00', duration: '90 分', room: '検眼室 1', staff: '田中 健一' },
  { time: '15:00 〜 16:30', duration: '90 分', room: '検眼室 2', staff: '佐藤 美咲' },
  { time: '15:30 〜 17:00', duration: '90 分', room: '検眼室 1', staff: '鈴木 明日香' },
  { time: '16:00 〜 17:30', duration: '90 分', room: '検眼室 2', staff: '田中 健一' },
]
const purposes = [
  '検眼・カウンセリング',
  'メガネの作製・ご相談',
  'メガネの調整・フィッティング',
  'メガネの修理・クリーニング',
  'コンタクトレンズの相談・購入',
  'その他',
]
const staffChoices = ['前回と同じ', '指名なし', '別の担当者を希望']
const navViews: [View, string, string][] = [
  ['booking', '▣', '電話予約'],
  ['ledger', '▦', '予約台帳'],
  ['list', '☷', '予約一覧'],
  ['customer', '♙', '顧客カルテ'],
  ['dashboard', '▥', 'ダッシュボード'],
]
const menuViews: [View, string][] = [
  ['home', 'ホーム'],
  ['booking', '新規予約'],
  ['ledger', '予約台帳'],
  ['list', '予約一覧'],
  ['customer', '顧客台帳'],
  ['dashboard', 'ダッシュボード'],
]
type State = ReturnType<typeof reservationReducer>
type Send = Dispatch<Parameters<typeof reservationReducer>[1]>

export function App({ initialView }: { initialView?: View } = {}) {
  const queryView = new URLSearchParams(window.location.search).get('view') as View | null
  const startView =
    initialView ??
    (queryView && menuViews.some(([view]) => view === queryView) ? queryView : 'home')
  const [state, dispatch] = useReducer(reservationReducer, {
    ...initialReservationState,
    view: startView,
  })
  const [menu, setMenu] = useState(false)
  const [changeTarget, setChangeTarget] = useState(false)
  const setView = (view: View) => {
    dispatch({ type: 'setView', view })
    setMenu(false)
    setChangeTarget(false)
    window.history.pushState({}, '', `?view=${view}`)
    if (view === 'booking') dispatch({ type: 'openBooking' })
  }
  const selected = state.reservations.find((r) => r.id === state.detailId)
  return (
    <div className="app">
      <Header view={state.view} onView={setView} onMenu={() => setMenu(true)} dispatch={dispatch} />
      <div className="app-shell">
        {state.view !== 'home' && state.view !== 'booking' && (
          <GlobalNav view={state.view} onView={setView} dispatch={dispatch} />
        )}
        <main className="page-area">
          {state.view === 'home' && <Home state={state} dispatch={dispatch} onView={setView} />}
          {state.view === 'booking' && (
            <Booking state={state} dispatch={dispatch} onView={setView} />
          )}
          {state.view === 'ledger' && <Ledger state={state} dispatch={dispatch} onView={setView} />}
          {state.view === 'list' && <List state={state} dispatch={dispatch} onView={setView} />}
          {state.view === 'customer' && <CustomerView state={state} dispatch={dispatch} />}
          {state.view === 'dashboard' && (
            <Dashboard state={state} dispatch={dispatch} onView={setView} />
          )}
        </main>
      </div>
      {selected && !changeTarget && (
        <DetailDrawer
          reservation={selected}
          dispatch={dispatch}
          onChange={() => setChangeTarget(true)}
          onClose={() => dispatch({ type: 'openReservation', reservationId: '' })}
        />
      )}
      {selected && changeTarget && (
        <ChangeModal
          reservation={selected}
          dispatch={dispatch}
          onClose={() => setChangeTarget(false)}
        />
      )}
      {menu && <MenuDrawer onView={setView} onClose={() => setMenu(false)} />}
    </div>
  )
}

function Header({
  view,
  onView,
  onMenu,
  dispatch,
}: {
  view: View
  onView: (view: View) => void
  onMenu: () => void
  dispatch: Send
}) {
  return (
    <header className={`app-header ${view === 'home' ? 'home-context' : ''}`}>
      <a
        className="brand"
        href="?view=home"
        aria-label="EYEX予約 ホーム"
        onClick={(e) => {
          e.preventDefault()
          onView('home')
        }}
      >
        <span className="brand-mark" aria-hidden="true">
          <span />
        </span>
        <span>EYEX予約</span>
      </a>
      <span className="header-title">電話予約システム</span>
      <div className="header-tools">
        <button
          className="header-tool"
          type="button"
          aria-pressed="false"
          onClick={() => dispatch({ type: 'setNotice', notice: '通話メモを保存しました' })}
        >
          <span className="header-icon" aria-hidden="true">
            ♧
          </span>
          <span>通話メモ</span>
        </button>
        <a
          className="header-tool"
          href="?view=ledger"
          aria-label={view === 'home' || view === 'booking' ? '予約台帳' : '予約履歴'}
          onClick={(e) => {
            e.preventDefault()
            onView('ledger')
          }}
        >
          <span className="header-icon" aria-hidden="true">
            ▣
          </span>
          <span>予約履歴</span>
        </a>
        <button
          className="header-tool menu-button"
          type="button"
          aria-label="メニュー"
          onClick={onMenu}
        >
          ☰
        </button>
      </div>
    </header>
  )
}
function GlobalNav({
  view,
  onView,
  dispatch,
}: {
  view: View
  onView: (view: View) => void
  dispatch: Send
}) {
  return (
    <aside className="global-nav" aria-label="メインナビゲーション">
      <a
        className="home-chip"
        href="?view=home"
        onClick={(e) => {
          e.preventDefault()
          onView('home')
        }}
      >
        ⌂ <span>ホーム</span>
      </a>
      <p className="nav-caption">予約と顧客管理</p>
      <nav className="nav-list">
        {navViews.map(([target, icon, label]) => (
          <a
            className="nav-item"
            aria-current={view === target ? 'page' : 'false'}
            key={target}
            href={`?view=${target}`}
            onClick={(e) => {
              e.preventDefault()
              onView(target)
            }}
          >
            <span className="nav-icon" aria-hidden="true">
              {icon}
            </span>
            <span>{label}</span>
            {target === 'list' && <span className="nav-badge">3</span>}
          </a>
        ))}
      </nav>
      <div className="nav-footer">
        <button
          className="support-button"
          type="button"
          onClick={() => dispatch({ type: 'setNotice', notice: 'サポートを表示しました' })}
        >
          ？ サポート
        </button>
      </div>
    </aside>
  )
}
function PageChrome({
  label,
  eyebrow,
  actions,
  notice,
  beforeChildren,
  children,
}: {
  label: string
  eyebrow: string
  actions?: ReactNode
  notice?: string
  beforeChildren?: ReactNode
  children: ReactNode
}) {
  return (
    <>
      <div className="page-strip">
        <strong>{label}</strong>
        <span className="breadcrumbs">電話応対中のお客様の予約を入力しています</span>
      </div>
      <div className="page-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h1>{label}</h1>
            <p className="subtitle">お客様をお待たせしない、すばやい予約管理</p>
          </div>
          <div className="page-actions">{actions}</div>
        </div>
        {notice && <div className="notice">{notice}</div>}
        {beforeChildren}
        {children}
      </div>
    </>
  )
}

function Home({
  state,
  dispatch,
  onView,
}: {
  state: State
  dispatch: Send
  onView: (view: View) => void
}) {
  const dates = [
    ['月', '19', '昨日'],
    ['火', '20', '今日'],
    ['水', '21', '明日'],
    ['木', '22', '木曜日'],
    ['金', '23', '金曜日'],
  ] as const
  return (
    <section className="home-page">
      <div className="home-inner">
        <div className="home-heading">
          <div>
            <p className="eyebrow">SMART RECEPTION / 2025.05.20</p>
            <h1>今日はどのご用件ですか？</h1>
            <p className="subtitle">お客様との会話を、次の一歩へつなげます。</p>
          </div>
          <div className="home-agent">
            <span className="avatar">鈴</span>
            <span>
              鈴木 明日香
              <br />
              <small>青山店・受付中</small>
            </span>
          </div>
        </div>
        <p className="home-section-label home-menu-label">受付メニュー</p>
        <div className="home-actions">
          <HomeAction label="新規予約" icon="＋" primary onClick={() => onView('booking')} />
          <HomeAction label="予約変更" icon="↻" primary onClick={() => onView('list')} />
          <HomeAction label="受付履歴" icon="▤" utility onClick={() => onView('list')} />
          <HomeAction label="予約を検索" icon="⌕" utility onClick={() => onView('list')} />
          <HomeAction label="顧客台帳" icon="♙" utility onClick={() => onView('customer')} />
        </div>
        <p className="home-section-label home-date-label">本日の予定を確認</p>
        <div className="home-date-strip">
          <button
            className="home-date-arrow"
            type="button"
            aria-label="前の日"
            onClick={() =>
              dispatch({ type: 'setHomeDate', date: state.homeDate === '20' ? '19' : '20' })
            }
          >
            ‹
          </button>
          {dates.map(([day, date, note]) => (
            <button
              className={`home-date ${state.homeDate === date ? 'selected' : ''}`}
              type="button"
              key={date}
              aria-pressed={state.homeDate === date}
              onClick={() => dispatch({ type: 'setHomeDate', date })}
            >
              <small>{day}曜日</small>
              <strong>{date}</strong>
              <span>{note}</span>
            </button>
          ))}
          <button
            className="home-date-arrow"
            type="button"
            aria-label="次の日"
            onClick={() =>
              dispatch({ type: 'setHomeDate', date: state.homeDate === '20' ? '21' : '20' })
            }
          >
            ›
          </button>
          <button
            className="home-calendar"
            type="button"
            aria-label="カレンダーを開く"
            aria-expanded={state.homeCalendarOpen}
            onClick={() => dispatch({ type: 'toggleHomeCalendar' })}
          >
            ▣
          </button>
        </div>
        {state.homeCalendarOpen && (
          <div className="home-calendar-popover" role="dialog" aria-label="日付カレンダー">
            <strong>日付を選択</strong>
            {['19', '20', '21'].map((date) => (
              <button
                key={date}
                type="button"
                onClick={() => dispatch({ type: 'setHomeDate', date })}
              >
                {date}日
              </button>
            ))}
          </div>
        )}
        <div className="home-foot">
          <span>
            今日の予約　<strong>12件</strong>　　空き候補　<strong>5件</strong>
          </span>
          <span className="home-foot-links">
            <a
              href="?view=dashboard"
              onClick={(e) => {
                e.preventDefault()
                onView('dashboard')
              }}
            >
              ダッシュボードを見る
            </a>
            <a
              href="?view=ledger"
              onClick={(e) => {
                e.preventDefault()
                onView('ledger')
              }}
            >
              予約台帳を開く
            </a>
          </span>
        </div>
      </div>
    </section>
  )
}
function HomeAction({
  label,
  icon,
  primary,
  utility,
  onClick,
}: {
  label: string
  icon: string
  primary?: boolean
  utility?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`home-action ${primary ? 'primary' : ''} ${utility ? 'utility' : ''}`}
      onClick={onClick}
    >
      <span className="home-action-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="home-action-copy">
        <strong>{label}</strong>
        <small>
          {label === '新規予約'
            ? '日時とご用件をうかがい、予約を作成'
            : label === '顧客台帳'
              ? 'カルテと過去のご来店履歴'
              : '本日の受付状況を一覧で確認'}
        </small>
      </span>
      <span className="home-action-arrow" aria-hidden="true">
        →
      </span>
    </button>
  )
}

function Booking({
  state,
  dispatch,
  onView,
}: {
  state: State
  dispatch: Send
  onView: (view: View) => void
}) {
  const [registration, setRegistration] = useState(false)
  const [regName, setRegName] = useState('')
  const [regPhone, setRegPhone] = useState('')
  const [regGender, setRegGender] = useState('未入力')
  const [regAge, setRegAge] = useState('未入力')
  const [regBirthday, setRegBirthday] = useState('')
  const [regMemberId, setRegMemberId] = useState('')
  const [regLastVisit, setRegLastVisit] = useState('')
  const [regPurpose, setRegPurpose] = useState('')
  const [queryName, setQueryName] = useState('')
  const [queryPhone, setQueryPhone] = useState('')
  useEffect(() => {
    if (state.draftCustomer) {
      setQueryName(state.draftCustomer.name)
      setQueryPhone(state.draftCustomer.phone)
    }
  }, [state.draftCustomer])
  const canSlots = Boolean(state.draft.date && state.draft.startTime && state.draft.purpose)
  const search = () => {
    const found = state.customers.find(
      (c) =>
        (queryName && c.name.includes(queryName)) ||
        (queryPhone && c.phone.replaceAll('-', '').includes(queryPhone.replaceAll('-', ''))),
    )
    if (found) dispatch({ type: 'selectCustomer', customerId: found.id })
    else setRegistration(true)
  }
  const form = registration ? (
    <section className="booking-form">
      <div className="booking-form-header">
        <div>
          <h2>新規顧客登録</h2>
          <p>初めてのお客様の情報を登録します</p>
        </div>
        <button className="btn small" type="button" onClick={() => setRegistration(false)}>
          戻る
        </button>
      </div>
      <div className="form-section">
        <div className="control-grid">
          <label className="field full">
            <span className="field-label">お名前</span>
            <input
              className="input"
              aria-label="登録氏名"
              value={regName}
              onChange={(e) => setRegName(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">性別</span>
            <select
              className="select"
              aria-label="登録性別"
              value={regGender}
              onChange={(e) => setRegGender(e.target.value)}
            >
              <option>未入力</option>
              <option>女性</option>
              <option>男性</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">年代</span>
            <select
              className="select"
              aria-label="登録年代"
              value={regAge}
              onChange={(e) => setRegAge(e.target.value)}
            >
              <option>未入力</option>
              <option>20代</option>
              <option>30代</option>
              <option>40代</option>
              <option>50代</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">生年月日</span>
            <input
              className="input"
              type="date"
              aria-label="登録生年月日"
              value={regBirthday}
              onChange={(e) => setRegBirthday(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">会員ID</span>
            <input
              className="input"
              aria-label="登録会員ID"
              value={regMemberId}
              onChange={(e) => setRegMemberId(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">最終来店日</span>
            <input
              className="input"
              type="date"
              aria-label="登録最終来店日"
              value={regLastVisit}
              onChange={(e) => setRegLastVisit(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">用件</span>
            <input
              className="input"
              aria-label="登録用件"
              value={regPurpose}
              onChange={(e) => setRegPurpose(e.target.value)}
            />
          </label>
          <label className="field full">
            <span className="field-label">電話番号</span>
            <input
              className="input"
              aria-label="登録電話番号"
              value={regPhone}
              onChange={(e) => setRegPhone(e.target.value)}
            />
          </label>
        </div>
        <div className="page-actions">
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              dispatch({
                type: 'registerCustomer',
                name: regName,
                phone: regPhone,
                gender: regGender,
                age: regAge,
                birthday: regBirthday,
                memberId: regMemberId,
                lastVisit: regLastVisit,
                purpose: regPurpose,
              })
              setRegistration(false)
            }}
          >
            顧客を登録する
          </button>
        </div>
      </div>
    </section>
  ) : (
    <section className="booking-form">
      <div className="booking-form-header">
        <div>
          <h2>予約内容を入力</h2>
          <p>通話中のお客様の予約を入力しています</p>
        </div>
        <span className="pill">入力中</span>
      </div>
      <FormSection number="1" title="お日にちはいつですか？" required>
        <label className="field">
          <span className="field-label">日付</span>
          <input
            className="input booking-input"
            type="date"
            aria-label="日付"
            value={state.draft.date}
            onChange={(e) =>
              dispatch({ type: 'setAppointment', field: 'date', value: e.target.value })
            }
          />
        </label>
        <div className="status-line">
          {state.draft.date ? `${state.draft.date}で検索します` : '日付を選択してください'}
        </div>
      </FormSection>
      <FormSection number="2" title="お時間は何時からですか？" required>
        <label className="field">
          <span className="field-label">開始時間</span>
          <select
            className="input booking-input"
            aria-label="開始時間"
            value={state.draft.startTime}
            onChange={(e) =>
              dispatch({ type: 'setAppointment', field: 'startTime', value: e.target.value })
            }
          >
            <option value="">時間を選択してください</option>
            {['14:00', '14:30', '15:00', '15:30', '16:00'].map((time) => (
              <option key={time}>{time}</option>
            ))}
          </select>
        </label>
        <div className="status-line">
          {state.draft.startTime
            ? `${state.draft.startTime}以降の空き枠を検索します`
            : '時間を選択してください'}
        </div>
      </FormSection>
      <FormSection number="3" title="お名前と電話番号を伺えますか？" required>
        <div className="search-row">
          <label className="field">
            <span className="field-label">お名前</span>
            <input
              className="input booking-input"
              aria-label="お名前"
              value={queryName}
              placeholder="例）佐藤 みどり様"
              onChange={(e) => {
                setQueryName(e.target.value)
                dispatch({ type: 'setCustomerQuery', field: 'name', value: e.target.value })
              }}
            />
          </label>
          <label className="field">
            <span className="field-label">電話番号</span>
            <input
              className="input booking-input"
              aria-label="電話番号"
              value={queryPhone}
              placeholder="例）090-1234-5678"
              onChange={(e) => {
                setQueryPhone(e.target.value)
                dispatch({ type: 'setCustomerQuery', field: 'phone', value: e.target.value })
              }}
            />
          </label>
          <button className="btn" type="button" onClick={search}>
            情報を検索
          </button>
        </div>
        {state.customerSuggestion && (
          <div className="suggestion-card">
            <p>このお客様ですか？</p>
            <button
              className="suggestion-button"
              type="button"
              onClick={() =>
                dispatch({ type: 'selectCustomer', customerId: state.customerSuggestion?.id ?? '' })
              }
            >
              <span className="avatar">{state.customerSuggestion.name.slice(0, 1)}</span>
              <span className="suggestion-copy">
                <strong>{state.customerSuggestion.name}</strong>
                <small>{state.customerSuggestion.phone}</small>
              </span>
            </button>
          </div>
        )}
        {state.draftCustomer && (
          <div className="customer-result">
            <strong>{state.draftCustomer.name} 様</strong>
            <span>{state.draftCustomer.phone}</span>
          </div>
        )}
      </FormSection>
      <FormSection number="4" title="ご希望・ご用件を伺います" required>
        <div className="choice-grid">
          {purposes.map((purpose) => (
            <button
              className={`choice ${state.draft.purpose === purpose ? 'selected' : ''}`}
              aria-pressed={state.draft.purpose === purpose}
              type="button"
              key={purpose}
              onClick={() => dispatch({ type: 'setAppointment', field: 'purpose', value: purpose })}
            >
              {purpose}
            </button>
          ))}
        </div>
        <div className="status-line warm">
          所要時間の目安：90 分　担当に必要なスキル・機器ができるスタッフ
        </div>
      </FormSection>
      <FormSection number="5" title="担当者のご要望はありますか？" optional>
        <div className="staff-note">
          前回の担当：<b>鈴木 明日香</b>（2024/12/15 来店）
        </div>
        <div className="choice-grid">
          {staffChoices.map((choice) => (
            <button
              className={`choice ${state.draft.staff === choice ? 'selected' : ''}`}
              type="button"
              key={choice}
              onClick={() => dispatch({ type: 'setAppointment', field: 'staff', value: choice })}
            >
              {choice === '前回と同じ' ? (
                <>
                  前回と同じ
                  <br />
                  鈴木 明日香
                </>
              ) : choice === '指名なし' ? (
                <>
                  指名なし
                  <br />
                  （店舗におまかせ）
                </>
              ) : (
                choice
              )}
            </button>
          ))}
        </div>
      </FormSection>
      <BookingSlots state={state} dispatch={dispatch} canSlots={canSlots} />
      <FormSection number="6" title="内容を復唱・確認します">
        <div className={`confirmation-placeholder ${state.draftCustomer ? 'confirmed' : ''}`}>
          <div className="mic-icon">{state.draftCustomer ? '✓' : '♩'}</div>
          <div>
            <strong>
              {state.draftCustomer ? 'この予約内容を確認できます' : 'まだ内容が入力されていません'}
            </strong>
            <span>
              {state.draftCustomer
                ? `${state.draft.date || '日付未選択'} / ${state.draft.selectedSlot || '時間未選択'} / ${state.draft.purpose || '用途未選択'}`
                : '日時・時間・用途・担当者・お客様情報を入力すると、ここに内容が表示されます。'}
            </span>
          </div>
        </div>
      </FormSection>
      <div className="page-actions">
        <button
          className="btn"
          type="button"
          onClick={() => dispatch({ type: 'setNotice', notice: '入力内容を一時保存しました' })}
        >
          一時保存する
        </button>
        <button
          className="btn primary"
          type="button"
          disabled={
            !state.draftCustomer ||
            !state.draft.date ||
            !state.draft.startTime ||
            !state.draft.purpose ||
            !state.draft.selectedSlot ||
            !state.draft.staff
          }
          onClick={() => {
            dispatch({ type: 'confirmReservation' })
            window.history.pushState({}, '', '?view=list')
          }}
        >
          予約を確定する <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  )
  return (
    <PageChrome
      label="電話予約入力"
      eyebrow="CALL RESERVATION"
      notice={state.notice}
      beforeChildren={
        <div className="booking-recording-flow">
          <Recording paused={state.recordingPaused} dispatch={dispatch} />
        </div>
      }
      actions={
        <>
          <button
            aria-label="上部の一時保存"
            className="btn"
            type="button"
            onClick={() => dispatch({ type: 'setNotice', notice: '入力内容を一時保存しました' })}
          >
            一時保存する
          </button>
          <button className="btn danger" type="button" onClick={() => onView('home')}>
            受付をやめてホームへ戻る
          </button>
        </>
      }
    >
      <div className="booking-grid">
        {form}
        <BookingSide state={state} dispatch={dispatch} />
      </div>
    </PageChrome>
  )
}
function FormSection({
  number,
  title,
  required,
  optional,
  children,
}: {
  number: string
  title: string
  required?: boolean
  optional?: boolean
  children: ReactNode
}) {
  return (
    <section className="form-section">
      <div className="form-section-heading">
        <span className="number-badge">{number}</span>
        <h3 className="form-question">{title}</h3>
        {required && <span className="required">必須</span>}
        {optional && <span className="optional">任意</span>}
      </div>
      {children}
    </section>
  )
}
function BookingSide({ state, dispatch }: { state: State; dispatch: Send }) {
  const customer = state.draftCustomer
  return (
    <aside className="booking-side">
      <section className="side-card">
        <div className="side-card-header">
          <h3 className="side-card-title">
            お客様情報 <small>（{customer ? '入力済み' : '入力前'}）</small>
          </h3>
          {customer && <span className="pill">確認済</span>}
        </div>
        {customer ? (
          <div className="customer-summary">
            <span className="avatar">{customer.name.slice(0, 1)}</span>
            <div className="summary-lines">
              <div className="summary-line">
                <span>氏名</span>
                <strong>{customer.name}</strong>
              </div>
              <div className="summary-line">
                <span>電話番号</span>
                <strong>{customer.phone}</strong>
              </div>
              <div className="summary-line">
                <span>備考</span>
                <strong>遠近両用メガネ</strong>
              </div>
            </div>
          </div>
        ) : (
          <div className="summary-lines">
            <div className="summary-line">
              <span>氏名</span>
              <strong>未入力</strong>
            </div>
            <div className="summary-line">
              <span>電話番号</span>
              <strong>未入力</strong>
            </div>
            <div className="summary-line">
              <span>備考</span>
              <strong>未入力</strong>
            </div>
          </div>
        )}
      </section>
      <section className="side-card">
        <div className="side-card-header">
          <h3 className="side-card-title">選択中の条件</h3>
          <button
            className="btn small"
            type="button"
            onClick={() => dispatch({ type: 'setNotice', notice: '選択中の条件を編集できます' })}
          >
            編集
          </button>
        </div>
        <dl className="condition-list">
          <div className="condition-row">
            <dt>▣ 日付</dt>
            <dd>{state.draft.date || '未入力'}</dd>
          </div>
          <div className="condition-row">
            <dt>◷ 時間</dt>
            <dd>{state.draft.startTime || '未入力'} 以降</dd>
          </div>
          <div className="condition-row">
            <dt>♧ ご要望</dt>
            <dd>{state.draft.purpose || '未入力'}</dd>
          </div>
          <div className="condition-row">
            <dt>♙ 担当者</dt>
            <dd>{state.draft.staff || '未指定'}</dd>
          </div>
        </dl>
      </section>
    </aside>
  )
}

function BookingSlots({
  state,
  dispatch,
  canSlots,
}: {
  state: State
  dispatch: Send
  canSlots: boolean
}) {
  return (
    <section className="booking-slot-section" aria-label="予約可能な候補">
      <div className="side-card-header">
        <h3 className="side-card-title">
          予約可能な候補 <small>（5 件）</small>
        </h3>
        <button
          className="btn small"
          type="button"
          onClick={() => dispatch({ type: 'setNotice', notice: '候補枠を更新しました' })}
        >
          ↻ 更新
        </button>
      </div>
      {canSlots ? (
        <div className="slot-list">
          {slots.map((slot) => (
            <button
              className={`slot-card ${state.draft.selectedSlot === slot.time ? 'selected' : ''}`}
              aria-label={slot.time}
              aria-pressed={state.draft.selectedSlot === slot.time}
              type="button"
              key={slot.time}
              onClick={() => dispatch({ type: 'selectSlot', slot: slot.time, staff: slot.staff })}
            >
              <span className="slot-radio">✓</span>
              <span className="slot-main">
                <strong>
                  {slot.time} <small>（{slot.duration}）</small>
                </strong>
                <small>
                  {slot.room}　担当：{slot.staff}
                </small>
              </span>
              <span className="slot-status">空き</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="slot-empty">日付・時間・ご用件を選ぶと候補を表示します</div>
      )}
      <button
        className="btn block small side-footer-btn"
        type="button"
        onClick={() => dispatch({ type: 'setNotice', notice: '他の時間帯を表示しています' })}
      >
        他の時間も見る　⌄
      </button>
    </section>
  )
}

function Recording({ paused, dispatch }: { paused: boolean; dispatch: Send }) {
  return (
    <aside
      className={`recording-widget recording-panel ${paused ? 'is-paused' : ''}`}
      aria-live="polite"
      aria-label="通話録音状態"
    >
      <div className="recording-copy">
        <div className="recording-title">
          <span className="recording-dot" aria-hidden="true" />
          <strong>{paused ? '録音を一時停止中' : '通話を記録中'}</strong>
        </div>
        <time className="recording-elapsed">00:00</time>
      </div>
      <div className="recording-waveform" role="img" aria-label="音声波形">
        {[1, 2, 3, 4, 5, 6].map((bar) => (
          <span className="wave-bar" aria-hidden="true" key={bar} />
        ))}
      </div>
      <button
        className="recording-toggle recording-stop"
        type="button"
        aria-label={paused ? '録音を再開' : '録音を一時停止'}
        aria-pressed={paused}
        onClick={() => dispatch({ type: 'setRecordPaused' })}
      >
        {paused ? '▶' : 'Ⅱ'}
      </button>
    </aside>
  )
}

function Ledger({
  state,
  dispatch,
  onView,
}: {
  state: State
  dispatch: Send
  onView: (view: View) => void
}) {
  const times = ['09:00', '10:30', '12:00', '13:30', '14:00', '15:30', '17:00', '18:30']
  const columns = ['鈴木 明日香', '田中 健一', '佐藤 美咲', '山本 里奈', '検眼室 1', '検眼室 2']
  return (
    <PageChrome
      label="予約台帳"
      eyebrow="RESERVATION LEDGER"
      notice={state.notice}
      actions={
        <>
          <button
            className="btn"
            type="button"
            onClick={() => dispatch({ type: 'setNotice', notice: '前の日の台帳を表示しています' })}
          >
            ‹
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => dispatch({ type: 'setNotice', notice: '今日の台帳を表示しています' })}
          >
            今日
          </button>
          <button className="btn primary" type="button" onClick={() => onView('booking')}>
            ＋ 新しい予約
          </button>
        </>
      }
    >
      <div className="toolbar">
        <button
          className="btn small"
          type="button"
          onClick={() => dispatch({ type: 'setNotice', notice: 'すべての予約を表示しています' })}
        >
          すべての予約　⌄
        </button>
        <button
          className="btn small"
          type="button"
          onClick={() =>
            dispatch({ type: 'setNotice', notice: 'すべてのスタッフを表示しています' })
          }
        >
          すべてのスタッフ　⌄
        </button>
        <button
          className="btn small"
          type="button"
          onClick={() => dispatch({ type: 'setNotice', notice: 'すべての設備を表示しています' })}
        >
          すべての設備　⌄
        </button>
        <button
          className="btn small"
          type="button"
          onClick={() => dispatch({ type: 'setNotice', notice: '台帳を更新しました' })}
        >
          ↻
        </button>
      </div>
      <section className="view-card ledger-card">
        <div className="ledger-head">
          <div className="ledger-date">
            <button
              className="btn small"
              type="button"
              onClick={() =>
                dispatch({ type: 'setNotice', notice: '前の日の台帳を表示しています' })
              }
            >
              ‹
            </button>
            <strong>2025/05/20（火）</strong>
            <button
              className="btn small"
              type="button"
              onClick={() =>
                dispatch({ type: 'setNotice', notice: '次の日の台帳を表示しています' })
              }
            >
              ›
            </button>
          </div>
          <span className="pill">営業時間 10:00 〜 20:00</span>
        </div>
        <div className="ledger-grid-wrap">
          <div className="ledger-grid">
            <div className="ledger-header-row">
              <div className="grid-time-header">時間</div>
              {columns.map((column) => (
                <div className="grid-header" key={column}>
                  {column}
                  <small>{column.includes('室') ? '設備' : 'スタッフ'}</small>
                </div>
              ))}
            </div>
            {times.map((time) => (
              <div className="ledger-row" key={time}>
                <div className="time-cell">{time}</div>
                {columns.map((column) => {
                  const reservation = state.reservations.find(
                    (r) => r.time.startsWith(time) && (r.staff === column || r.room === column),
                  )
                  const roomDuplicate = reservation !== undefined && reservation.staff !== column
                  const reservationTone = reservation ? ` ${reservation.tone}` : ''
                  return (
                    <div className="empty-cell" key={column}>
                      {reservation && (
                        <button
                          aria-hidden={roomDuplicate}
                          className={`reservation-block${reservationTone}`}
                          type="button"
                          onClick={() =>
                            dispatch({ type: 'openReservation', reservationId: reservation.id })
                          }
                        >
                          <strong>{reservation.time}</strong>
                          <small>{reservation.name} 様</small>
                          <small>{reservation.purpose}</small>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="legend">
          <span>
            <i className="legend-dot" />
            検眼・カウンセリング
          </span>
          <span>
            <i className="legend-dot orange" />
            コンタクト相談
          </span>
          <span>
            <i className="legend-dot blue" />
            初回検眼
          </span>
          <span>予約ブロックをクリックすると詳細を表示</span>
        </div>
      </section>
    </PageChrome>
  )
}

function List({
  state,
  dispatch,
  onView,
}: {
  state: State
  dispatch: Send
  onView: (view: View) => void
}) {
  const rows = state.reservations.filter(
    (r) =>
      (state.listStaff === 'すべて' || r.staff === state.listStaff) &&
      (state.listDate === 'すべて' || r.date === state.listDate),
  )
  return (
    <PageChrome
      label="予約一覧"
      eyebrow="RESERVATIONS"
      notice={state.notice}
      actions={
        <>
          <button
            className="btn"
            type="button"
            onClick={() => dispatch({ type: 'setNotice', notice: '予約一覧を更新しました' })}
          >
            ↻ 更新
          </button>
          <button className="btn primary" type="button" onClick={() => onView('booking')}>
            ＋ 新しい予約
          </button>
        </>
      }
    >
      <div className="toolbar">
        <label className="field">
          <span className="sr-only">日付</span>
          <select
            className="select"
            aria-label="日付"
            value={state.listDate}
            onChange={(e) => dispatch({ type: 'setListDate', date: e.target.value })}
          >
            <option value="すべて">すべての日付</option>
            <option value="2025/05/20 (火)">2025/05/20（火）</option>
          </select>
        </label>
        <label className="field">
          <span className="sr-only">担当者で絞り込み</span>
          <select
            className="select"
            aria-label="担当者で絞り込み"
            value={state.listStaff}
            onChange={(e) => dispatch({ type: 'setListStaff', staff: e.target.value })}
          >
            <option>すべて</option>
            {['鈴木 明日香', '田中 健一', '佐藤 美咲'].map((person) => (
              <option key={person}>{person}</option>
            ))}
          </select>
        </label>
        <button
          className="btn small"
          type="button"
          onClick={() => {
            dispatch({ type: 'setListStaff', staff: 'すべて' })
            dispatch({ type: 'setListDate', date: '2025/05/20 (火)' })
            dispatch({ type: 'setNotice', notice: '絞り込みをクリアしました' })
          }}
        >
          クリア
        </button>
      </div>
      <section className="view-card list-card">
        <div className="list-head">
          <div>
            <h2>予約内容</h2>
            <p className="subtitle">{rows.length} 件の予約が表示されています</p>
          </div>
          <span className="pill">{state.listDate}</span>
        </div>
        <table className="list-table">
          <thead>
            <tr>
              <th>予約時間</th>
              <th>お客様</th>
              <th>ご要望</th>
              <th>担当者</th>
              <th>設備</th>
              <th>状況</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.time}</td>
                <td>
                  <button
                    className="table-customer"
                    type="button"
                    onClick={() => dispatch({ type: 'openReservation', reservationId: r.id })}
                  >
                    {r.name} 様
                  </button>
                </td>
                <td>{r.purpose}</td>
                <td>{r.staff}</td>
                <td>{r.room}</td>
                <td>
                  <span className={`pill ${r.status === '仮予約' ? 'orange' : ''}`}>
                    {r.status}
                  </span>
                </td>
                <td>
                  <button
                    className="btn small"
                    type="button"
                    onClick={() => dispatch({ type: 'openReservation', reservationId: r.id })}
                  >
                    詳細
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </PageChrome>
  )
}

function CustomerView({ state, dispatch }: { state: State; dispatch: Send }) {
  const customer = state.customers[0]
  if (!customer) return null
  const tabs = [
    ['visit', '来店履歴'],
    ['glasses', 'メガネ情報'],
    ['contact', 'コンタクト情報'],
    ['billing', '会計履歴'],
  ] as const
  const info =
    state.customerTab === 'glasses'
      ? ['フレーム　999.9 NP-400', 'レンズ　HOYA 遠近両用', '加入度数　+2.00']
      : state.customerTab === 'contact'
        ? ['右（R）　ワンデータイプ', '左（L）　ワンデータイプ', '交換周期　1日']
        : state.customerTab === 'billing'
          ? ['2024/12/15　メガネの作製　54,800 円', '2023/06/18　フィッティング調整　0 円']
          : [
              '2024/12/15　メガネの作製（遠近両用）',
              '2023/06/18　メガネのフィッティング調整',
              '2022/04/02　メガネの作製（単焦点）',
            ]
  const visitHistory = [
    ['2024/12/15（日）10:00', 'メガネの作製（遠近両用）', '担当：鈴木 明日香', '来店', ''],
    ['2023/06/18（日）11:00', 'メガネのフィッティング調整', '担当：田中 健一', '調整', 'blue'],
    ['2022/04/02（土）15:30', 'メガネの作製（単焦点）', '担当：鈴木 明日香', '購入', 'blue'],
  ] as const
  return (
    <PageChrome
      label="顧客カルテ"
      eyebrow="CUSTOMER RECORD"
      notice={state.notice}
      actions={
        <button
          className="btn"
          type="button"
          onClick={() => dispatch({ type: 'setNotice', notice: '顧客情報を編集しました' })}
        >
          顧客情報を編集
        </button>
      }
    >
      <div className="customer-layout">
        <aside className="profile-card">
          <div className="profile-head">
            <span className="avatar">{customer.name.slice(0, 1)}</span>
            <div>
              <strong>{customer.name} 様</strong>
              <small>
                {customer.gender}・{customer.age}
              </small>
            </div>
          </div>
          <div className="profile-details">
            <div className="profile-detail">
              <span>電話番号</span>
              <strong>{customer.phone}</strong>
            </div>
            <div className="profile-detail">
              <span>生年月日</span>
              <strong>{customer.birthday}</strong>
            </div>
            <div className="profile-detail">
              <span>会員ID</span>
              <strong>{customer.memberId}</strong>
            </div>
            <div className="profile-detail">
              <span>最終来店日</span>
              <strong>{customer.lastVisit}</strong>
            </div>
          </div>
          <p className="profile-purpose">{customer.purpose}</p>
          <button
            className="btn small block"
            type="button"
            onClick={() => dispatch({ type: 'setNotice', notice: '顧客情報を編集しました' })}
          >
            編集
          </button>
        </aside>
        <section className="view-card tabs-card">
          <div className="tab-list" role="tablist">
            {tabs.map(([id, label]) => (
              <button
                className="tab"
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
          <div className="tabpanel" role="tabpanel">
            <div className="history-list">
              <h3>{tabs.find(([id]) => id === state.customerTab)?.[1]}</h3>
              {state.customerTab === 'visit'
                ? visitHistory.map(([date, title, detail, badge, tone]) => (
                    <div className="history-row" key={date}>
                      <time>{date}</time>
                      <div>
                        <strong>{title}</strong>
                        <small>{detail}</small>
                      </div>
                      <span className={`pill ${tone}`}>{badge}</span>
                    </div>
                  ))
                : info.map((item) => (
                    <div className="history-row" key={item}>
                      <span>{item}</span>
                      <span className="pill">記録</span>
                    </div>
                  ))}
              <button
                className="btn block history-more"
                type="button"
                onClick={() =>
                  dispatch({ type: 'setNotice', notice: 'すべての履歴を表示しています' })
                }
              >
                すべての履歴を見る
              </button>
            </div>
          </div>
        </section>
        <aside className="note-card">
          <h3>
            お客様メモ{' '}
            <button
              className="btn small"
              type="button"
              onClick={() => dispatch({ type: 'setNotice', notice: 'メモ編集を開きました' })}
            >
              編集
            </button>
          </h3>
          <ul className="note-list">
            <li>運転時に視界がぼやけることがある</li>
            <li>夕方になると目が疲れやすい</li>
            <li>コンタクトレンズの使用歴あり</li>
          </ul>
        </aside>
      </div>
    </PageChrome>
  )
}

function Dashboard({
  state,
  dispatch,
  onView,
}: {
  state: State
  dispatch: Send
  onView: (view: View) => void
}) {
  const kpis = [
    ['本日の予約数', '12', '件', '確定 10件 / 仮予約 2件'],
    ['売上金額（本日）', '182,400', '円', '前日比 +12.5%'],
    ['来店予定数', '10', '組', '空き枠 5 件'],
    ['平均客単価', '18,240', '円', '前月比 +4.8%'],
  ] as const
  return (
    <PageChrome
      label="ダッシュボード"
      eyebrow="TODAY AT A GLANCE"
      notice={state.notice}
      actions={
        <button
          className="btn"
          type="button"
          onClick={() => dispatch({ type: 'setNotice', notice: '日付を選択できます' })}
        >
          2025/05/20（火）⌄
        </button>
      }
    >
      <div className="dashboard-grid">
        {kpis.map(([label, value, unit, change]) => (
          <div className="kpi-card" key={label}>
            <div className="kpi-label">{label}</div>
            <div className="kpi-value">
              {value}
              <span className="kpi-unit">{unit}</span>
            </div>
            <div className="kpi-change">{change}</div>
          </div>
        ))}
      </div>
      <div className="dashboard-lower">
        <section className="chart-card">
          <header>
            <h2>
              来店数の推移 <small>（過去7日間）</small>
            </h2>
            <button
              className="btn small"
              type="button"
              onClick={() => dispatch({ type: 'setNotice', notice: '週別表示に切り替えました' })}
            >
              週別　⌄
            </button>
          </header>
          <div className="chart-area">
            <svg
              className="chart-svg"
              viewBox="0 0 600 160"
              role="img"
              aria-label="過去7日間の来店数グラフ"
            >
              <polyline
                points="0,130 95,72 190,116 285,72 380,33 475,92 570,20"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
              />
              {[
                [0, 130],
                [95, 72],
                [190, 116],
                [285, 72],
                [380, 33],
                [475, 92],
                [570, 20],
              ].map(([cx, cy]) => (
                <circle
                  cx={cx}
                  cy={cy}
                  r="5"
                  fill="var(--color-glass-paper)"
                  stroke="currentColor"
                  strokeWidth="3"
                  key={`${cx}-${cy}`}
                />
              ))}
            </svg>
            <div className="chart-labels">
              <span>5/14</span>
              <span>5/15</span>
              <span>5/16</span>
              <span>5/17</span>
              <span>5/18</span>
              <span>5/19</span>
              <span>5/20</span>
            </div>
          </div>
        </section>
        <section className="chart-card">
          <header>
            <h2>
              ご要望カテゴリ比率 <small>（今月）</small>
            </h2>
            <button
              className="btn small"
              type="button"
              onClick={() =>
                dispatch({ type: 'setNotice', notice: '詳細レポートを表示しています' })
              }
            >
              詳細レポート
            </button>
          </header>
          <div className="donut-wrap">
            <div className="donut" role="img" aria-label="カテゴリ比率グラフ" />
            <ul className="donut-legend">
              <li>メガネの作製　45%</li>
              <li>メガネの調整　25%</li>
              <li>検眼・相談　20%</li>
              <li>コンタクト　10%</li>
            </ul>
          </div>
        </section>
      </div>
      <div className="page-actions end">
        <button className="btn primary" type="button" onClick={() => onView('list')}>
          予約一覧を見る
        </button>
      </div>
    </PageChrome>
  )
}

function DetailDrawer({
  reservation,
  dispatch,
  onChange,
  onClose,
}: {
  reservation: State['reservations'][number]
  dispatch: Send
  onChange: () => void
  onClose: () => void
}) {
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop closes the detail drawer */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: explicit close button provides keyboard access */}
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="detail-drawer" aria-label="予約詳細">
        <div className="drawer-head">
          <div>
            <span className={`pill ${reservation.status === '仮予約' ? 'orange' : ''}`}>
              {reservation.status}
            </span>
            <h2>予約詳細</h2>
          </div>
          <button
            className="close-button"
            type="button"
            aria-label="予約詳細を閉じる"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="detail-card">
          <div className="customer-summary">
            <span className="avatar">{reservation.name.slice(0, 1)}</span>
            <strong>{reservation.name} 様</strong>
          </div>
        </div>
        <div className="detail-card">
          <h3>予約内容</h3>
          <dl className="detail-list">
            <div>
              <dt>日時</dt>
              <dd>
                {reservation.date}
                <br />
                {reservation.time}
              </dd>
            </div>
            <div>
              <dt>ご要望</dt>
              <dd>{reservation.purpose}</dd>
            </div>
            <div>
              <dt>担当者</dt>
              <dd>{reservation.staff}</dd>
            </div>
            <div>
              <dt>設備</dt>
              <dd>{reservation.room}</dd>
            </div>
            <div>
              <dt>予約経路</dt>
              <dd>電話</dd>
            </div>
          </dl>
        </div>
        <div className="drawer-actions">
          <button
            className="btn primary block"
            type="button"
            onClick={() => dispatch({ type: 'setNotice', notice: '予約を確定しました' })}
          >
            確定する
          </button>
          <button className="btn block" type="button" onClick={onChange}>
            予約を変更
          </button>
          <button
            className="btn danger block"
            type="button"
            onClick={() => dispatch({ type: 'cancelReservation', reservationId: reservation.id })}
          >
            キャンセル
          </button>
        </div>
      </aside>
    </>
  )
}
function ChangeModal({
  reservation,
  dispatch,
  onClose,
}: {
  reservation: State['reservations'][number]
  dispatch: Send
  onClose: () => void
}) {
  const [date, setDate] = useState(() =>
    (reservation.date.split(' ')[0] ?? '').replaceAll('/', '-'),
  )
  const [time, setTime] = useState(reservation.time)
  const [staff, setStaff] = useState(reservation.staff)
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="change-title">
        <header>
          <div>
            <p className="eyebrow">EDIT RESERVATION</p>
            <h2 id="change-title">予約内容を変更</h2>
          </div>
          <button
            className="close-button"
            type="button"
            aria-label="変更を閉じる"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="control-grid">
          <label className="field full">
            <span className="field-label">変更後の日付</span>
            <input
              className="input"
              type="date"
              aria-label="変更後の日付"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">変更後の時間</span>
            <select
              className="select"
              aria-label="変更後の時間"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            >
              {slots.map((slot) => (
                <option key={slot.time}>{slot.time}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">変更後の担当者</span>
            <select
              className="select"
              aria-label="変更後の担当者"
              value={staff}
              onChange={(event) => setStaff(event.target.value)}
            >
              {['鈴木 明日香', '田中 健一', '佐藤 美咲'].map((person) => (
                <option key={person}>{person}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>
            戻る
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              dispatch({
                type: 'saveReservationChange',
                date,
                time,
                staff,
              })
              onClose()
            }}
          >
            変更を保存
          </button>
        </div>
      </section>
    </div>
  )
}
function MenuDrawer({ onView, onClose }: { onView: (view: View) => void; onClose: () => void }) {
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop closes the menu */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: explicit close button provides keyboard access */}
      <div className="menu-backdrop" onClick={onClose}>
        <aside className="menu-drawer" role="dialog" aria-modal="true" aria-label="メインメニュー">
          <div className="menu-drawer-head">
            <div>
              <span className="eyebrow">SMART RECEPTION</span>
              <h2>メニュー</h2>
            </div>
            <button
              className="close-button"
              type="button"
              aria-label="メニューを閉じる"
              onClick={onClose}
            >
              ×
            </button>
          </div>
          <nav className="menu-links">
            {menuViews.map(([view, label]) => (
              <a
                key={view}
                href={`?view=${view}`}
                onClick={(e) => {
                  e.preventDefault()
                  onView(view)
                }}
              >
                <span>{label}</span>
                <span aria-hidden="true">›</span>
              </a>
            ))}
          </nav>
        </aside>
      </div>
    </>
  )
}
