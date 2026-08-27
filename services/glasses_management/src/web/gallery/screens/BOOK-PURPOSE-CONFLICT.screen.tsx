import {
  FieldButton,
  FlowButton,
  Option,
  OptionGrid,
  ProgressFooter,
  RecordIndicator,
  Script,
} from '../../design/booking'
import { AppBar, BarButton, BarPush, Screen, Wordmark } from '../../design/chrome'
import { BookingLayout } from '../../design/layouts'
import { Notice } from '../../design/surfaces'

/*
 * BOOK-PURPOSE-CONFLICT — 承認済みモック `approved.html#purpose-conflict`。
 *
 *   .options{margin-top:24px}          → 選択肢は y=211.5、1 枚 222x82（2 行）
 *   .notice{padding:14px;border-radius:8px}
 *                                      → 選択肢の直下 y=293.5、余白なしで続く
 *   .aside .field{min-height:64px;padding:14px;display:inline-block}
 *                                      → 幅は中身が決め、2 つ入って折り返す
 *
 * 受付できないことを、選んだ選択肢を消さずに伝える面。案内が選択肢に密着して
 * いるのは、「今押したもの」への返答だと読ませるため。代替時刻をレールへ置くのは、
 * 目的を選び直すか時刻を選び直すかを、お客様に聞きながら選べるようにするため。
 */

const PURPOSES = [
  { label: 'メガネを新しく作りたい', duration: '約60分' },
  { label: '今のメガネを調整したい', duration: '約20分' },
  { label: '受け取りたい', duration: '約20分' },
]

const ALTERNATIVES = ['10:00　受付可能', '11:00　受付可能', '13:30　受付可能']

export default function BookPurposeConflict() {
  return (
    <Screen>
      <AppBar variant="booking">
        <Wordmark variant="booking" subtitle="銀座店 · 新規予約" />
        <BarPush variant="booking">
          <BarButton outline variant="booking">
            8月27日 10:30
          </BarButton>
        </BarPush>
      </AppBar>
      <BookingLayout
        main={
          <>
            <Script step="3 / 5　来店目的" question="今回のご来店目的を伺えますか？" />
            <OptionGrid label="来店目的">
              {PURPOSES.map((purpose, index) => (
                <Option key={purpose.label} selected={index === 0}>
                  {purpose.label}
                  <br />
                  <small>{purpose.duration}</small>
                </Option>
              ))}
            </OptionGrid>
            <Notice>
              <strong>10:30は60分の受付ができません</strong>
              <br />
              入力内容は保持しています。10:00、11:00、13:30から代替時刻を選べます。
            </Notice>
          </>
        }
        rail={
          <>
            <h2>代替時刻</h2>
            {/*
             * 候補どうしの間に空白を置かない。モックは inline-block を隙間なく
             * 並べており、間に改行を挟むと 4px の空白が入って 2 つ目が折り返す。
             */}
            {ALTERNATIVES.map((slot) => (
              <FieldButton key={slot}>{slot}</FieldButton>
            ))}
          </>
        }
      />
      <ProgressFooter
        back={<FlowButton>戻る</FlowButton>}
        record={<RecordIndicator elapsed="01:42" label="録音中" />}
        steps={[
          { label: '日', state: 'done' },
          { label: '時間', state: 'done' },
          { label: '来店目的', state: 'current' },
          { label: 'お客様情報', state: 'todo' },
          { label: '復唱する', state: 'todo' },
        ]}
      />
    </Screen>
  )
}
