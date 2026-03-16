FROM node:20-alpine AS build

WORKDIR /app

# Install build tools needed for native modules (e.g. better-sqlite3)
RUN apk add --no-cache python3 make g++ git

# Copy full repo (docker-compose will set context to project root)
COPY . .

# Install dependencies and build the app
RUN npm install && npm run build

FROM node:20-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache sqlite

# Copy only what is needed at runtime
COPY --from=build /app /app

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

# Default command assumes root package.json has "start" script
CMD ["npm", "start"]

