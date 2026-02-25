import express, { type Request, type Response } from 'express';
import mqtt, { type MqttClient } from 'mqtt';
import type { ReceivedMessage } from './types';

const host = process.env.NOTIFICATION_HOST || '0.0.0.0';
const port = Number.parseInt(process.env.NOTIFICATION_PORT || '8080', 10);
const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';

const app = express();
app.use(express.json({ limit: '1mb' }));

const receivedMessages: ReceivedMessage[] = [];
const maxMessages = 100;
let mqttConnected = false;

function rememberMessage(topic: string, payload: Record<string, unknown>): ReceivedMessage {
  const entry = {
    topic,
    payload,
    receivedAt: new Date().toISOString()
  };

  receivedMessages.push(entry);
  if (receivedMessages.length > maxMessages) {
    receivedMessages.shift();
  }

  return entry;
}

function parseJsonOrRaw(messageBuffer: Buffer): Record<string, unknown> {
  const text = messageBuffer.toString('utf8');
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
}

const mqttClient: MqttClient = mqtt.connect(brokerUrl);

mqttClient.on('connect', () => {
  mqttConnected = true;
  console.log(`[mqtt] connected to ${brokerUrl}`);

  mqttClient.subscribe(['notification/user', 'notification/ack'], { qos: 1 }, (error?: Error | null) => {
    if (error) {
      console.error(`[mqtt] subscribe failed: ${error.message}`);
      return;
    }

    console.log('[mqtt] subscribed to notification/user and notification/ack');
  });
});

mqttClient.on('reconnect', () => {
  console.warn('[mqtt] reconnecting');
});

mqttClient.on('offline', () => {
  mqttConnected = false;
  console.warn('[mqtt] offline');
});

mqttClient.on('error', (error: Error) => {
  mqttConnected = false;
  console.error(`[mqtt] error: ${error.message}`);
});

mqttClient.on('message', (topic: string, message: Buffer) => {
  const payload = parseJsonOrRaw(message);
  const entry = rememberMessage(topic, payload);
  console.log(`[notification-received] topic=${entry.topic} payload=${JSON.stringify(entry.payload)}`);
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'UP',
    mqttConnected,
    brokerUrl
  });
});

app.get('/notifications/received', (_req: Request, res: Response) => {
  res.json({
    count: receivedMessages.length,
    messages: receivedMessages
  });
});

app.listen(port, host, () => {
  console.log(`notification-service listening on http://${host}:${port}`);
});
