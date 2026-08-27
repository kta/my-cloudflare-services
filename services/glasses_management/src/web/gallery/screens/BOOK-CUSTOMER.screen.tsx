import {
  AttentionCard,
  Candidate,
  FlowButton,
  ProgressFooter,
  RailSummary,
  RecordIndicator,
  Script,
} from '../../design/booking'
import { AppBar, BarButton, BarPush, Screen, Wordmark } from '../../design/chrome'
import { SearchValue } from '../../design/controls'
import { BookingLayout } from '../../design/layouts'

/*
 * BOOK-CUSTOMER — 承認済みモック `approved.html#customer`。
 *
 *   .search{min-height:56px;border:2px solid var(--g);padding:15px;font-size:20px}
 *                                → 見出しの直下 y=193.5、実高 64px
 *   .candidates{margin-top:14px} .candidate{margin-top:8px;padding:14px;
 *       display:flex;justify-content:space-between}
 *                                → 選択中は 3px 枠で 82px、他は 78px / 64px
 *   .aside .summary → .attention → .summary の順で余白は summary 側が持つ
 *
 * 電話番号は途中まで（`090-1234`）で候補が出る。お客様が言い終える前に画面が
 * 追い付いている状態を、そのまま静止画にしたのがこの面である。
 */

export default function BookCustomer() {
  return (
    <Screen>
      <AppBar variant="booking">
        <Wordmark variant="booking" subtitle="銀座店 · 新規予約" />
        <BarPush variant="booking">
          <BarButton outline variant="booking">
            8月27日 11:00 · 新調相談
          </BarButton>
        </BarPush>
      </AppBar>
      <BookingLayout
        main={
          <>
            <Script step="4 / 5　お客様情報" question="お電話番号を伺えますか？" />
            <SearchValue label="お電話番号">090-1234</SearchValue>
            <div className="mt-3.5">
              <Candidate state="選択中" selected>
                <b>田中 花子 様</b>
                <br />
                090-1234-5678 · 銀座店4回
              </Candidate>
              <Candidate state="候補">
                <b>田中 一郎 様</b>
                <br />
                090-1234-9912 · 銀座店1回
              </Candidate>
              <Candidate>新しいお客様として登録する</Candidate>
            </div>
          </>
        }
        rail={
          <>
            <h2>選択中のお客様</h2>
            <RailSummary>
              <b>現在の度数</b>
              <br />R -2.25 / L -2.00 / PD 62.0
            </RailSummary>
            <AttentionCard>
              <b>対応時に確認</b>
              <br />
              度数変更の理由を段階的に説明する。
              <br />
              <small>根拠: 2026.02.10の接客記録</small>
            </AttentionCard>
            <RailSummary>
              <b>最新メモ</b>
              <br />
              PC作業用。鼻パッドは低め。
            </RailSummary>
          </>
        }
      />
      <ProgressFooter
        back={<FlowButton>戻る</FlowButton>}
        record={<RecordIndicator elapsed="02:14" label="録音中" />}
        steps={[
          { label: '日', state: 'done' },
          { label: '時間', state: 'done' },
          { label: '来店目的', state: 'done' },
          { label: 'お客様情報', state: 'current' },
          { label: '復唱する', state: 'todo' },
        ]}
      />
    </Screen>
  )
}
