FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY proto ./proto
COPY services/shared ./services/shared
ARG SERVICE_NAME
COPY services/${SERVICE_NAME} ./services/${SERVICE_NAME}
COPY scripts/grpc-healthcheck.js ./scripts/grpc-healthcheck.js

USER node
EXPOSE 3000 50051 50052 50053 50054 50055

CMD ["node", "services/api-gateway/src/server.js"]
