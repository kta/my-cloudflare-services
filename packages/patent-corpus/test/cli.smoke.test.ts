import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/*
 * CLI を **実プロセスで** 起動する煙テスト。
 *
 * vitest は TypeScript をトランスパイルして走らせるが、この CLI は Node の型ストリップで
 * 直接実行される。両者は受け付ける構文が違う（例: パラメータプロパティは型ストリップで落ちる）。
 * 実際にこの差でユニットテスト全緑のまま CLI が起動不能になったことがあるので、
 * 配布経路そのものをテストで守る。
 */

const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts')

let dir: string
let db: string

function run(args: string[]): string {
  return execFileSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tenkyo-cli-'))
  db = join(dir, 'corpus.db')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('CLI を実プロセスで起動する', () => {
  it('help が出る（すべてのモジュールが型ストリップで読める）', () => {
    expect(run(['help'])).toContain('典拠')
  })

  it('synth → search → stats が一巡する', () => {
    const synth = JSON.parse(run(['synth', '--db', db, '--count', '5', '--seed', '1'])) as {
      created: number
      stats: { publications: number; paragraphs: number }
    }
    expect(synth.created).toBe(5)
    expect(synth.stats.publications).toBe(5)
    expect(synth.stats.paragraphs).toBeGreaterThan(5)

    const search = JSON.parse(run(['search', '--db', db, '瞳孔', '--limit', '3'])) as {
      matchExpression: string
      hitCount: number
    }
    expect(search.matchExpression).toBe('"瞳孔"')
    expect(search.hitCount).toBeGreaterThan(0)

    const stats = JSON.parse(run(['stats', '--db', db])) as { publications: number }
    expect(stats.publications).toBe(5)
  })

  it('embed と rebuild-index が動く', () => {
    run(['synth', '--db', db, '--count', '3', '--seed', '2'])
    const embed = JSON.parse(run(['embed', '--db', db, '--dim', '32'])) as {
      model: string
      chunkCount: number
    }
    expect(embed.model).toBe('deterministic:32')
    expect(embed.chunkCount).toBeGreaterThan(0)

    const rebuilt = JSON.parse(run(['rebuild-index', '--db', db])) as { paragraphs: number }
    expect(rebuilt.paragraphs).toBeGreaterThan(0)
  })

  it('probe が実物のディレクトリを報告する', () => {
    run(['synth', '--db', db, '--count', '1', '--seed', '3'])
    const probe = JSON.parse(run(['probe', dir, '--sample', '2'])) as { totalFiles: number }
    expect(probe.totalFiles).toBeGreaterThan(0)
  })

  it('不明なコマンドは 1 で終わる', () => {
    expect(() => run(['no-such-command'])).toThrow()
  })

  it('必須の引数が無ければ 1 で終わり、理由を告げる', () => {
    let stderr = ''
    try {
      run(['search'])
    } catch (err) {
      stderr = String((err as { stderr?: string }).stderr ?? '')
    }
    expect(stderr).toContain('検索語')
  })
})
