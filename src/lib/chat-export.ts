import type {CompletedChat} from './chat-storage';
/** 브라우저가 권한 응답을 주지 않는 경우에도 수동 대안을 안내할 수 있게 한다. */
export async function copyChatText(text:string,write:(value:string)=>Promise<void>=value=>navigator.clipboard.writeText(value),timeoutMs=2000):Promise<void> {
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {await Promise.race([write(text),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Clipboard result unavailable')),timeoutMs);})]);}
 finally{if(timer)clearTimeout(timer);}
}
/** 저장된 답변의 근거/시점을 함께 보존한다. 새로운 API 조회를 하지 않는다. */
export function formatChatExport({snapshot,response,completedAt}:CompletedChat):string {
 const lines=['유튜브 트렌드 AI 분석',`완료 시각: ${new Date(completedAt).toISOString()}`,`요청 대상: ${snapshot.label}`,`출처: ${snapshot.source??'목록'}`,`대상 목록 시점: ${snapshot.capturedAt?new Date(snapshot.capturedAt).toISOString():'기록 없음'}`];
 if(snapshot.query)lines.push(`적용 조건: 검색어=${snapshot.query.q||'없음'} / 카테고리=${snapshot.query.categoryId||'전체'} / 정렬=${snapshot.query.order||'기본'}`);
 lines.push('','[질문]',snapshot.question,'','[답변]',response.answer,'','[근거 영상]','공개 메타데이터는 질문 전송 시 서버가 다시 조회했습니다. 영상·음성 자체는 분석하지 않았습니다.');
 const count=(value:number|null)=>value===null?'정보 없음':value.toLocaleString('ko-KR');
 response.context.videos.forEach((v,i)=>lines.push(`${i+1}. ${v.title}`,`https://www.youtube.com/watch?v=${v.id}`,`채널: ${v.channelTitle} / 카테고리: ${v.category??'정보 없음'}`,`업로드일: ${v.publishedAt.slice(0,10)} / 조회수: ${count(v.viewCount)} / 좋아요: ${count(v.likeCount)} / 댓글: ${count(v.commentCount)} / 구독자: ${count(v.subscriberCount)}`));
 lines.push(`조회 불가로 제외된 ID: ${response.context.excludedIds.join(', ')||'없음'}`,`모델: ${response.model}`);
 return lines.join('\n');
}
