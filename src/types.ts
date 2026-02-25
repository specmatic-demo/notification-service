export type ReceivedMessage = {
  topic: string;
  payload: Record<string, unknown>;
  receivedAt: string;
};

export type DispatchNotificationRequest = {
  userId: string;
  channel: 'EMAIL' | 'SMS' | 'PUSH' | 'IN_APP';
  title: string;
  body: string;
};

export type DispatchNotificationResult = {
  notificationId: string;
  status: 'ACCEPTED' | 'REJECTED';
};

export type NotificationStatus = {
  notificationId: string;
  status: 'ACCEPTED' | 'SENT' | 'DELIVERED' | 'FAILED';
  updatedAt?: string;
};

export type StoredNotification = {
  notificationId: string;
  status: 'ACCEPTED' | 'SENT' | 'DELIVERED' | 'FAILED';
  updatedAt: string;
};
