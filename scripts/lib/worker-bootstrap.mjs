/**
 * service binding の相互参照を、初回デプロイだけ通すための踏み台を計画する。
 *
 * Cloudflare は「参照先の Worker が実在すること」を service binding の
 * アップロード条件にする。EYE スタックは admin ⇄ glasses_management が
 * 相互参照なので、どちらを先に置いても最初の 1 回は必ず 404 で落ちる。
 * 依存順を並べ替えても解けない(閉路には始点が無い)。
 *
 * そこで参照先が未作成のときだけ、バインディング無しの空 Worker を先に置く。
 * 直後に本物のデプロイが同じ名前を上書きするので、踏み台が残るのは数十秒。
 * **既にある Worker には触らない** — 触ると本番の生きた Worker から
 * バインディングを剥がしてしまい、後続のデプロイが失敗した瞬間に停止する。
 */

/**
 * @param workers デプロイ対象。`{ service, workerName, compatibilityDate, services }`。
 * @param existing アカウントに既にある Worker 名。
 * @returns create = 踏み台を置く対象(workers の要素)、unknown = このリポジトリの
 *   管理外を指している参照(踏み台は作らず、人が読むために返す)。
 */
export function planWorkerBootstrap({ workers, existing }) {
  const byName = new Map(workers.map((w) => [w.workerName, w]))
  const have = new Set(existing)
  const create = []
  const unknown = []
  for (const worker of workers) {
    for (const { binding, service } of worker.services) {
      const target = byName.get(service)
      if (!target) {
        if (!unknown.some((u) => u.service === service)) {
          unknown.push({ from: worker.workerName, binding, service })
        }
        continue
      }
      if (have.has(service)) continue
      if (create.includes(target)) continue
      create.push(target)
    }
  }
  return { create, unknown }
}
