FROM node:20-alpine AS build

WORKDIR /app

# Build tools for npm packages that compile during install (if any)
RUN apk add --no-cache python3 make g++ git

# Copy full repo (docker-compose will set context to project root)
COPY . .

# Host copies must not leave node_modules in the layer (see .dockerignore); strip if present.
RUN rm -rf node_modules client/node_modules server/node_modules

# Install dependencies and build the client (native modules compile for Alpine here)
RUN npm install && cd server && npm install && cd ../client && npm install && cd .. && npm run build

FROM node:20-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache postgresql-client && npm install -g pm2

# Copy only what is needed at runtime
COPY --from=build /app /app

ENV NODE_ENV=production \
    PORT=3001

EXPOSE 3001 5555 5556

# Use PM2 to manage API, status board, and admin dashboard
CMD ["pm2-runtime", "ecosystem.config.js"]

