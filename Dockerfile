# Образ серверної частини OLIMP (Express.js + статичний клієнт).
FROM node:18-alpine

WORKDIR /app

# PDF-звіт менеджера формує scripts/gen_pdf_report.py (reportlab), який сервер
# запускає через python3. Без цих пакетів маршрут /api/reports/pdf у
# контейнерному розгортанні відповідав би 500 «reportlab not installed».
# Беремо готовий пакет Alpine, а не pip: reportlab не має musl-колес,
# тож встановлення через pip тягло б за собою компілятор і заголовки.
RUN apk add --no-cache python3 py3-reportlab

# Спочатку лише маніфести залежностей — щоб шар npm ci кешувався
# і не перезбирався при кожній зміні коду.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

CMD ["node", "server/index.js"]
