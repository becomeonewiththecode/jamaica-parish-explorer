FROM node:20-alpine AS build

WORKDIR /app

RUN apk add --no-cache python3 make g++ git

COPY . .

# Strip any host-side node_modules so native modules compile for Alpine (musl)
RUN rm -rf node_modules client/node_modules server/node_modules

# Install all dependencies (root + server + client) and build the client
RUN npm install && cd server && npm install && cd ../client && npm install && cd .. && npm run build

FROM node:20-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache sqlite

COPY --from=build /app /app

ENV NODE_ENV=production \
    PORT=3001

EXPOSE 3001

CMD ["npm", "start"]
