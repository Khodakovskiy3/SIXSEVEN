# Образ серверної частини OLIMP (Express.js + статичний клієнт).
FROM node:18-alpine

WORKDIR /app

# Спочатку лише маніфести залежностей — щоб шар npm ci кешувався
# і не перезбирався при кожній зміні коду.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

CMD ["node", "server/index.js"]
