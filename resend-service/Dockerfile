FROM node:18-alpine

# Install pnpm globally
RUN npm install -g pnpm

WORKDIR /app

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install

# Copy source code
COPY . .

# Build TypeScript
RUN pnpm run build

EXPOSE 4000

# Start the application
CMD ["node", "dist/index.js"]