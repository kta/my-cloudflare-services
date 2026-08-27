import type { StorePermission } from '@app/contracts'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { screenSections } from './app-chrome'
import { SettingsScreen } from './SettingsScreen'
import { choosePickerOption } from './test/picker'

const STORE_ID = '00000000-0000-4000-8000-000000000010'
const TODAY = '2026-08-27'
const PURPOSE_A = '00000000-0000-4000-8000-000000000101'
const PURPOSE_B = '00000000-0000-4000-8000-000000000102'
const STAFF_A = '00000000-0000-4000-8000-000000000201'
const EQUIPMENT_A = '00000000-0000-4000-8000-000000000301'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

const settings = {
  storeId: STORE_ID,
  version: 3,
  receptionStatus: 'open' as const,
  businessHours: [
    { dayOfWeek: 0, periods: [{ startTime: '10:00', endTime: '18:00' }] },
    { dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '19:00' }] },
    { dayOfWeek: 2, periods: [] },
    { dayOfWeek: 3, periods: [{ startTime: '10:00', endTime: '19:00' }] },
    { dayOfWeek: 4, periods: [{ startTime: '10:00', endTime: '19:00' }] },
    { dayOfWeek: 5, periods: [{ startTime: '10:00', endTime: '19:00' }] },
    { dayOfWeek: 6, periods: [{ startTime: '10:00', endTime: '19:00' }] },
  ],
  exceptions: [
    {
      date: '2026-09-23',
      mode: 'open' as const,
      periods: [{ startTime: '10:00', endTime: '17:00' }],
      reason: '祝日臨時営業',
    },
  ],
  purposes: [
    {
      id: PURPOSE_A,
      staffName: '視力測定・新調相談',
      customerLabel: 'メガネを新しく作りたい',
      durationMinutes: 60,
      slotIntervalMinutes: 15,
      isPublic: true,
      requiredSkills: ['眼鏡作製技能'],
      requiredEquipment: ['視力測定機'],
      maxConcurrent: 1,
    },
    {
      id: PURPOSE_B,
      staffName: 'フィッティング調整',
      customerLabel: 'かけ心地を調整したい',
      durationMinutes: 20,
      slotIntervalMinutes: 10,
      isPublic: false,
      requiredSkills: ['調整'],
      requiredEquipment: ['調整台'],
      maxConcurrent: 2,
    },
  ],
  staff: [
    {
      id: STAFF_A,
      name: '佐藤 美咲',
      skills: ['眼鏡作製技能', '調整'],
      canBook: true,
      isActive: true,
    },
  ],
  shifts: [
    {
      id: '00000000-0000-4000-8000-000000000401',
      staffId: STAFF_A,
      date: TODAY,
      startTime: '10:00',
      endTime: '18:00',
      breaks: [{ startTime: '13:00', endTime: '14:00' }],
    },
  ],
  equipment: [
    {
      id: EQUIPMENT_A,
      name: '視力測定機',
      capacity: 2,
      isActive: true,
      availablePeriods: [{ startTime: '10:00', endTime: '19:00' }],
    },
  ],
  maintenance: [
    {
      id: '00000000-0000-4000-8000-000000000501',
      equipmentId: EQUIPMENT_A,
      date: '2026-09-10',
      startTime: '13:00',
      endTime: '17:00',
      reason: '定期点検',
    },
  ],
}

const MANAGER: StorePermission[] = ['settings.read', 'settings.manage']
const VIEWER: StorePermission[] = ['settings.read']

function renderScreen(
  api: ReturnType<typeof vi.fn>,
  extra: Partial<Parameters<typeof SettingsScreen>[0]> = {},
) {
  return render(
    <SettingsScreen
      storeId={STORE_ID}
      storeName="銀座店"
      api={api as never}
      navigate={vi.fn()}
      today={TODAY}
      permissions={MANAGER}
      {...extra}
    />,
  )
}

function settingsApi(body: unknown = settings) {
  return vi.fn(async () => jsonResponse(body))
}

/**
 * 6 工程は面の中ではなく全画面共通の柱にある（柱を 2 本立てない）。面だけを
 * 描くテストからは、柱が押したときと同じ口を叩いて工程を選ぶ。
 */
async function openStep(name: RegExp) {
  await waitFor(() => {
    expect(screenSections.snapshot().some((section) => name.test(section.name ?? ''))).toBe(true)
  })
  const step = screenSections.snapshot().find((section) => name.test(section.name ?? ''))
  act(() => {
    screenSections.select(step?.label ?? '')
  })
}

/**
 * 本文は読み取りカードが既定で、入力欄は「編集」の先にある（承認済みモック
 * settings-complete-approved.html）。編集を伴うテストはここを通す。
 */
async function openEditor() {
  fireEvent.click(await screen.findByRole('button', { name: '編集' }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

test('六工程が定められた順に表示され、Web予約は略されない (AC-EYEX-40, 74)', async () => {
  renderScreen(settingsApi())

  // 設定を読み終えるまでは全工程が未完了なので、状態が定まるまで待つ。
  await waitFor(() => {
    expect(screenSections.snapshot().map((step) => step.name)).toEqual([
      '工程1 店舗と営業時間 編集中',
      '工程2 来店目的 完了',
      '工程3 スタッフと技能 完了',
      '工程4 設備と点検 完了',
      '工程5 Web予約 未完了',
      '工程6 影響確認と公開 未完了',
    ])
  })
  const steps = screenSections.snapshot()
  // 略語 `Web` 単体はどの幅でも出さない。
  expect(steps.map((step) => step.label)).not.toContain('Web')
  // 柱に出るのは番号か ✓ と工程名だけ。承認済みモックに状態語は無い。
  expect(steps[0]?.label).toBe('1\u3000店舗と営業時間')
  expect(steps[1]?.label).toBe('✓\u3000来店目的')
  expect(steps[4]?.label).toBe('5\u3000Web予約')
})

test('工程の状態は色ではなく語で読み取れる (AC-EYEX-41)', async () => {
  renderScreen(settingsApi())

  // 状態は色ではなく語で読める。ただし柱の見た目はモックどおり番号と ✓
  // だけなので、語は読み上げの名前が持つ。
  await waitFor(() => {
    expect(screenSections.snapshot().map((step) => step.name)).toContain('工程2 来店目的 完了')
  })
  const names = screenSections.snapshot().map((step) => step.name)
  expect(names).toContain('工程5 Web予約 未完了')
  expect(names).toContain('工程1 店舗と営業時間 編集中')
})

test('日常の修正はガイドを最初から進めずに対象工程へ直接移動できる (AC-EYEX-47)', async () => {
  renderScreen(settingsApi())

  await openStep(/工程4 設備と点検/)

  expect(screen.getByRole('heading', { level: 1, name: '設備と点検' })).toBeInTheDocument()
  await waitFor(() => {
    expect(screenSections.snapshot().map((step) => step.name)).toContain('工程4 設備と点検 編集中')
  })
  // 柱の現在地は開いている工程を指す。
  expect(screenSections.snapshot().find((step) => step.current)?.label).toBe('4\u3000設備と点検')
})

test('SP幅の固定ステッパーは番号・全6工程・残り工程数・状態を色なしで示す (AC-EYEX-72, 73)', async () => {
  renderScreen(settingsApi())

  await openStep(/工程5 Web予約/)

  const stepper = screen.getByRole('navigation', { name: '設定の工程' })
  expect(within(stepper).getByText('5 / 6 Web予約')).toBeInTheDocument()
  expect(within(stepper).getByText('残り1工程')).toBeInTheDocument()
  expect(within(stepper).getByText('現在の状態: 編集中')).toBeInTheDocument()
  // 丸と線で 6 工程を並べる。横スクロールを持ち込まない。
  expect(stepper.className).not.toMatch(/overflow-x-auto|overflow-x-scroll/)
})

test('営業時間・休業日・臨時営業・受付停止を編集できる (UC-EYEX-087, AC-EYEX-65)', async () => {
  renderScreen(settingsApi())

  // 読み取りカードが先に出る（モックの `.field`）。
  expect(await screen.findByText(/月–土 10:00–19:00/)).toBeInTheDocument()
  expect(screen.getByText(/日 10:00–18:00/)).toBeInTheDocument()
  expect(screen.getByText('毎週火曜日')).toBeInTheDocument()
  expect(screen.getByText('9月23日 10:00–17:00')).toBeInTheDocument()

  await openEditor()
  const start = await screen.findByLabelText('月曜の営業開始')
  expect(start).toHaveValue('10:00')
  fireEvent.change(start, { target: { value: '09:30' } })
  expect(screen.getByLabelText('月曜の営業開始')).toHaveValue('09:30')

  // 定休日は営業チェックが外れている。
  expect(screen.getByLabelText('火曜を営業日にする')).not.toBeChecked()

  const exceptions = screen.getByRole('list', { name: '臨時営業・休業日' })
  expect(within(exceptions).getByText(/2026-09-23/)).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('日付'), { target: { value: '2026-10-01' } })
  fireEvent.change(screen.getByLabelText('区分'), { target: { value: 'closed' } })
  fireEvent.change(screen.getByLabelText('理由'), { target: { value: '棚卸' } })
  fireEvent.click(screen.getByRole('button', { name: '臨時設定を追加' }))
  expect(within(exceptions).getByText(/2026-10-01/)).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('受付状態'), { target: { value: 'paused' } })
  expect(
    screen.getByText('受付停止は新しいWeb予約だけを止めます。既存予約は取り消されません。'),
  ).toBeInTheDocument()
})

test('顧客向け表示名をスタッフ向け名称と別に編集し、その場でプレビューできる (UC-EYEX-118, AC-EYEX-42, 67)', async () => {
  renderScreen(settingsApi())
  await openStep(/工程2 来店目的/)

  fireEvent.click(screen.getByRole('button', { name: '視力測定・新調相談' }))
  const preview = screen.getByRole('region', { name: 'Web予約プレビュー' })
  expect(within(preview).getByText(/メガネを新しく作りたい/)).toBeInTheDocument()
  expect(within(preview).getByText(/約60分/)).toBeInTheDocument()

  await openEditor()
  fireEvent.change(screen.getByLabelText('顧客向け表示名'), {
    target: { value: '新しいメガネを相談したい' },
  })
  fireEvent.change(screen.getByLabelText('標準所要時間（分）'), { target: { value: '75' } })

  expect(within(preview).getByText(/新しいメガネを相談したい/)).toBeInTheDocument()
  expect(within(preview).getByText(/約75分/)).toBeInTheDocument()
  // スタッフ向け名称は連動して書き換わらない。
  expect(screen.getByLabelText('スタッフ向け名称')).toHaveValue('視力測定・新調相談')
})

test('来店目的を非公開にしても既存予約と履歴は削除されない (UC-EYEX-122, AC-EYEX-70)', async () => {
  const api = settingsApi()
  renderScreen(api)
  await openStep(/工程2 来店目的/)
  fireEvent.click(screen.getByRole('button', { name: '視力測定・新調相談' }))
  await openEditor()

  fireEvent.click(screen.getByLabelText('Web予約に公開する'))
  expect(
    screen.getByText('非公開にすると新規の選択肢から外れます。既存予約と履歴は削除されません。'),
  ).toBeInTheDocument()

  api.mockResolvedValueOnce(jsonResponse({ ...settings, version: 4 }))
  fireEvent.click(screen.getByRole('button', { name: '設定を保存' }))

  await waitFor(() => expect(api).toHaveBeenCalledTimes(2))
  const [, init] = api.mock.calls[1] as unknown as [string, RequestInit]
  const payload = JSON.parse(String(init.body))
  expect(payload.version).toBe(3)
  expect(payload.purposes).toHaveLength(2)
  expect(payload.purposes[0].isPublic).toBe(false)
  // 何も消さない: 予約に紐づく履歴側の配列はそのまま送る。
  expect(payload.shifts).toHaveLength(1)
  expect(payload.maintenance).toHaveLength(1)
})

test('新規店舗には標準テンプレートの初期値が提示される (UC-EYEX-117, AC-EYEX-68)', async () => {
  const api = settingsApi({ ...settings, purposes: [] })
  renderScreen(api)
  await openStep(/工程2 来店目的/)

  const template = screen.getByRole('region', { name: '標準テンプレート' })
  expect(within(template).getByText('視力測定・新調相談')).toBeInTheDocument()
  expect(within(template).getByText('メガネを新しく作りたい')).toBeInTheDocument()
  expect(within(template).getByText(/60分/)).toBeInTheDocument()
  expect(within(template).getByText(/眼鏡作製技能/)).toBeInTheDocument()
  expect(within(template).getByText(/視力測定機/)).toBeInTheDocument()
  expect(within(template).getAllByText(/公開/).length).toBeGreaterThan(0)

  fireEvent.click(screen.getByRole('button', { name: '標準テンプレートを読み込む' }))
  expect(screen.getByRole('button', { name: 'フィッティング調整' })).toBeInTheDocument()
})

test('スタッフの技能・勤務・休憩・受付可否を編集できる (UC-EYEX-090)', async () => {
  renderScreen(settingsApi())
  await openStep(/工程3 スタッフと技能/)

  // 読み取りカードは 1 人 1 枚。技能は名前と同じ行に続く。
  expect(screen.getByText(/眼鏡作製技能・調整/)).toBeInTheDocument()
  expect(screen.getByText(/勤務 10:00–18:00 · 休憩 13:00–14:00 · 予約受付可/)).toBeInTheDocument()

  await openEditor()
  const skills = screen.getByLabelText('佐藤 美咲の技能')
  expect(skills).toHaveValue('眼鏡作製技能, 調整')
  fireEvent.change(skills, { target: { value: '眼鏡作製技能' } })
  expect(screen.getByLabelText('佐藤 美咲の勤務開始')).toHaveValue('10:00')
  expect(screen.getByLabelText('佐藤 美咲の休憩開始')).toHaveValue('13:00')
  const canBook = screen.getByLabelText('佐藤 美咲は予約を受け付ける')
  expect(canBook).toBeChecked()
  fireEvent.click(canBook)
  expect(screen.getByLabelText('佐藤 美咲は予約を受け付ける')).not.toBeChecked()
})

test('設備の台数・利用可能時間・点検停止を編集できる (UC-EYEX-091)', async () => {
  renderScreen(settingsApi())
  await openStep(/工程4 設備と点検/)

  // 点検停止も設備と同じ 1 枚のカードに並ぶ（モック `測定機B · 9/10 13:00–17:00`）。
  expect(await screen.findByText('2台 · 10:00–19:00')).toBeInTheDocument()
  expect(screen.getByText(/視力測定機 · 9\/10 13:00–17:00/)).toBeInTheDocument()
  expect(screen.getByText(/定期点検/)).toBeInTheDocument()

  await openEditor()
  const capacity = screen.getByLabelText('視力測定機の台数')
  expect(capacity).toHaveValue(2)
  fireEvent.change(capacity, { target: { value: '3' } })
  expect(screen.getByLabelText('視力測定機の利用可能開始')).toHaveValue('10:00')
})

test('Web予約設定の公開状態・公開期間・目的・受付条件が表示される (AC-EYEX-63, UC-EYEX-109〜113)', async () => {
  renderScreen(settingsApi(), {
    webBooking: {
      id: '00000000-0000-4000-8000-000000000601',
      organizationId: 'org-eyex',
      storeId: STORE_ID,
      publicSlug: 'ginza',
      status: 'hidden',
      startsAt: '2026-09-15T01:00:00.000Z',
      endsAt: null,
      contactPhone: '03-1234-5678',
      accessText: '銀座駅A2出口 徒歩3分',
      notice: '保険証をお持ちください',
      region: '東京都',
      nearestStation: '銀座',
      latitude: null,
      longitude: null,
      publicPurposeIds: [PURPOSE_A],
      version: 2,
      publishedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
    },
    webBookingRules: {
      bookableDays: 60,
      cutoffMinutes: 120,
      changeDeadline: '前日18:00',
      afterDeadlineGuidance: '銀座店へお電話ください',
    },
  })
  await openStep(/工程5 Web予約/)

  const web = screen.getByRole('region', { name: 'Web予約設定' })
  // モックの 6 枚のカードは、この見出しとこの語で並ぶ。
  for (const term of [
    '公開状態',
    '受付終了',
    '予約可能期間',
    '直前受付期限',
    '変更・取消期限',
    '期限後の案内',
  ]) {
    expect(within(web).getByText(term)).toBeInTheDocument()
  }
  expect(within(web).getByText('9月15日 10:00に公開')).toBeInTheDocument()
  expect(within(web).getByText('設定なし')).toBeInTheDocument()
  expect(within(web).getAllByText('視力測定・新調相談').length).toBeGreaterThan(0)
  expect(within(web).getByText('60日先まで')).toBeInTheDocument()
  expect(within(web).getByText('開始2時間前')).toBeInTheDocument()
  expect(within(web).getByText('前日18:00')).toBeInTheDocument()
  expect(within(web).getByText('銀座店へお電話ください')).toBeInTheDocument()

  const preview = screen.getByRole('region', { name: '店舗ページプレビュー' })
  expect(
    within(preview).getByText('店舗名、アクセス、電話番号、注意事項をプレビュー'),
  ).toBeInTheDocument()
  expect(within(preview).getByText('銀座店')).toBeInTheDocument()
  expect(within(preview).getByText('銀座駅A2出口 徒歩3分')).toBeInTheDocument()
  expect(within(preview).getByText('03-1234-5678')).toBeInTheDocument()
  expect(within(preview).getByText('保険証をお持ちください')).toBeInTheDocument()
})

test('Web予約の公開状態・公開期間・公開する来店目的はその場で編集できる (UC-EYEX-109〜111, AC-EYEX-63)', async () => {
  renderScreen(settingsApi(), {
    webBooking: {
      id: '00000000-0000-4000-8000-000000000601',
      organizationId: 'org-eyex',
      storeId: STORE_ID,
      publicSlug: 'ginza',
      status: 'hidden',
      startsAt: '2026-09-15T01:00:00.000Z',
      endsAt: null,
      contactPhone: '03-1234-5678',
      accessText: '銀座駅A2出口 徒歩3分',
      notice: '保険証をお持ちください',
      region: '東京都',
      nearestStation: '銀座',
      latitude: null,
      longitude: null,
      publicPurposeIds: [PURPOSE_A],
      version: 2,
      publishedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
    },
  })
  await openStep(/工程5 Web予約/)

  await openEditor()
  const web = screen.getByRole('region', { name: 'Web予約設定' })
  const status = within(web).getByRole('combobox', { name: '公開状態' })
  expect(status).toHaveTextContent('非公開')
  choosePickerOption(status, '公開')
  expect(within(web).getByText('公開中')).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('受付終了日時（JST）'), {
    target: { value: '2026-10-01T18:00' },
  })
  expect(within(web).getByText('2026年10月1日 18:00')).toBeInTheDocument()

  // 公開する来店目的は目的ごとに切り替えられる。
  const publish = screen.getByLabelText('フィッティング調整をWeb予約に公開する')
  expect(publish).not.toBeChecked()
  fireEvent.click(publish)
  expect(within(web).getByText('視力測定・新調相談、フィッティング調整')).toBeInTheDocument()

  // 保存先の API がまだ無いことを黙らない。
  expect(
    screen.getByText(
      'Web予約の公開設定を保存するAPIはまだありません。ここでの変更は保存されません。',
    ),
  ).toBeInTheDocument()
})

test('Web予約公開APIが未提供のあいだは未取得と明示する (AC-EYEX-63, 71)', async () => {
  renderScreen(settingsApi())
  await openStep(/工程5 Web予約/)

  const web = screen.getByRole('region', { name: 'Web予約設定' })
  expect(within(web).getAllByText('未取得').length).toBeGreaterThan(0)
  expect(screen.getByText('Web予約の公開設定はまだ取得できていません。')).toBeInTheDocument()
})

/*
 * モックのこの位置（`.title` の右端）には `下書き保存 14:32` のような分かって
 * いる事実しか無い。`適用元: 未取得` はモックの語彙に無い失敗文言なので、
 * 適用元が渡されるまでは何も名乗らない（推測した既定値も描かない）。
 */
test('適用元が渡されないうちは適用元を名乗らない (AC-EYEX-48, 69)', async () => {
  renderScreen(settingsApi())
  await screen.findByRole('region', { name: '店舗設定' })
  expect(screen.queryByText(/適用元:/)).toBeNull()
})

test('全店共通の適用元が渡されると上書き項目を区別できる (AC-EYEX-48, 69)', async () => {
  renderScreen(settingsApi(), {
    chainDefaults: { source: 'chain', overriddenFields: ['営業時間'] },
  })

  expect(await screen.findByText('適用元: 全店共通')).toBeInTheDocument()
  expect(screen.getByText('店舗上書き: 営業時間')).toBeInTheDocument()
})

test('settings.read がなければ設定を表示も取得もせず、承認済みの回復手段だけを出す (UC-EYEX-098)', async () => {
  const api = settingsApi()
  const navigate = vi.fn()
  renderScreen(api, { permissions: [], navigate })

  // 例外状態の文言はモック（exception-states-approved.html #permission-denied）どおり。
  expect(
    await screen.findByRole('heading', { name: 'この設定を表示する権限がありません' }),
  ).toBeInTheDocument()
  expect(
    screen.getByText(
      '権限のある管理者に確認してください。設定の存在や内容はこれ以上表示しません。',
    ),
  ).toBeInTheDocument()
  expect(api).not.toHaveBeenCalled()
  expect(screen.queryByRole('navigation', { name: '設定の工程' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '業務開始画面へ戻る' }))
  expect(navigate).toHaveBeenCalledWith({ screen: 'home' })
})

test('settings.manage がなければ編集操作を提供しない (UC-EYEX-098)', async () => {
  renderScreen(settingsApi(), { permissions: VIEWER })

  expect(await screen.findByText('設定を変更する権限がありません。')).toBeInTheDocument()
  expect(screen.getAllByText(/10:00–19:00/).length).toBeGreaterThan(0)
  expect(screen.queryByRole('button', { name: '編集' })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('月曜の営業開始')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '設定を保存' })).not.toBeInTheDocument()
})

test('保存が版競合したら失敗を伝える (UC-EYEX-095)', async () => {
  const api = settingsApi()
  renderScreen(api)
  await screen.findByRole('button', { name: '設定を保存' })

  api.mockResolvedValueOnce(jsonResponse({ error: 'stale settings version' }, 409))
  fireEvent.click(screen.getByRole('button', { name: '設定を保存' }))

  expect(
    await screen.findByText('設定が他の端末で更新されています。再読み込みしてください。'),
  ).toBeInTheDocument()
})

test('参照エラーは保存できなかった理由として表示する (UC-EYEX-097)', async () => {
  const api = settingsApi()
  renderScreen(api)
  await screen.findByRole('button', { name: '設定を保存' })

  api.mockResolvedValueOnce(
    jsonResponse({ error: 'purpose requires an equipment the store does not have' }, 400),
  )
  fireEvent.click(screen.getByRole('button', { name: '設定を保存' }))

  expect(
    await screen.findByText('purpose requires an equipment the store does not have'),
  ).toBeInTheDocument()
})

test('hands the sixth step to the publication surface instead of a placeholder', async () => {
  // The draft / impact / publication API exists now, so the guide must stop
  // saying it is 準備中 (UC-EYEX-093, 095, AC-EYEX-46).
  renderScreen(
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/availability/draft/impact'))
        return jsonResponse({
          draftVersion: 1,
          items: [],
          publicSlotEffects: [],
          canPublish: true,
        })
      if (url.includes('/availability/draft'))
        return jsonResponse({
          storeId: STORE_ID,
          status: 'draft',
          version: 1,
          baseVersion: 3,
          settings,
          updatedBy: '佐藤',
          updatedAt: '2026-08-27T01:00:00.000Z',
        })
      return jsonResponse(settings)
    }),
    { step: 'impact' },
  )

  expect(await screen.findByRole('heading', { name: /影響を確認して公開/ })).toBeInTheDocument()
  expect(screen.queryByText('影響確認は準備中です')).not.toBeInTheDocument()
})
