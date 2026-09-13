# syntax=docker/dockerfile:1

# ---- 构建静态产物 ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- 发布：nginx 托管静态页面 ----
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

# ---- 一次性验收：单元测试 + 构建 + Playwright 端到端 ----
FROM node:20-bookworm AS verify
WORKDIR /app
ENV CI=true
COPY package.json package-lock.json ./
RUN npm ci && npx playwright install --with-deps chromium
COPY . .
CMD ["npm", "run", "verify"]
