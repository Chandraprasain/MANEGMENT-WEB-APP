import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { DatabaseSync } from 'node:sqlite';
import { resolveSessionFromToken, SESSION_COOKIE_NAME } from './security';

interface ConnectedClient {
  ws: WebSocket;
  userId: string;
  schoolId: string | null;
  fullName: string;
}

const clients = new Set<ConnectedClient>();

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      out[k] = v;
    }
  }
  return out;
}

export function initRealtimeServer(server: HttpServer, db: DatabaseSync) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname !== '/ws') return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    const cookies = parseCookies(req.headers.cookie);
    const session = resolveSessionFromToken(db, cookies[SESSION_COOKIE_NAME]);
    if (!session) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const client: ConnectedClient = {
      ws,
      userId: session.userId,
      schoolId: session.activeSchoolId,
      fullName: session.fullName,
    };
    clients.add(client);

    ws.send(
      JSON.stringify({
        type: 'connection:ready',
        payload: { userId: session.userId, schoolId: session.activeSchoolId },
      })
    );

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { type?: string; conversationId?: string; recipientUserId?: string };
        if (msg.type === 'typing' && msg.recipientUserId) {
          emitToUser(msg.recipientUserId, 'typing:indicator', {
            conversationId: msg.conversationId,
            userId: client.userId,
            fullName: client.fullName,
          });
        }
      } catch {
        // ignore malformed client frame
      }
    });

    ws.on('close', () => {
      clients.delete(client);
    });
  });

  return wss;
}

export function emitToUser(userId: string, type: string, payload: unknown) {
  const data = JSON.stringify({ type, payload });
  for (const c of clients) {
    if (c.userId === userId && c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(data);
    }
  }
}

export function emitToSchool(schoolId: string, type: string, payload: unknown) {
  const data = JSON.stringify({ type, payload });
  for (const c of clients) {
    if (c.schoolId === schoolId && c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(data);
    }
  }
}
