FROM node:20-slim AS build

WORKDIR /app
COPY services/auth/package.json /app/services/auth/
COPY services/auth/tsconfig.json /app/services/auth/
COPY services/auth/src /app/services/auth/src
COPY website/convex/_generated /app/website/convex/_generated
COPY website/wasm/pkg /app/website/wasm/pkg

WORKDIR /app/services/auth
RUN npm install
RUN npm run build

FROM node:20-slim

WORKDIR /app/services/auth
ENV NODE_ENV=production
COPY services/auth/package.json /app/services/auth/
RUN npm install --omit=dev
COPY --from=build /app/services/auth/dist /app/services/auth/dist
COPY --from=build /app/website/convex/_generated /app/website/convex/_generated
COPY --from=build /app/website/wasm/pkg /app/website/wasm/pkg

CMD ["node", "dist/server.js"]
