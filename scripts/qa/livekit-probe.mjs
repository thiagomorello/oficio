// Sonda nativa do LiveKit (sem navegador): conecta na sala `probe` e diz se a mídia (ICE) fechou. Envs: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET.
import { Room, RoomEvent } from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';
const url = process.env.LIVEKIT_URL;
if (!url) { console.error('LIVEKIT_URL is required (e.g. wss://livekit.example.com)'); process.exit(2); }
const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: 'probe-' + Date.now(), ttl: '10m' });
at.addGrant({ roomJoin: true, room: 'probe', canPublish: true, canSubscribe: true });
const room = new Room();
room.on(RoomEvent.ConnectionStateChanged, (s) => console.log('estado:', s));
const t0 = Date.now();
try {
  await room.connect(url, await at.toJwt(), { autoSubscribe: true, dynacast: false });
  console.log(`LIVEKIT OK: conectado em ${Date.now() - t0} ms`);
  await new Promise((r) => setTimeout(r, 2000));
  await room.disconnect();
  process.exit(0);
} catch (e) {
  console.log(`LIVEKIT FALHOU em ${Date.now() - t0} ms: ${e.message}`);
  process.exit(1);
}
