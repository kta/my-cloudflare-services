import {
  FlowButton,
  ProgressFooter,
  RailSummary,
  Readout,
  RecordIndicator,
  Script,
} from '../../design/booking'
import { AppBar, Screen, Wordmark } from '../../design/chrome'
import { BookingLayout } from '../../design/layouts'

/*
 * BOOK-REPEAT — 承認済みモック `approved.html#repeat`。
 *
 *   .readout{font-size:25px;line-height:1.8;padding:28px;border-radius:12px}
 *                                → 見出しの直下 y=193.5、5 行で 238px
 *   .aside .summary → .btn（幅 100%・緑地）  → 操作は y=295.5
 *
 * バーに日付・時刻の要約を置かないのは、この面で読むべき文が復唱文ひとつだけ
 * だからである。副題も「最終確認」に変わる。確定操作をレール側へ置いたのは、
 * 復唱を終える前に主列の勢いで押させないため。
 */

export default function BookRepeat() {
  return (
    <Screen>
      <AppBar variant="booking">
        <Wordmark variant="booking" subtitle="銀座店 · 最終確認" />
      </AppBar>
      <BookingLayout
        main={
          <>
            <Script step="5 / 5　復唱する" question="次の内容を、お客様へそのままお伝えください" />
            <Readout>
              「8月27日、水曜日の午前11時に、EYEX予約
              銀座店で、視力測定とメガネの新調相談を承りました。所要時間は約60分です。田中花子様、お電話番号は090-1234-5678でお間違いないでしょうか？」
            </Readout>
          </>
        }
        rail={
          <>
            <h2>確保する接客資源</h2>
            <RailSummary>
              佐藤 美咲
              <br />
              視力測定機 A
              <br />
              相談カウンター 2
            </RailSummary>
            <FlowButton primary>復唱を終えて予約を確定する</FlowButton>
          </>
        }
      />
      <ProgressFooter
        back={<FlowButton>戻る</FlowButton>}
        record={<RecordIndicator elapsed="02:38" label="録音中" />}
        steps={[
          { label: '日', state: 'done' },
          { label: '時間', state: 'done' },
          { label: '来店目的', state: 'done' },
          { label: 'お客様情報', state: 'done' },
          { label: '復唱する', state: 'current' },
        ]}
      />
    </Screen>
  )
}
