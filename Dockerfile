# Cluvyra — production image (Express API + static PWA frontend).
FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# PDF-звіт менеджера формує scripts/gen_pdf_report.py (reportlab), який сервер
# запускає через python3. Беремо готовий пакет Alpine, а не pip: reportlab не
# має musl-колес. tzdata — коректні часові пояси для Intl/логів.
RUN apk add --no-cache python3 py3-reportlab tzdata

# Спочатку лише маніфести залежностей — шар npm ci кешується між збірками.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --chown=node:node . .

# Каталог для завантажень (у production монтується Railway volume, напр. /data).
RUN mkdir -p /data/uploads && chown -R node:node /data

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

CMD ["node", "server/index.js"]
