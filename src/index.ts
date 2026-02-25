import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import mqtt, { type MqttClient } from 'mqtt';
import type {
  DispatchNotificationRequest,
  DispatchNotificationResult,
  NotificationStatus,
  ReceivedMessage,
  StoredNotification
} from './types';

const host = process.env.NOTIFICATION_HOST || '0.0.0.0';
const port = Number.parseInt(process.env.NOTIFICATION_PORT || '8080', 10);
const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';

const app = express();
app.use(express.json({ limit: '1mb' }));

const receivedMessages: ReceivedMessage[] = [];
const notifications = new Map<string, StoredNotification>();
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

function isDispatchPayload(value: unknown): value is DispatchNotificationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  const validChannel =
    payload.channel === 'EMAIL' ||
    payload.channel === 'SMS' ||
    payload.channel === 'PUSH' ||
    payload.channel === 'IN_APP';

  return (
    typeof payload.userId === 'string' &&
    payload.userId.trim().length > 0 &&
    validChannel &&
    typeof payload.title === 'string' &&
    payload.title.trim().length > 0 &&
    typeof payload.body === 'string' &&
    payload.body.trim().length > 0
  );
}

function publishMqttMessage(topic: string, payload: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 }, (error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function toNotificationStatus(record: StoredNotification): NotificationStatus {
  return {
    notificationId: record.notificationId,
    status: record.status,
    updatedAt: record.updatedAt
  };
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

  if (topic !== 'notification/ack') {
    return;
  }

  const notificationId = payload.notificationId;
  const status = payload.status;
  if (typeof notificationId !== 'string' || (status !== 'DELIVERED' && status !== 'FAILED')) {
    return;
  }

  const existing = notifications.get(notificationId);
  if (!existing) {
    return;
  }

  existing.status = status;
  existing.updatedAt = new Date().toISOString();
  notifications.set(notificationId, existing);
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

app.post('/notifications', async (req: Request, res: Response) => {
  if (!isDispatchPayload(req.body)) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const notificationId = randomUUID();
  const now = new Date().toISOString();
  notifications.set(notificationId, {
    notificationId,
    status: 'ACCEPTED',
    updatedAt: now
  });

  try {
    await publishMqttMessage('notification/user', {
      notificationId,
      requestId: randomUUID(),
      title: req.body.title,
      body: req.body.body,
      priority: 'NORMAL'
    });
    notifications.set(notificationId, {
      notificationId,
      status: 'SENT',
      updatedAt: new Date().toISOString()
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[mqtt] publish failed: ${message}`);
    notifications.set(notificationId, {
      notificationId,
      status: 'FAILED',
      updatedAt: new Date().toISOString()
    });
  }

  const result: DispatchNotificationResult = {
    notificationId,
    status: 'ACCEPTED'
  };
  res.status(202).json(result);
});

app.get('/notifications/:notificationId', (req: Request, res: Response) => {
  const { notificationId } = req.params;
  const notification = notifications.get(notificationId);
  if (!notification) {
    res.status(404).json({ error: 'Notification not found' });
    return;
  }

  res.status(200).json(toNotificationStatus(notification));
});

app.listen(port, host, () => {
  console.log(`notification-service listening on http://${host}:${port}`);
});
