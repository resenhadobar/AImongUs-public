# Use an official Node.js runtime as a parent image
FROM node:18-slim

# Install system dependencies required for Playwright
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory inside the container
WORKDIR /app

# Install pnpm globally
RUN npm install -g pnpm

# Copy package.json and pnpm-lock.yaml (or pnpm-workspace.yaml if applicable) into the container
COPY package.json pnpm-lock.yaml* ./

# Install dependencies using pnpm
RUN pnpm install

# Copy the rest of the application code
COPY . .

# Install Playwright and its required dependencies
RUN pnpx playwright install

# Expose the port your app runs on (you may need to change this based on your app)
EXPOSE 3006

# Run your app (adjust this to your start script, using pnpm to run the right start script)
CMD ["pnpm", "start"]
