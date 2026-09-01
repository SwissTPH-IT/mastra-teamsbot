FROM node:22-slim

WORKDIR /app

# Abhängigkeiten zuerst (Docker-Layer-Caching)
COPY package.json package-lock.json* ./
RUN npm install

# Quellcode
COPY tsconfig.json next.config.ts postcss.config.mjs components.json ./
COPY app ./app
COPY components ./components
COPY hooks ./hooks
COPY lib ./lib

# Produktionsbuild. Die Mastra-Adresse wird erst zur Laufzeit gelesen
# (kein NEXT_PUBLIC_*), der Build braucht sie also nicht.
RUN npm run build

EXPOSE 3000

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

CMD ["npm", "run", "start"]
