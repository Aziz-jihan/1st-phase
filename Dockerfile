# ---- Base image ----
FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the rest of the source
COPY . .

# The app reads PORT from env, defaults to 3000
ENV PORT=3000
EXPOSE 3000

# Run as the built-in non-root "node" user for better security
USER node

CMD ["node", "src/server.js"]
