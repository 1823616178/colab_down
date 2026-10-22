// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-08-01',
  devtools: { enabled: false },
  ssr: true,
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      title: 'Colab Download Manager',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'theme-color', content: '#05070d' },
      ],
    },
  },
  typescript: {
    typeCheck: false,
    strict: true,
  },
  nitro: {
    // Nitro 打包用 esbuild transform，不会自动读 tsconfig.json：
    // 必须显式开 legacy 装饰器，否则 TypeORM 装饰器按 TC39 新式语义编译直接运行时报错
    esbuild: {
      options: {
        tsconfigRaw: JSON.stringify({
          compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: false },
        }),
      },
    },
  },
  runtimeConfig: {
    // 三元显式读取环境变量（Nuxt 会在本文件求值前把 .env 载入 process.env），冒号后为兜底默认
    dbHost: process.env.NUXT_DB_HOST ? process.env.NUXT_DB_HOST : '127.0.0.1',
    dbPort: process.env.NUXT_DB_PORT ? Number(process.env.NUXT_DB_PORT) : 3306,
    dbUser: process.env.NUXT_DB_USER ? process.env.NUXT_DB_USER : 'root',
    dbPassword: process.env.NUXT_DB_PASSWORD ? String(process.env.NUXT_DB_PASSWORD) : '',
    dbName: process.env.NUXT_DB_NAME ? process.env.NUXT_DB_NAME : 'colab_down',
    // AES-256-GCM 密钥（32 字节 base64），凭据加密 + 登录 token 签名依赖它
    cdmSecretKey: process.env.NUXT_CDM_SECRET_KEY ? process.env.NUXT_CDM_SECRET_KEY : '',
    // CDM_MOCK=1 时用 MockColabBridge，不调真实 colab CLI
    cdmMock: process.env.NUXT_CDM_MOCK ? String(process.env.NUXT_CDM_MOCK) : '1',
    colabBin: process.env.NUXT_COLAB_BIN ? process.env.NUXT_COLAB_BIN : 'colab',
    // 必须显式指定（实测默认 oauth2，勿依赖默认值）
    colabAuth: process.env.NUXT_COLAB_AUTH ? process.env.NUXT_COLAB_AUTH : 'oauth2',
    // 本地挂载的 Drive 根目录（rclone mount 等）。配置后目录浏览/配额直接读本地文件系统，
    // 不再依赖「有 VM 已挂载 Drive」；留空则走原来的 VM 内联 python 探测
    cdmLocalDriveRoot: process.env.NUXT_CDM_LOCAL_DRIVE_ROOT ? process.env.NUXT_CDM_LOCAL_DRIVE_ROOT : '',
    public: {
      appName: process.env.NUXT_PUBLIC_APP_NAME ? process.env.NUXT_PUBLIC_APP_NAME : 'Colab Download Manager',
    },
  },
})
