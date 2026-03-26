FROM node:20-alpine

WORKDIR /app

# Install peer and ws
RUN npm install peer ws

# Copy the server script
COPY server.js .

# Expose the default port
EXPOSE 9000

# Run the server
CMD ["node", "server.js"]
