/**
 * はじめの設定（`014-store-provisioning`）。
 *
 * お店が 1 つも無い会社が最初に見る面。**左の柱を出さない** — 行き先（台帳・受付・
 * 分析）はどれもお店が無いと開けず、押しても何も起きない柱を並べるのは
 * この製品が自分に禁じていることである。
 *
 * 骨格は AdminLTE の `content-header` + `box`（`setup/parts.tsx`）。中身は
 * お店の登録ひとつだけに絞る。
 */
import type { Store, StoreInput } from '@app/contracts'
import { StartBar } from '../login/StartBar'
import { Box, ContentHeader } from './parts'
import { StoreForm } from './StoreForm'

export function SetupScreen({
  organizationId,
  existingCount = 0,
  send,
  onCreated,
  onCancel,
}: {
  organizationId: string
  existingCount?: number
  send: (input: StoreInput) => Promise<Response>
  onCreated: (store: Store) => void
  /** 2 店舗目以降は業務画面へ戻れる。最初の 1 店では戻る先が無いので渡さない。 */
  onCancel?: () => void
}) {
  const isFirst = existingCount === 0
  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      {/* お店がまだ無いので、上の帯に店名は出せない。会社のコードを出す。 */}
      {/*
        3 段が別々のことを言う。バー = どの会社にいるか、いまいる場所 = どの面か、
        見出し = 何をするか。同じ文を二度言わない。
      */}
      <StartBar title="EYE予約" mode={organizationId} showWorkPrefix={false} />
      <ContentHeader
        title={isFirst ? '最初のお店を登録します' : 'お店を追加します'}
        crumbs={['はじめの設定']}
        note={
          isFirst
            ? 'ここで登録したお店の名前が、ご予約票とお客様のページに出ます。登録するとすぐにご予約を受けられます。'
            : 'ここで登録したお店の名前が、ご予約票とお客様のページに出ます。'
        }
      />
      {/* 中身が少ないので上に張り付けず、画面の中で落ち着かせる。 */}
      <main className="flex flex-1 items-center justify-center overflow-auto px-11 py-8">
        <div className="grid w-full max-w-4xl gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <Box title="お店" footer="電話番号や住所、道順のご案内は、あとから設定で足せます。">
            <StoreForm
              organizationId={organizationId}
              existingCount={existingCount}
              send={send}
              onCreated={onCreated}
              onCancel={onCancel}
            />
          </Box>
          {/*
            一番の安心材料（何もしなくても受けられる状態から始まる）を、締めの
            小さな文に埋めない。AdminLTE の box をもう 1 枚立てて先に見せる。
          */}
          <Box title="はじめから入っています" footer="どれもあとから設定で変えられます。">
            <dl className="grid gap-3 text-body">
              <div>
                <dt className="text-note text-ink-muted">営業時間</dt>
                <dd className="text-ink">月〜土 10:00–19:00・日曜定休</dd>
              </div>
              <div>
                <dt className="text-note text-ink-muted">予約の間隔</dt>
                <dd className="text-ink">30 分・片付け 10 分・同時 3 件</dd>
              </div>
              <div>
                <dt className="text-note text-ink-muted">ご来店の目的</dt>
                {/* 中黒で 1 行に詰めると語の途中で折れる。3 行に開いて折らない。 */}
                <dd className="text-ink">
                  <ul>
                    <li>メガネを新しく作る</li>
                    <li>調整・修理</li>
                    <li>その他のご相談</li>
                  </ul>
                </dd>
              </div>
            </dl>
          </Box>
        </div>
      </main>
    </div>
  )
}
