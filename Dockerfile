FROM node:20-slim

# Install basics
RUN apt-get update && apt-get install -y curl wget unzip dos2unix && rm -rf /var/lib/apt/lists/*

# Install Garage (S3 Compatible Storage)
# Using v1.0.0 static binary
RUN wget -O /usr/local/bin/garage https://garagehq.deuxfleurs.fr/_releases/v1.0.0/x86_64-unknown-linux-musl/garage && \
    chmod +x /usr/local/bin/garage

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the project and the demos
# We need to explicitly build the demo bundles since they're not in the main build script
RUN npm run build
RUN npx esbuild demo/social/src/app.ts --bundle --outfile=demo/social/bundle.js --sourcemap --platform=browser --external:crypto
RUN npx esbuild demo/notes/src/app.ts --bundle --outfile=demo/notes/bundle.js --sourcemap --platform=browser --external:crypto
RUN npx esbuild demo/chat/src/app.ts --bundle --outfile=demo/chat/bundle.js --sourcemap --platform=browser --external:crypto
RUN npx esbuild demo/shopping/src/app.ts --bundle --outfile=demo/shopping/bundle.js --sourcemap --platform=browser --external:crypto

# Install a simple HTTP server
RUN npm install -g http-server

# Create Garage config directory
RUN mkdir -p /etc/garage

# Copy startup script
COPY start.sh /start.sh
RUN dos2unix /start.sh && chmod +x /start.sh

# Expose ports
# 3900: S3 API
# 3902: Garage Admin API
# 8080: Web Server
EXPOSE 3900 3902 8080

CMD ["/start.sh"]
