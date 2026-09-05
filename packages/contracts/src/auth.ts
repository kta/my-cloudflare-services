import { z } from 'zod'

/**
 * 認証・テナンシーの Zod 単一ソース。
 * 認証は admin サービスが源泉、他サービスは /api/auth/* をプロキシする。
 */

export const Plan = z.enum(['free', 'contracted'])
export type Plan = z.infer<typeof Plan>

export const Role = z.enum(['admin', 'staff'])
export type Role = z.infer<typeof Role>

/**
 * JWT クレーム(access token)。旧テンプレの `{ org, exp }` と同名・同義の org を
 * 持つため**読み取り側**のテナントスコープコード(jwtPayload.org)は無変更で通るが、
 * sub/email/role が必須になったので**旧形式のトークン自体は検証で弾かれる**
 * (アップグレード時は既存トークンが失効 = 全員再ログイン。fail-closed で安全側)。
 * **plan はクレームに入れない**(org 同期行を毎リクエスト参照 = 即時反映)。
 */
/**
 * トークンの主体。`user` は admin が発行する人のトークン、`terminal` は
 * ドメインサービスが発行する端末のトークン。
 *
 * JWT_SECRET は全サービスで共有され `aud`/`iss` が無いため(`packages/shared/src/jwt.ts`
 * の注記)、発行者が 2 人になった時点で「どのサービス向けか」を本文で名乗らせる
 * 必要がある。省略時は `user` とし、この変更より前に出たトークンをそのまま通す。
 */
export const TokenKind = z.enum(['user', 'terminal'])
export type TokenKind = z.infer<typeof TokenKind>

export const AuthTokenPayload = z.looseObject({
  sub: z.string(), // users.id
  org: z.string(), // organizations.id(旧テンプレ既存クレームと同名・同義)
  email: z.string().email(),
  role: Role,
  kind: TokenKind.default('user'),
  exp: z.number(),
})
export type AuthTokenPayload = z.infer<typeof AuthTokenPayload>

/**
 * ログイン要求。パスワードは**クライアント側でストレッチング済みの値**を送る
 * (PBKDF2 600k、salt=email 導出。平文はネットワークに出さない。
 * Workers Free の CPU 10ms 制約への対応 — `@app/shared` の password.ts 参照)。
 */
export const LoginRequest = z.strictObject({
  email: z.string().email(),
  stretched: z.string().min(1), // クライアント側 PBKDF2 の出力(base64)
})
export type LoginRequest = z.infer<typeof LoginRequest>

export const AuthUser = z.strictObject({
  id: z.string(),
  email: z.string().email(),
  role: Role,
})
export type AuthUser = z.infer<typeof AuthUser>

export const AuthOrganization = z.strictObject({
  id: z.string(),
  name: z.string(),
  plan: Plan,
  isDisabled: z.boolean(),
})
export type AuthOrganization = z.infer<typeof AuthOrganization>

// access token はレスポンス body(メモリ保持)、refresh は HttpOnly cookie 側
export const LoginResponse = z.strictObject({
  token: z.string(),
  user: AuthUser,
  organization: AuthOrganization,
  // internal API は refresh の平文を返し、境界(プロキシする Worker)が HttpOnly
  // cookie に載せる。同一オリジン proxy 前提なのでここでは body で受け渡す。
  refreshToken: z.string(),
})
export type LoginResponse = z.infer<typeof LoginResponse>

// refresh ローテーションの応答(新 access + 新 refresh)。
export const RefreshResponse = z.strictObject({
  token: z.string(),
  refreshToken: z.string(),
})
export type RefreshResponse = z.infer<typeof RefreshResponse>

/**
 * Internal domain-auth proxy refresh request. The domain Worker receives the
 * browser cookie and sends only the opaque token across the service binding;
 * admin remains the sole refresh-token authority.
 */
export const RefreshRequest = z.strictObject({
  refreshToken: z.string().min(1),
})
export type RefreshRequest = z.infer<typeof RefreshRequest>

/** Internal admin verification request for a client-stretched personal PIN. */
export const PinVerificationRequest = z.strictObject({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  stretchedPin: z.string().min(1),
})
export type PinVerificationRequest = z.infer<typeof PinVerificationRequest>

/** Credential material never leaves admin; callers receive only this outcome. */
export const PinVerificationResponse = z.strictObject({
  verified: z.boolean(),
})
export type PinVerificationResponse = z.infer<typeof PinVerificationResponse>

// 招待発行(管理者操作)。org は URL(/api/organizations/:id/invitations)で指定
// するため body には含めない。admin worker の zValidator がこれを直接使う。
export const InviteRequest = z.strictObject({
  email: z.string().email(),
  role: Role.default('staff'),
})
export type InviteRequest = z.infer<typeof InviteRequest>

// 招待受諾(パスワード設定)。password はクライアントで 12 字以上を検証した上で
// ストレッチング済みの値を送る(平文長は UI 側で担保)。
// email はストレッチングの salt(入力ミスがあると別 salt でハッシュが保存され、
// 正しい email での以後のログインが永久に失敗する)。サーバが招待の email と
// 突合できるよう必ず送る。
export const AcceptInviteRequest = z.strictObject({
  token: z.string().min(32),
  email: z.string().email(),
  stretched: z.string().min(1),
})
export type AcceptInviteRequest = z.infer<typeof AcceptInviteRequest>

/**
 * dev トークングラント(`AUTH_DEV_GRANT === 'true'` のときのみ有効)。
 * 本番では fail close(未設定なら 404)。
 */
export const IssueTokenRequest = z.strictObject({
  organizationId: z.string().min(1),
  role: Role.default('staff'),
  email: z.string().email().default('dev@example.com'),
})
export type IssueTokenRequest = z.infer<typeof IssueTokenRequest>

/* ------------------------------------------------------------------------- *
 * 利用者・標準ロール・担当店舗の管理(UC-EYE-149)と個人PIN(UC-EYE-151)。
 * admin が利用者・ロール・担当店舗の源泉であり、結果の membership だけを
 * service binding で glasses_management へ配る。
 * ------------------------------------------------------------------------- */

/**
 * 店舗スコープ権限の語彙。実体は glasses_management の `StorePermission` と
 * **同一集合**であることを contracts のテストで固定する(`auth` →
 * `glasses_management` の import は循環になるため、ここでは値を持たせて
 * テストで一致を保証する)。
 */
export const AdministrablePermission = z.enum([
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
  'analytics.read',
])
export type AdministrablePermission = z.infer<typeof AdministrablePermission>

/** 標準ロール(業務上の肩書き)。JWT の `role` はこの派生物。 */
export const StandardRole = z.enum(['head_office_admin', 'store_manager', 'staff'])
export type StandardRole = z.infer<typeof StandardRole>

const STAFF_PERMISSIONS = [
  'store.read',
  'reservation.read',
  'reservation.write',
  'customer.read',
  'customer.write',
  'attention.read',
  'settings.read',
] as const satisfies readonly AdministrablePermission[]

const STORE_MANAGER_PERMISSIONS = [
  ...STAFF_PERMISSIONS,
  'store.manage',
  'customer.history',
  'attention.write',
  'attention.publish',
  'attention.revise',
  'attention.hide',
  'settings.manage',
  'recording.read',
  'recording.manage',
  'terminal.manage',
  'analytics.read',
] as const satisfies readonly AdministrablePermission[]

const HEAD_OFFICE_ADMIN_PERMISSIONS = [
  ...STORE_MANAGER_PERMISSIONS,
  'audit.read',
] as const satisfies readonly AdministrablePermission[]

/**
 * 標準ロールが含意する店舗権限。「権限差分」はこのカタログとの比較で機械的に
 * 求まる(手で維持しない)。
 */
export const STANDARD_ROLE_PERMISSIONS: Record<StandardRole, readonly AdministrablePermission[]> = {
  head_office_admin: HEAD_OFFICE_ADMIN_PERMISSIONS,
  store_manager: STORE_MANAGER_PERMISSIONS,
  staff: STAFF_PERMISSIONS,
}

/** 標準ロール → 認証ロール(JWT `role`)。 */
export const STANDARD_ROLE_BASE_ROLE: Record<StandardRole, Role> = {
  head_office_admin: 'admin',
  store_manager: 'admin',
  staff: 'staff',
}

/** 標準ロールとの差分(不足・超過)。 */
export const PermissionDifference = z.strictObject({
  missing: AdministrablePermission.array(),
  extra: AdministrablePermission.array(),
})
export type PermissionDifference = z.infer<typeof PermissionDifference>

/** 実効権限と標準ロールの差分を求める(重複除去 + 安定ソート)。 */
export function permissionDifference(
  role: StandardRole,
  effective: readonly AdministrablePermission[],
): PermissionDifference {
  const standard = new Set<AdministrablePermission>(STANDARD_ROLE_PERMISSIONS[role])
  const actual = new Set<AdministrablePermission>(effective)
  return {
    missing: [...standard].filter((p) => !actual.has(p)).sort(),
    extra: [...actual].filter((p) => !standard.has(p)).sort(),
  }
}

/** 1 利用者の担当店舗 1 件と、その店舗で実際に効く権限。 */
export const UserStoreAssignment = z.strictObject({
  storeId: z.string().min(1).max(200),
  permissions: AdministrablePermission.array(),
})
export type UserStoreAssignment = z.infer<typeof UserStoreAssignment>

/** 管理画面の利用者ビュー。credential(PIN/パスワード)は一切含めない。 */
export const AdminUserView = z.strictObject({
  id: z.string().min(1),
  email: z.string().email(),
  role: Role,
  standardRole: StandardRole,
  assignments: UserStoreAssignment.array(),
  permissionDifference: PermissionDifference,
  /** 設定済みか否かだけ。PIN そのものは決して返さない。 */
  hasPin: z.boolean(),
  createdAt: z.string().datetime(),
})
export type AdminUserView = z.infer<typeof AdminUserView>

/** 一覧・検索条件。組織は必ず JWT 由来なので条件に含めない。 */
export const AdminUserQuery = z.strictObject({
  /** email の部分一致(大文字小文字無視)。 */
  q: z.string().trim().min(1).max(200).optional(),
  standardRole: StandardRole.optional(),
  storeId: z.string().min(1).max(200).optional(),
})
export type AdminUserQuery = z.infer<typeof AdminUserQuery>

/** ロール・担当店舗・例外権限の変更。1 つ以上の項目が必要。 */
export const UserAssignmentUpdate = z
  .strictObject({
    standardRole: StandardRole.optional(),
    storeIds: z.array(z.string().min(1).max(200)).max(200).optional(),
    /** 標準ロールから外れる実効権限の明示指定(未指定なら標準どおり)。 */
    permissions: AdministrablePermission.array().optional(),
  })
  .refine(
    (value) =>
      value.standardRole !== undefined ||
      value.storeIds !== undefined ||
      value.permissions !== undefined,
    { message: 'at least one assignment field is required' },
  )
export type UserAssignmentUpdate = z.infer<typeof UserAssignmentUpdate>

export const UserAdministrationAction = z.enum([
  'user.assignment_changed',
  'user.pin_reset_started',
  'user.pin_set',
])
export type UserAdministrationAction = z.infer<typeof UserAdministrationAction>

/** 追記専用の管理監査(誰が・いつ・変更前後)。 */
export const UserAdministrationAudit = z.strictObject({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  actorUserId: z.string().min(1),
  targetUserId: z.string().min(1),
  action: UserAdministrationAction,
  /** JSON 文字列。credential は含めない。 */
  before: z.string(),
  after: z.string(),
  createdAt: z.string().datetime(),
})
export type UserAdministrationAudit = z.infer<typeof UserAdministrationAudit>

/**
 * 本人による PIN 設定・変更。平文 PIN は**ブラウザから出ない**
 * (`stretchPin()` の出力だけを送る)。
 */
export const SetOwnPinRequest = z.strictObject({
  stretchedPin: z.string().min(1),
  /** 既に PIN がある場合の本人確認(現行 PIN のストレッチ値)。 */
  currentStretchedPin: z.string().min(1).optional(),
  /** 管理者が本人確認後に発行した再設定チケット。 */
  resetTicketId: z.string().min(1).optional(),
})
export type SetOwnPinRequest = z.infer<typeof SetOwnPinRequest>

/** 管理者の PIN 再設定開始。本人確認の方法と根拠の記録が必須。 */
export const PinResetStartRequest = z.strictObject({
  verificationMethod: z.enum(['in_person', 'photo_id', 'video_call', 'manager_confirmation']),
  verificationNote: z.string().trim().min(1).max(500),
})
export type PinResetStartRequest = z.infer<typeof PinResetStartRequest>

/** 再設定チケット。PIN 素材は一切含まない(管理者は PIN を閲覧できない)。 */
export const PinResetTicket = z.strictObject({
  id: z.string().min(1),
  userId: z.string().min(1),
  status: z.enum(['pending', 'consumed']),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
})
export type PinResetTicket = z.infer<typeof PinResetTicket>

/** 担当店舗変更の domain 同期が失敗した(admin 正本は保持済み)。 */
export const StoreMembershipSyncFailed = z.strictObject({
  error: z.literal('store_membership_sync_failed'),
  userId: z.string().min(1),
  retryable: z.boolean(),
})
export type StoreMembershipSyncFailed = z.infer<typeof StoreMembershipSyncFailed>
