const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // @vercel/blob/client は Node 専用の `undici` を import するが、同パッケージは
    // package.json の `browser` フィールドで undici→undici-browser.js（globalThis.fetch を使う
    // ブラウザ/Edge/Serverless 兼用スタブ）を用意している。Next はこの browser マッピングを自動適用
    // しないため、undici を公式スタブへ明示エイリアスして webpack のパースエラーを回避する。
    // flight-client-module-loader は server コンパイル時にも走るため、isServer で分けず無条件に適用する
    // （フロントはサーバ側でも Node18+ の global fetch でよく、真の undici が要る箇所は無い）。
    const undiciBrowser = path.join(
      path.dirname(require.resolve('@vercel/blob/client')),
      'undici-browser.js',
    )
    config.resolve = config.resolve || {}
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      undici: undiciBrowser,
    }
    return config
  },
}

module.exports = nextConfig

