import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Kafka, type Consumer, type Producer } from 'kafkajs';
import type {
  DispatchNotificationRequest,
  DispatchNotificationResult,
  NotificationStatus,
  ReceivedMessage,
  StoredNotification
} from './types';

const host = process.env.NOTIFICATION_HOST || '0.0.0.0';
const port = Number.parseInt(process.env.NOTIFICATION_PORT || '8080', 10);
const kafkaBrokers = (process.env.NOTIFICATION_KAFKA_BROKERS || 'localhost:9092')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const userNotificationTopic = process.env.NOTIFICATION_USER_TOPIC || 'notification.user';
const notificationAckTopic = process.env.NOTIFICATION_ACK_TOPIC || 'notification.ack';
const ackConsumerGroup = process.env.NOTIFICATION_ACK_GROUP || 'notification-service-ack-group';

const app = express();
app.use(express.json({ limit: '1mb' }));

const kafka = new Kafka({
  clientId: 'notification-service',
  brokers: kafkaBrokers
});
const producer: Producer = kafka.producer();
const consumer: Consumer = kafka.consumer({ groupId: ackConsumerGroup });
const receivedMessages: ReceivedMessage[] = [];
const notifications = new Map<string, StoredNotification>();
const maxMessages = 100;
let kafkaConnected = false;

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
    return JSON.parse(text) as Record<string, unknown>;
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

async function publishKafkaMessage(topic: string, payload: Record<string, unknown>): Promise<void> {
  await producer.send({
    topic,
    messages: [{ key: String(payload.requestId || randomUUID()), value: JSON.stringify(payload) }]
  });
}

function toNotificationStatus(record: StoredNotification): NotificationStatus {
  return {
    notificationId: record.notificationId,
    status: record.status,
    updatedAt: record.updatedAt
  };
}

async function startKafkaMessaging(): Promise<void> {
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: notificationAckTopic, fromBeginning: false });
  kafkaConnected = true;
  console.log(`[kafka] connected to ${kafkaBrokers.join(',')}`);
  console.log(`[kafka] subscribed to ${notificationAckTopic}`);

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      if (!message.value) {
        return;
      }

      const payload = parseJsonOrRaw(message.value);
      const entry = rememberMessage(topic, payload);
      console.log(`[notification-received] topic=${entry.topic} payload=${JSON.stringify(entry.payload)}`);

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
    }
  });
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'UP',
    kafkaConnected,
    kafkaBrokers
  });
});

app.get('/_meta/notifications/received', (_req: Request, res: Response) => {
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
    await publishKafkaMessage(userNotificationTopic, {
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
    console.error(`[kafka] publish failed: ${message}`);
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
    res.status(200).json({
      notificationId,
      status: 'ACCEPTED',
      updatedAt: new Date().toISOString()
    });
    return;
  }

  res.status(200).json(toNotificationStatus(notification));
});

void startKafkaMessaging().catch((error: unknown) => {
  kafkaConnected = false;
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[kafka] startup failed: ${message}`);
});

app.listen(port, host, () => {
  console.log(`notification-service listening on http://${host}:${port}`);
});
