import React, { useEffect, useRef, useState } from 'react';
import { CheckCheck, FileText, Paperclip, Phone, Send, Shield, Video, X } from 'lucide-react';
import { apiGet, apiMutate } from '../lib/api';
import type { AuthUser } from '../types';

interface MessagingModuleProps {
  user: AuthUser;
  wsLastMessage: { type: string; payload: Record<string, unknown> } | null;
  onSendWs?: (msg: unknown) => void;
}

export const MessagingModule: React.FC<MessagingModuleProps> = ({ user, wsLastMessage, onSendWs }) => {
  const [conversations, setConversations] = useState<Array<Record<string, unknown>>>([]);
  const [contacts, setContacts] = useState<Array<Record<string, unknown>>>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<Record<string, unknown>>>([]);
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [callBanner, setCallBanner] = useState<string | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const lastTypingSentRef = useRef<number>(0);

  const loadInbox = async () => {
    const [convRes, cntRes] = await Promise.all([
      apiGet<{ conversations: Array<Record<string, unknown>> }>('/communications/conversations', `convs:${user.activeSchoolId}`),
      apiGet<{ contacts: Array<Record<string, unknown>> }>('/communications/contacts', `contacts:${user.activeSchoolId}`),
    ]);
    if (convRes.success && convRes.data) {
      setConversations(convRes.data.conversations);
      if (!activeConvId && convRes.data.conversations[0]) {
        setActiveConvId(String(convRes.data.conversations[0].id));
      }
    }
    if (cntRes.success && cntRes.data) setContacts(cntRes.data.contacts);
  };

  const loadMessages = async (convId: string) => {
    const res = await apiGet<{ messages: Array<Record<string, unknown>> }>(
      `/communications/conversations/${convId}/messages`,
      `msgs:${convId}`
    );
    if (res.success && res.data) setMessages(res.data.messages);
  };

  useEffect(() => {
    loadInbox();
  }, [user.activeSchoolId]);

  useEffect(() => {
    setTypingUser(null);
    if (activeConvId) loadMessages(activeConvId);
  }, [activeConvId]);

  useEffect(() => {
    if (!wsLastMessage) return;
    if (wsLastMessage.type === 'message:new') {
      const p = wsLastMessage.payload;
      if (String(p.conversation_id) === activeConvId) {
        setTypingUser(null);
        setMessages((prev) => {
          if (prev.some((m) => String(m.id) === String(p.id))) return prev;
          return [...prev, p];
        });
      }
      loadInbox();
    } else if (wsLastMessage.type === 'typing:indicator') {
      const p = wsLastMessage.payload;
      if (String(p.conversationId) === activeConvId && String(p.userId) !== user.userId) {
        setTypingUser(String(p.fullName || 'Someone'));
        if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
        typingTimerRef.current = window.setTimeout(() => setTypingUser(null), 3000);
      }
    } else if (wsLastMessage.type === 'message:read') {
      const p = wsLastMessage.payload;
      if (String(p.conversation_id) === activeConvId) {
        setMessages((prev) =>
          prev.map((m) =>
            String(m.sender_user_id) === user.userId && !m.read_at
              ? { ...m, read_at: p.read_at }
              : m
          )
        );
      }
    }
  }, [wsLastMessage]);

  const activeConv = conversations.find((c) => String(c.id) === activeConvId);

  const handleDraftChange = (val: string) => {
    setDraft(val);
    const peerId = activeConv?.peer_user_id ? String(activeConv.peer_user_id) : null;
    if (val.trim() && peerId && activeConvId && onSendWs) {
      const now = Date.now();
      if (now - lastTypingSentRef.current > 1500) {
        lastTypingSentRef.current = now;
        onSendWs({ type: 'typing', conversationId: activeConvId, recipientUserId: peerId });
      }
    }
  };

  const handleUploadAttachment = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('visibility', 'SCHOOL_PRIVATE');
      const res = await fetch('/api/v1/files/upload', { method: 'POST', credentials: 'include', body: fd });
      const json = (await res.json()) as { success: boolean; data?: { url: string; originalName: string }; message?: string };
      if (json.success && json.data?.url) {
        setAttachment({ url: json.data.url, name: json.data.originalName || file.name });
      } else {
        setCallBanner(json.message || 'Attachment upload failed.');
      }
    } finally {
      setUploading(false);
    }
  };

  const handleStartConversation = async (recipientUserId: string) => {
    const res = await apiMutate<{ id: string }>('/communications/conversations', 'POST', { recipientUserId });
    if (res.success && res.data?.id) {
      await loadInbox();
      setActiveConvId(res.data.id);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConvId || (!draft.trim() && !attachment)) return;
    const text = draft.trim();
    const attUrl = attachment?.url || null;
    setDraft('');
    setAttachment(null);
    const res = await apiMutate<{ message: Record<string, unknown> }>(
      `/communications/conversations/${activeConvId}/messages`,
      'POST',
      { body: text, attachmentPath: attUrl },
      { queueIfOffline: true, offlineLabel: 'Send Message' }
    );
    if (res.success && res.data?.message) {
      setMessages((prev) => [...prev, res.data!.message]);
      loadInbox();
    } else if (res.queuedOffline) {
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          sender_user_id: user.userId,
          sender_name: user.fullName,
          body: `${text || 'Attachment'} (queued offline)`,
          attachment_path: attUrl,
          created_at: new Date().toISOString(),
        },
      ]);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Safeguarded Messaging & Calls</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Real-time WebSocket communication restricted to authorized school relationships
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          <Shield className="h-3.5 w-3.5" />
          <span>Child safeguarding active</span>
        </div>
      </div>

      {callBanner && (
        <div className="flex items-center justify-between rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-4 py-3 text-xs">
          <span>{callBanner}</span>
          <button type="button" onClick={() => setCallBanner(null)} aria-label="Close notice">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-[540px]">
        {/* Conversations + Authorized Contacts */}
        <div className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Conversations</h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto max-h-64">
            {conversations.length === 0 ? (
              <p className="p-4 text-xs text-slate-500">No conversations yet. Select an authorized contact below.</p>
            ) : (
              conversations.map((c) => (
                <button
                  key={String(c.id)}
                  type="button"
                  onClick={() => setActiveConvId(String(c.id))}
                  className={`w-full p-3.5 text-left transition-colors ${
                    activeConvId === String(c.id) ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="text-sm font-semibold truncate">{String(c.title || 'Conversation')}</div>
                  <div className="text-xs text-slate-500 truncate mt-0.5">{String(c.last_message || 'No messages yet')}</div>
                </button>
              ))
            )}
          </div>

          <div className="p-4 border-t border-b border-slate-100 dark:border-slate-800">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Authorized School Contacts</h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto flex-1">
            {contacts.map((ct) => (
              <div key={String(ct.user_id)} className="p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate">{String(ct.full_name)}</div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {String(ct.role).replace(/_/g, ' ')} · {String(ct.user_code)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleStartConversation(String(ct.user_id))}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                >
                  Message
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Active Chat Pane */}
        <div className="lg:col-span-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col overflow-hidden">
          {!activeConvId ? (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-500 p-8">
              Select a conversation or authorized contact to start messaging.
            </div>
          ) : (
            <>
              <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold">
                    {String(activeConv?.title || 'Active Conversation')}
                  </div>
                  {typingUser && (
                    <div className="text-[11px] text-blue-600 dark:text-cyan-400 font-medium">
                      {typingUser} is typing...
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href="tel:+97714482100"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    <span>Office Call</span>
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      setCallBanner(
                        'In-app WebRTC video calling requires configured TURN server credentials (TURN_SERVER_URL). Use the Office Call button for immediate phone contact.'
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50"
                  >
                    <Video className="h-3.5 w-3.5" />
                    <span>Video Meeting</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 p-5 space-y-3 overflow-y-auto max-h-[380px]">
                {messages.map((m) => {
                  const mine = String(m.sender_user_id) === user.userId;
                  const attPath = m.attachment_path ? String(m.attachment_path) : null;
                  return (
                    <div key={String(m.id)} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                      <span className="text-[10px] text-slate-400 mb-0.5">{String(m.sender_name)}</span>
                      <div
                        className={`max-w-[80%] rounded-xl px-3.5 py-2 text-sm space-y-2 ${
                          mine ? 'bg-[#0F1E36] text-white dark:bg-blue-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {attPath && (
                          <a
                            href={attPath}
                            target="_blank"
                            rel="noreferrer"
                            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs underline ${
                              mine ? 'bg-white/10 text-cyan-200' : 'bg-white dark:bg-slate-900 text-blue-600 dark:text-cyan-400'
                            }`}
                          >
                            <FileText className="h-3.5 w-3.5 shrink-0" />
                            <span>View Attachment</span>
                          </a>
                        )}
                        <div>{String(m.body)}</div>
                      </div>
                      {mine && Boolean(m.read_at) && (
                        <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-blue-600 dark:text-cyan-400">
                          <CheckCheck className="h-3 w-3" />
                          <span>Read</span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              <form onSubmit={handleSendMessage} className="p-3.5 border-t border-slate-100 dark:border-slate-800 space-y-2">
                {attachment && (
                  <div className="flex items-center justify-between rounded-lg bg-blue-50 dark:bg-blue-950/30 px-3 py-1.5 text-xs text-blue-800 dark:text-cyan-300">
                    <span className="truncate font-medium">Attached: {attachment.name}</span>
                    <button type="button" onClick={() => setAttachment(null)} aria-label="Remove attachment">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <div className="flex gap-2">
                  <label className="inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-medium cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 min-h-[42px]">
                    <Paperclip className="h-4 w-4 text-slate-500" />
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUploadAttachment(f);
                      }}
                    />
                  </label>
                  <input
                    value={draft}
                    onChange={(e) => handleDraftChange(e.target.value)}
                    placeholder={uploading ? 'Uploading attachment...' : 'Write a message...'}
                    className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]"
                  />
                  <button
                    type="submit"
                    disabled={uploading}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F1E36] dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white min-h-[42px] disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>Send</span>
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
