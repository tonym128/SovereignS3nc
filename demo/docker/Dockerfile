# Dockerfile for SovereignS3nc Social Demo
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the library and the social demo
RUN npm run build
RUN npm run build:social

# Expose the Web Server port
EXPOSE 8888

# Set entrypoint
RUN chmod +x /app/demo/docker/start.sh
ENTRYPOINT ["/app/demo/docker/start.sh"]
