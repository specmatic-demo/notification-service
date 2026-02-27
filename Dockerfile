FROM node:24

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
RUN git clone https://github.com/specmatic-demo/central-contract-repository /app/.specmatic/repos/central-contract-repository

ENV NOTIFICATION_HOST=0.0.0.0
ENV NOTIFICATION_PORT=8080
ENV NOTIFICATION_KAFKA_BROKERS=localhost:9092

EXPOSE 8080
CMD ["npm", "run", "start"]
