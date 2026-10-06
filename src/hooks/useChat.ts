import { useEffect, useState } from 'react';
import { createChatSession, type ChatState } from '../lib/chat-session';

export function useChat() {
  const [question, setQuestion] = useState('');
  const [state, setState] = useState<ChatState>({ status: 'idle' });
  const [session] = useState(() => createChatSession(setState));
  useEffect(() => () => session.cancel(), [session]);
  return { question, setQuestion, state, submit: session.submit };
}
export type ChatController = ReturnType<typeof useChat>;
