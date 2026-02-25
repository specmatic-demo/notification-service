export type ReceivedMessage = {
  topic: string;
  payload: Record<string, unknown>;
  receivedAt: string;
};
