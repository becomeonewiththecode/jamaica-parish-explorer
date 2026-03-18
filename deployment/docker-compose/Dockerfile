FROM node:20-alpine AS build

WORKDIR /app

# Install build tools needed for native modules (e.g. better-sqlite3)
RUN apk add --no-cache python3 make g++ git

# Copy full repo (docker-compose will set context to project root)
COPY . .

# Install dependencies and build the client
RUN npm install && cd server && npm install && cd .. && npm run build

FROM node:20-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache sqlite && npm install -g pm2

# Copy only what is needed at runtime
COPY --from=build /app /app

ENV NODE_ENV=production \
    PORT=3001

EXPOSE 3001 5555 5556

# Use PM2 to manage API, status board, and admin dashboard
CMD ["pm2-runtime", "ecosystem.config.js"]

