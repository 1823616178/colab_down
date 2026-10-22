# 优化记录（2026-10-22）

原则：只做低风险、可验证的优化；不升级大版本（未升 Nuxt 4），不重构核心业务逻辑。
所有改动都在 git 工作区，未 commit、未 push、未改 remote。

## 已做的优化

| # | 文件 | 改动 | 为什么 |
|---|---|---|---|
| 1 | `yarn.lock` | **删除** | 与 `package-lock.json` 并存且互相矛盾：README、Dockerfile（`npm ci`）全走 npm，yarn.lock 无人维护、已经漂移（审计期间曾被工具改写 registry 地址）。只留 npm 一套锁文件，避免“到底以哪份依赖版本为准”的混乱。若团队实际在用 yarn，请从 git 恢复并反过来删 `package-lock.json`，二选一。 |
| 2 | `.env.example` | `NUXT_CDM_SECRET_KEY` 的固定值改为占位符 `__REPLACE_WITH_OPENSSL_RAND_BASE64_32_OUTPUT__`，保留 `openssl rand -base64 32` 生成说明 | 原值是一串可预测的固定 base64（解码即明文口令式字符串），照抄 `.env.example` 上线等于凭据加密和登录 token 签名共用一把公开钥匙。**注意：已经在用的 `.env` 如果填的还是那个旧值，请立刻重新生成并替换（换密钥后已入库的加密凭据将无法解密，需重新录入）。** |
| 3 | `Dockerfile` | 运行阶段改为非 root：`COPY --chown=node:node`、预建并 chown `/app/logs`、新增 `USER node` | 原镜像以 root 跑 Node 服务，没必要。服务会向 `process.cwd()/logs` 写 Colab CLI 日志（`RealColabBridge` / `DriveAuthManager`），所以只加 `USER node` 会写日志失败，必须同时预建目录并给所有权。 |
| 4 | `.dockerignore` | 补 `*.log`、`.env.*`（保留 `!.env.example`）、`.DS_Store`、`dist`、`coverage`、`.gitignore` | 原文件已排除 `node_modules/.nuxt/.output/spike/tests/docs`，但 `.env.local` 等变体仍会进构建上下文，有把密钥打进镜像层的风险。 |
| 5 | `.gitignore` | 补 `.env.*` + `!.env.example`、`*.tsbuildinfo`、`.idea/`、`.vscode/` | 原来只忽略精确的 `.env`，`.env.production` 之类可能被误提交；编辑器目录同理。 |
| 6 | `package.json` | 新增 `engines: { "node": ">=22" }`；新增脚本 `test:watch`（`vitest`）、`check`（`typecheck && test`） | Dockerfile 用 `node:22-alpine`、`@types/node` 是 22，但 package.json 没写 engines，低版本 Node 装依赖时不会有任何提示。新脚本只组合已有依赖/命令，没有新增任何依赖。未加 lint：项目没有 eslint 依赖，为一条脚本引入整套 lint 依赖不值得。 |
| 7 | `.nvmrc` | 新增，内容 `22` | 与 engines / Dockerfile 对齐，`nvm use` 直接切到正确版本。 |
| 8 | `server/utils/db.ts` | 修正一处过期注释 | 注释称“生产迁移走 scripts/migrate.sh”，但仓库里根本没有这个脚本（只有 `scripts/preflight.sh`），与 README“当前阶段不走手写 migration”矛盾，易误导。仅改注释，无运行时影响。 |

## 刻意没动的（及原因）

- **`spike/` 没删**：看似与 `server/workers` 重复，实测不是同一份代码——`spike/workers/*` 是 39/23 行的早期验证版，`server/workers/*` 是 144/122 行的正式版；`spike/pkg/*.py` 只是 1 行占位注释。且 `docs/spike-report.md`、`TASK.md` 明确引用 spike 脚本作为实测依据，它是审计留痕。体积总共约 11KB，且 `.dockerignore` 已排除，不进镜像。想清理可先归档到 `docs/archive/`，需你确认。
- **`DESIGN.md`（75KB）/ `TASK.md`（41KB）没动**：README 明确链接这两份为设计与任务规划原文，删/搬都会断链。
- **`nuxt.config.ts` 的三元写法没简化**：`process.env.X ? … : 默认值` 改成 `||` 对端口等场景语义不完全等价（如 `"0"`），纯风格收益不值得冒行为变化的风险。
- **默认管理员 `admin / admin123`**（`server/services/AuthService.ts`，首次启动无用户时创建）：这是行为/安全策略，改为“从环境变量读初始密码或强制首登改密”需要你先定方案，未擅自改。
- **依赖未升级**：`npm ci` 有 2 条上游 deprecation 警告（`unplugin-vue-router`、`glob@10.5.0`），都是传递依赖，跟随 Nuxt 升级解决，不单独 pin。

## 验证结果（本机 Node v24.20.0 / npm 10.9.4）

改动前基线与改动后结果一致，没有引入新失败：

- `npm ci` ✅ 通过（714 packages；改动后重跑同样通过，证明 engines/脚本改动不影响安装，删 yarn.lock 不影响 npm 路径）
- `npm run test` ✅ 5 个文件、35/35 用例通过
- `npm run typecheck` ✅ 通过（退出码 0）
- `npm run check`（新增脚本）✅ 通过（即上面 typecheck + test 的组合）
- `npm run build` ✅ 通过，产物总计 7.99 MB（gzip 2.03 MB）；启动 `.output/server/index.mjs` 后 `GET /login` 返回 200（与 Dockerfile HEALTHCHECK 同一探针）；日志中 MySQL `ECONNREFUSED 127.0.0.1:3306` 是本机没起 MySQL 的环境问题，属既有行为，与本次改动无关
- ⚠️ `docker build` 未验证：本机没有 docker CLI，只做了 Dockerfile 静态核查。首次在有 Docker 的机器上构建时请留意非 root 改动：若宿主机以 root 所有的目录挂载覆盖 `/app/logs`，需先 `chown` 给 node 用户（uid 1000）。

## 后续建议（高风险/大改，需单独决策）

1. **初始管理员密码策略**：改为环境变量注入或随机生成并只打印一次到日志，替代写死的 `admin123`。
2. **引入正式 migration**：现在 TypeORM `synchronize: true` 在生产自动改表结构，风险高；README 也标注了这是“当前阶段”的做法。
3. **README 与 Docker 的口径统一**：README 写“不要把 Nuxt 服务容器化，只容器化 MySQL”，但仓库同时提供了部署 app 的 `Dockerfile` + `docker-compose.yml`（且 compose 里 MySQL 是外部实例）。请确认哪条是现行部署方式，再删掉另一套说明/文件。
4. **日志目录逻辑去重**：`RealColabBridge` 与 `DriveAuthManager` 各自拼了一份 `logs/colab/<vmId>` 的 mkdir 逻辑，可抽到 `server/utils/` 共用——涉及核心模块，留待有测试覆盖时再做。
5. **CI**：仓库还没有 CI 配置，可用新增的 `npm run check` 一行接入（`npm ci && npm run check && npm run build`）。
