import type { ChatSnapshot } from './chat-session';
import type { ChatResponse } from '../types/chat';

/** 채팅창에 보이는 메시지 한 개. 방금 받은 답변은 서버 근거(response)를 함께 가진다. */
export interface ThreadItem {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  /** 저장된 메시지의 시각 */
  createdAt?: string;
  /** 이번 화면에서 받은 답변의 서버 근거와 요청 당시 대상 */
  response?: ChatResponse;
  snapshot?: ChatSnapshot;
}
