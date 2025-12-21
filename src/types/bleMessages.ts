export type BleMessageType = "audio" | "ai_text" | "control" | "time";

export interface BleMessage {
  type: BleMessageType;
  payload: string | Uint8Array;
  timestamp: number;
}

export interface ControlMessage {
  command: "REQ_TIME" | "SET_PERSONA" | "UNKNOWN";
  data?: string;
}
