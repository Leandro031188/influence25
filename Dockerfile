FROM node:18-alpine

WORKDIR /app

COPY servidor/package*.json ./servidor/
RUN cd servidor && npm install --omit=dev

COPY servidor ./servidor
COPY publico ./publico

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "servidor/index.js"]
