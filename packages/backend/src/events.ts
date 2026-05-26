import { EventEmitter } from 'node:events';
import type { WsEvent } from '@aurex/shared';

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

export function emitEvent(event: WsEvent): void {
  emitter.emit(`mission:${event.missionId}`, event);
  emitter.emit('mission:*', event);
}

export function onMissionEvent(
  missionId: string,
  listener: (event: WsEvent) => void,
): () => void {
  const channel = missionId === '*' ? 'mission:*' : `mission:${missionId}`;
  emitter.on(channel, listener);
  return () => {
    emitter.off(channel, listener);
  };
}
