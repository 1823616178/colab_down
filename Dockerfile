# ---- 构建阶段：安装全部依赖并产出 .output ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- 运行阶段：只带 .output，镜像最小化 ----
# Nuxt/Nitro 约定：运行时 NUXT_* 环境变量自动覆盖 runtimeConfig
# （NUXT_DB_HOST→dbHost、NUXT_CDM_SECRET_KEY→cdmSecretKey 等），
# 因此容器启动时通过 env_file 注入 .env 即可生效，无需重建镜像。
# 注意：生产服务器监听端口读 NITRO_PORT/NITRO_HOST（不是 NUXT_PORT，后者只管 dev），
# 默认值在 docker-compose.yml 里显式指定。
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/.output ./.output
# 运行时以非 root 的 node 用户运行（镜像自带）。服务会往 process.cwd()/logs 写
# Colab CLI 日志（RealColabBridge / DriveAuthManager），需预建并把所有权给 node，
# 否则非 root 下 mkdir/写日志会失败。
RUN mkdir -p /app/logs && chown node:node /app/logs
USER node
EXPOSE 32023
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.NITRO_PORT||32023)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
