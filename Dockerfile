FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=3000 DB_PATH=/app/data/tickets.db
EXPOSE 3000
CMD ["node", "src/server.js"]
