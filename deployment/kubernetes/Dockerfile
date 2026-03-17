FROM node:20-alpine AS build

WORKDIR /app

RUN apk add --no-cache python3 make g++ git

COPY . .

RUN npm install && npm run build

FROM node:20-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache sqlite

COPY --from=build /app /app

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

CMD ["npm", "start"]

