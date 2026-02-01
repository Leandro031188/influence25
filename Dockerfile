FROM node:18-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev
COPY server ./server
COPY public ./public
WORKDIR /app/server
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "index.js"]
