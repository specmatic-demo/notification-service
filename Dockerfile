FROM node:24

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src

ENV NOTIFICATION_HOST=0.0.0.0
ENV NOTIFICATION_PORT=8080
ENV MQTT_BROKER_URL=mqtt://localhost:1883

EXPOSE 8080
CMD ["npm", "run", "start"]
