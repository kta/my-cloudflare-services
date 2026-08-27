import {
  FlowButton,
  Option,
  OptionGrid,
  ProgressFooter,
  RailSummary,
  RecordIndicator,
  Script,
} from '../../design/booking'
import { AppBar, BarButton, BarPush, Screen, Wordmark } from '../../design/chrome'
import { BookingLayout } from '../../design/layouts'
import { Notice } from '../../design/surfaces'

/*
 * BOOK-TIME — 承認済みモック `approved.html#time`。実測は次のとおり。
 *
 *   .booking{grid-template-columns:1fr 390px;height:calc(100% - 76px)}
 *   .main{padding:38px 48px 112px}      → 主列の中身は x=48 / y=114 から
 *   .script small{13.33px/20}  .script h2{29px/43.5;margin:6px 0}
 *   .script p{margin:16px 0}            → 選択肢の格子は y=251.5
 *   .options{repeat(3,1fr);gap:12;margin-top:24}  → 1 枚 222x64
 *   .aside{padding:30px}  h3{18.72px;margin:18.72px 0}  → 要約は y=171.5
 *   .progress{height:88px} → y=726。主列の下余白 112px はこの帯のぶん。
 *
 * 時刻はまだ「受付できるか」を判定していない。ここで押さえるのは希望だけで、
 * 可否は来店目的（所要時間）が決まってから初めて答えが出る。案内の 1 枚が
 * その順序を先に伝えている。
 */

const TIMES = ['10:00', '10:30', '11:00', '13:00', '14:30', '16:00']

const SELECTED = '10:30'

export default function BookTime() {
  return (
    <Screen>
      <AppBar variant="booking">
        <Wordmark variant="booking" subtitle="銀座店 · 新規予約" />
        <BarPush variant="booking">
          <BarButton outline variant="booking">
            8月27日
          </BarButton>
        </BarPush>
      </AppBar>
      <BookingLayout
        main={
          <>
            <Script step="2 / 5　時間" question="ご来店予定の時刻を伺えますか？">
              <p>ここでは希望時刻を伺います。来店目的を選んだ後に受付可能か確認します。</p>
            </Script>
            <OptionGrid label="希望時刻">
              {TIMES.map((time) => (
                <Option key={time} selected={time === SELECTED}>
                  {time}
                </Option>
              ))}
            </OptionGrid>
          </>
        }
        rail={
          <>
            <h2>ここまでの内容</h2>
            <RailSummary>8月27日（水）</RailSummary>
            <Notice>来店目的の選択後、所要時間・スタッフ・設備を確認します。</Notice>
          </>
        }
      />
      <ProgressFooter
        back={<FlowButton>戻る</FlowButton>}
        record={<RecordIndicator elapsed="01:08" label="録音中" />}
        steps={[
          { label: '日', state: 'done' },
          { label: '時間', state: 'current' },
          { label: '来店目的', state: 'todo' },
          { label: 'お客様情報', state: 'todo' },
          { label: '復唱する', state: 'todo' },
        ]}
      />
    </Screen>
  )
}
