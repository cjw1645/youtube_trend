import { type CSSProperties, useMemo } from 'react';
import {
  ArrowRightIcon,
  BookmarkIcon,
  ChatBubbleIcon,
  DashboardIcon,
  MagnifyingGlassIcon,
} from '@radix-ui/react-icons';
import { CHART_PATH, POPULAR_CACHE_MS } from '../hooks/useVideos';
import { useApiResource } from '../hooks/useApiResource';
import { ErrorView } from '../components/StatusView';
import HelpTip from '../components/HelpTip';
import TopicCloud from '../components/TopicCloud';
import { aggregateKeywords, topBy, viewsPerHour } from '../lib/stats';
import { formatCount, formatRelativeDate } from '../lib/format';
import type { Page } from '../components/Sidebar';
import type { Video, VideosResponse } from '../types/video';

/** 사용 흐름. 순서 자체가 작업 순서라 번호를 붙인다. */
const FLOW: { page: Page; title: string; text: string; icon: typeof DashboardIcon }[] = [
  {
    page: 'dashboard',
    title: '인기 흐름 보기',
    text: '인기 차트에서 빠르게 크는 영상과 소재를 봅니다.',
    icon: DashboardIcon,
  },
  {
    page: 'search',
    title: '키워드로 찾기',
    text: '내 분야 키워드로 검색하고 카테고리·정렬로 좁힙니다.',
    icon: MagnifyingGlassIcon,
  },
  {
    page: 'favorites',
    title: '근거 영상 모으기',
    text: '기획에 참고할 영상을 관심 영상으로 저장합니다.',
    icon: BookmarkIcon,
  },
  {
    page: 'ai',
    title: 'AI로 기획하기',
    text: '고른 영상의 공개 정보만 근거로 분석과 제안을 받습니다.',
    icon: ChatBubbleIcon,
  },
];

/** 인기 차트가 한 분야로 쏠려 있어도 내 분야로 바로 들어갈 수 있게 하는 시작 키워드 */
const FIELDS = ['반려동물', '브이로그', '요리', '여행', '뷰티', '운동', '육아', '교육'];

const order = (index: number) => ({ '--i': index }) as CSSProperties;

/** 첫 화면: 무엇을 하는 곳인지 실제 인기 차트 데이터와 사용 흐름으로 보여준다. */
export default function Main({
  navigate,
  onSelect,
  onSearchKeyword,
}: {
  navigate: (page: Page) => void;
  onSelect: (video: Video) => void;
  onSearchKeyword: (keyword: string) => void;
}) {
  const chart = useApiResource<VideosResponse>(CHART_PATH, { cacheMs: POPULAR_CACHE_MS });
  const videos = chart.state.status === 'success' ? chart.state.data.items : undefined;
  const now = chart.state.status === 'success' ? chart.state.receivedAt : 0;
  const fastest = useMemo(
    () => (videos ? topBy(videos, (video) => viewsPerHour(video, now), 4) : []),
    [videos, now],
  );
  const keywords = useMemo(
    () => (videos ? aggregateKeywords(videos, { limit: 60 }) : []),
    [videos],
  );

  return (
    <div className="main-page">
      <section className="main-hero" aria-labelledby="main-title">
        <h1 id="main-title">
          지금 뜨는 유튜브에서
          <br />
          다음 영상 소재를 찾으세요
        </h1>
        <p className="main-lead">
          소규모 채널 편집자·기획자를 위한 트렌드 도구입니다. YouTube 공개 데이터로 인기 흐름을
          보고, 고른 영상을 근거로 AI에게 기획을 묻습니다.
        </p>
        <div className="main-actions">
          <button type="button" className="primary-button" onClick={() => navigate('dashboard')}>
            인기 흐름 보기 <ArrowRightIcon aria-hidden="true" />
          </button>
          <button type="button" className="secondary-button" onClick={() => navigate('ai')}>
            AI에게 기획 묻기
          </button>
        </div>
      </section>

      <section className="main-fields" aria-labelledby="main-fields-title">
        <h2 id="main-fields-title">내 분야로 먼저 찾아보기</h2>
        <p>
          인기 차트는 지금 게임이 많아요. 내 채널 분야를 눌러 그 주제의 영상부터 찾아보세요(로그인
          후 검색할 수 있어요).
        </p>
        <ul>
          {FIELDS.map((field) => (
            <li key={field}>
              <button type="button" className="keyword-chip" onClick={() => onSearchKeyword(field)}>
                {field}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="main-live" aria-labelledby="main-live-title">
        <div className="title-row">
          <h2 id="main-live-title">지금 빠르게 조회수를 모으는 영상</h2>
          <HelpTip label="선정 기준 보기">
            YouTube 인기 차트 {videos?.length ?? 0}개 중 업로드 후 시간당 조회수(누적 ÷ 경과 시간,
            최소 1시간)가 높은 순서입니다.
          </HelpTip>
        </div>
        {chart.state.status === 'error' ? (
          <ErrorView
            compact
            title="인기 차트를 불러오지 못했습니다"
            error={chart.state.error}
            onRetry={chart.reload}
          />
        ) : (
          <ol className="main-live-board" aria-busy={!videos}>
            {videos
              ? fastest.map(({ item, score }, index) => (
                  <li
                    key={item.id}
                    className={index === 0 ? 'is-lead' : undefined}
                    style={order(index)}
                  >
                    <button type="button" className="main-video" onClick={() => onSelect(item)}>
                      <span className="main-video-thumb">
                        <img
                          src={item.thumbnailUrl}
                          alt=""
                          loading={index === 0 ? 'eager' : 'lazy'}
                        />
                      </span>
                      <span className="main-video-body">
                        <span className="main-video-rank">{index + 1}위</span>
                        <span className="main-video-title">{item.title}</span>
                        <span className="main-video-meta">
                          {item.channelTitle} ·{' '}
                          {formatRelativeDate(item.publishedAt, new Date(now))}
                        </span>
                        <span className="main-video-metric">
                          시간당 <strong>{formatCount(Math.round(score))}</strong>회
                        </span>
                      </span>
                    </button>
                  </li>
                ))
              : Array.from({ length: 4 }, (_, index) => (
                  <li
                    key={index}
                    className={index === 0 ? 'is-lead main-video-skeleton' : 'main-video-skeleton'}
                    aria-hidden="true"
                  />
                ))}
          </ol>
        )}
      </section>

      {chart.state.status !== 'error' && (
        <section className="main-topics" aria-labelledby="main-topics-title">
          <div className="title-row">
            <h2 id="main-topics-title">지금 뜨고 있는 키워드를 바로 확인하세요</h2>
            <HelpTip label="집계 기준 보기">
              YouTube 인기 차트 영상 {videos?.length ?? 0}개의 제목·태그에서 2개 이상 영상에 나온
              단어입니다. 많은 영상에 나올수록 크게 보입니다. 단어를 누르면 그 키워드로 검색합니다.
            </HelpTip>
          </div>
          {videos ? (
            <TopicCloud words={keywords} onSelect={onSearchKeyword} />
          ) : (
            <div className="topic-cloud is-loading" aria-hidden="true" />
          )}
        </section>
      )}

      <section className="main-flow" aria-labelledby="main-flow-title">
        <h2 id="main-flow-title">이렇게 씁니다</h2>
        <ol>
          {FLOW.map(({ page, title, text, icon: Icon }, index) => (
            <li key={page} style={order(index)}>
              <button type="button" onClick={() => navigate(page)}>
                <span className="main-flow-step" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="main-flow-title">
                  <Icon aria-hidden="true" />
                  {title}
                </span>
                <span className="main-flow-text">{text}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
