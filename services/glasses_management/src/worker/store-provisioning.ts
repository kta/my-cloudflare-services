/**
 * 新しいお店を登録するときに一緒に置く既定値。
 *
 * 店舗の行だけを作ると「登録したのに空き枠が出ない」お店ができる。空き枠エンジンは
 * 営業時間・予約の間隔・ご来店の目的の 3 つが揃って初めて枠を出すので、その 3 つと、
 * 設定を保存するための版、そして登録した本人の担当店舗をまとめて置く。
 *
 * 値はすべて後から設定画面で変えられる。ここで決めているのは「最初の一手を省く」
 * ための出発点であって、正解ではない。
 */
import type { StoreInput } from '@app/contracts'

/** 曜日は 0=日 / 1=月 / … / 6=土（`store_business_hours.weekday`）。 */
export const DEFAULT_BUSINESS_HOURS: ReadonlyArray<{
  weekday: number
  opensAt: string | null
  closesAt: string | null
}> = [
  { weekday: 0, opensAt: null, closesAt: null }, // 日曜は定休
  { weekday: 1, opensAt: '10:00', closesAt: '19:00' },
  { weekday: 2, opensAt: '10:00', closesAt: '19:00' },
  { weekday: 3, opensAt: '10:00', closesAt: '19:00' },
  { weekday: 4, opensAt: '10:00', closesAt: '19:00' },
  { weekday: 5, opensAt: '10:00', closesAt: '19:00' },
  { weekday: 6, opensAt: '10:00', closesAt: '19:00' },
]

/** 刻み 30 分・片付け 10 分・同時 3 件。既存店（EYE 銀座）と同じ形にしてある。 */
export const DEFAULT_SLOT_RULE = { slotMinutes: 30, cleanupMinutes: 10, maxParallel: 3 } as const

/**
 * ご来店の目的 3 件。眼鏡店の受付でまず必要になる最小の組み合わせにし、
 * 必要な技能・設備は付けない（新しい会社にはまだスタッフも設備も無いため、
 * 条件を付けると最初から枠が出ない）。
 */
export const DEFAULT_PURPOSES: ReadonlyArray<{
  nameInternal: string
  namePublic: string
  nameShort: string
  durationMinutes: number
}> = [
  {
    nameInternal: 'メガネを新しく作る',
    namePublic: 'メガネを新しく作る',
    nameShort: '新規',
    durationMinutes: 60,
  },
  {
    nameInternal: '調整・修理',
    namePublic: '調整・修理',
    nameShort: '調整',
    durationMinutes: 20,
  },
  {
    nameInternal: 'その他のご相談',
    namePublic: 'ご相談',
    nameShort: '相談',
    durationMinutes: 30,
  },
]

/**
 * 登録した本人に渡す権限。**そのお店の全権限**を渡す。
 * 登録できた人がその場で設定を続けられないと、鶏と卵が一段ずれるだけになる。
 */
export const FOUNDER_PERMISSIONS = [
  'store.read',
  'store.manage',
  'reservation.read',
  'reservation.write',
  'customer.read',
  'customer.write',
  'customer.history',
  'attention.read',
  'attention.write',
  'attention.publish',
  'attention.revise',
  'attention.hide',
  'settings.read',
  'settings.manage',
  'recording.read',
  'recording.manage',
  'audit.read',
  'terminal.manage',
] as const

export type NewStoreRows = {
  store: {
    id: string
    organizationId: string
    name: string
    slug: string
    phone: string
    address: string
    accessNote: string
    isActive: '1'
    createdAt: string
  }
  businessHours: Array<{
    id: string
    organizationId: string
    storeId: string
    weekday: number
    isClosed: '0' | '1'
    opensAt: string | null
    closesAt: string | null
    breakStart: null
    breakEnd: null
    createdAt: string
  }>
  slotRule: {
    id: string
    organizationId: string
    storeId: string
    slotMinutes: number
    cleanupMinutes: number
    maxParallel: number
    version: number
    updatedAt: string
    updatedBy: null
    createdAt: string
  }
  purposes: Array<{
    id: string
    organizationId: string
    storeId: string
    nameInternal: string
    namePublic: string
    nameShort: string
    durationMinutes: number
    isWebPublished: '1'
    isActive: '1'
    sortOrder: number
    version: number
    createdAt: string
    updatedAt: string
  }>
  settingsRevision: {
    id: string
    organizationId: string
    storeId: string
    version: number
    updatedAt: string
    updatedBy: null
    createdAt: string
  }
  membership: {
    id: string
    organizationId: string
    storeId: string
    userId: string
    permissions: string
    createdAt: string
  }
}

/**
 * 書き込む行を組み立てるだけの純関数。時刻と id は呼び出し側が渡す
 * （テストを実時刻と乱数から切り離すため）。
 */
export function buildNewStore(params: {
  storeId: string
  organizationId: string
  userId: string
  input: StoreInput
  now: string
  nextId: () => string
}): NewStoreRows {
  const { storeId, organizationId, userId, input, now, nextId } = params

  return {
    store: {
      id: storeId,
      organizationId,
      name: input.name,
      slug: input.slug,
      phone: input.phone,
      address: input.address,
      accessNote: input.accessNote,
      isActive: '1',
      createdAt: now,
    },
    businessHours: DEFAULT_BUSINESS_HOURS.map((hour) => ({
      id: nextId(),
      organizationId,
      storeId,
      weekday: hour.weekday,
      isClosed: hour.opensAt === null ? ('1' as const) : ('0' as const),
      opensAt: hour.opensAt,
      closesAt: hour.closesAt,
      // 受付を止める帯の正本は store_blackout_windows。この 2 列には書き込まない。
      breakStart: null,
      breakEnd: null,
      createdAt: now,
    })),
    slotRule: {
      id: nextId(),
      organizationId,
      storeId,
      slotMinutes: DEFAULT_SLOT_RULE.slotMinutes,
      cleanupMinutes: DEFAULT_SLOT_RULE.cleanupMinutes,
      maxParallel: DEFAULT_SLOT_RULE.maxParallel,
      version: 1,
      updatedAt: now,
      updatedBy: null,
      createdAt: now,
    },
    purposes: DEFAULT_PURPOSES.map((purpose, index) => ({
      id: nextId(),
      organizationId,
      storeId,
      nameInternal: purpose.nameInternal,
      namePublic: purpose.namePublic,
      nameShort: purpose.nameShort,
      durationMinutes: purpose.durationMinutes,
      isWebPublished: '1' as const,
      isActive: '1' as const,
      sortOrder: index,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })),
    settingsRevision: {
      id: nextId(),
      organizationId,
      storeId,
      version: 1,
      updatedAt: now,
      updatedBy: null,
      createdAt: now,
    },
    membership: {
      id: nextId(),
      organizationId,
      storeId,
      userId,
      permissions: FOUNDER_PERMISSIONS.join(' '),
      createdAt: now,
    },
  }
}
