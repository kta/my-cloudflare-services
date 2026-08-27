import {
  GuidePhoneBody,
  GuidePhoneBottom,
  GuidePhoneField,
  GuidePhoneHead,
  GuidePhoneProgress,
  GuidePhoneRow,
  PhoneStatusBar,
} from '../../design/phone'

/*
 * SETTINGS-SP — 承認済みモック `settings-responsive-approved.html`（375×790）。
 *
 * iPad 版と同じ 6 工程だが、寸法体系も緑も別に組まれている。工程は縦のレール
 * ではなく丸と線で 6 つ常時出し、工程を進める操作は下端に固定する。狭い画面で
 * 本文の末尾に置くと、読み終えた位置と押す位置が毎回変わる。
 *
 * 「Web」ではなく「Web予約」と表示する（設定の中の節の名前ではなく、
 * お客様から見た予約経路の名前で呼ぶ）。
 */

const STEPS = [
  { label: '店舗', state: 'done' },
  { label: '目的', state: 'done' },
  { label: 'スタッフ', state: 'done' },
  { label: '設備', state: 'done' },
  { label: 'Web予約', state: 'current' },
  { label: '確認', state: 'todo' },
] as const

export default function SettingsSp() {
  return (
    /*
     * 端末いっぱいの白い面。下端の主操作を貼り付ける基準がここになる。
     *
     * 行間はモックのまま `normal` にする。この面のモックだけ body に
     * `font-family` しか書いておらず、他の面の `font:16px/1.5` と違って行間が
     * 書体の既定値で決まっている。1.5 を敷くと 9px・7px の段の行箱が広がり、
     * 工程帯から下が丸ごとずれる。
     */
    <div
      className="relative flex h-dvh min-h-0 flex-col overflow-hidden bg-surface font-sans text-sp-ink"
      style={{ lineHeight: 'normal' }}
    >
      <PhoneStatusBar time="9:41" right="5G　100%" />
      <GuidePhoneHead subtitle="銀座店 · 設定ガイド" />
      <GuidePhoneProgress heading="5 / 6　Web予約の公開" remaining="残り1工程" steps={[...STEPS]} />
      <GuidePhoneBody>
        <h1 className="text-sp-title">Web予約の公開設定</h1>
        <GuidePhoneField title="公開状態" changed>
          9月15日 10:00に公開
        </GuidePhoneField>
        <GuidePhoneField title="予約可能期間">60日先まで</GuidePhoneField>
        <GuidePhoneRow state="公開">
          <b className="font-bold">新調相談</b>
          <br />
          75分 · 18枠/週
        </GuidePhoneRow>
        <GuidePhoneRow state="公開">
          <b className="font-bold">フィッティング調整</b>
          <br />
          20分 · 32枠/週
        </GuidePhoneRow>
      </GuidePhoneBody>
      <GuidePhoneBottom>影響を確認する</GuidePhoneBottom>
    </div>
  )
}
