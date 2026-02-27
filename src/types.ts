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

export type ShippingShippedEvent = {
  eventId: string;
  orderId: string;
  shipmentId: string;
  status: 'CREATED' | 'PICKED_UP' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED';
  title: string;
  body: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH';
  occurredAt: string;
};

export type ShippingReturnedEvent = {
  eventId: string;
  orderId: string;
  shipmentId: string;
  returnId: string;
  status: 'RETURN_INITIATED' | 'IN_TRANSIT' | 'RECEIVED' | 'COMPLETED' | 'FAILED';
  title: string;
  body: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH';
  occurredAt: string;
};
