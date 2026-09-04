import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text'],
      include: ['src/**/*.ts'],
      // cli.ts は引数の解釈と入出力の殻で、中身は test 済みのモジュールへ委譲している。
      // 起動そのものは test/cli.smoke.test.ts が実プロセスで確認する（型ストリップの
      // 構文制約は vitest のトランスパイルでは検知できないため、これが唯一の防波堤）。
      // index.ts は再輸出だけ。
      exclude: ['src/cli.ts', 'src/index.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
})
