export interface HotVideo {
  id: string;
  title: string;
  thumbnail: string | null;
  channel: string | null;
  /** 예: 「시간당 12만」 */
  metric: string;
  note: string;
}
export interface HotItem {
  label: string;
  /** 큰 숫자·문장 */
  metric: string;
  note: string;
  /** 오르는 중이면 true(화살표 색) */
  rising?: boolean;
  onClick?: () => void;
}

/** 대시보드 맨 위: 지금 가장 눈에 띄는 영상·태그·분야 한 가지씩. 기준은 basis에 적는다. */
export default function Spotlight({
  title,
  basis,
  video,
  tag,
  field,
  onOpenVideo,
}: {
  title: string;
  basis: string;
  video: HotVideo | null;
  tag: HotItem | null;
  field: HotItem | null;
  onOpenVideo: (id: string) => void;
}) {
  if (!video && !tag && !field) return null;
  return (
    <section className="spotlight" aria-label={title}>
      <header className="spotlight-head">
        <h2>
          <span className="live-dot" aria-hidden="true" />
          {title}
        </h2>
        <p>{basis}</p>
      </header>
      <div className="spotlight-grid">
        {video && (
          <button type="button" className="spot spot-video" onClick={() => onOpenVideo(video.id)}>
            {video.thumbnail && <img src={video.thumbnail} alt="" loading="lazy" />}
            <span className="spot-shade" aria-hidden="true" />
            <span className="spot-badge">가장 핫한 영상</span>
            <span className="spot-body">
              <span className="spot-metric">{video.metric}</span>
              <span className="spot-title">{video.title}</span>
              <span className="spot-note">
                {video.channel ? `${video.channel} · ` : ''}
                {video.note}
              </span>
            </span>
          </button>
        )}
        {tag && <SpotText kind="가장 뜨는 태그" item={tag} />}
        {field && <SpotText kind="가장 뜨는 분야" item={field} />}
      </div>
    </section>
  );
}

function SpotText({ kind, item }: { kind: string; item: HotItem }) {
  const body = (
    <>
      <span className="spot-badge is-plain">{kind}</span>
      <span className="spot-label">{item.label}</span>
      <span className={`spot-metric ${item.rising ? 'is-rising' : ''}`}>{item.metric}</span>
      <span className="spot-note">{item.note}</span>
    </>
  );
  return item.onClick ? (
    <button type="button" className="spot spot-text" onClick={item.onClick}>
      {body}
    </button>
  ) : (
    <div className="spot spot-text">{body}</div>
  );
}
