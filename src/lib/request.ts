/** Abort를 무시하고 완료된 요청도 화면에 반영하지 않는다. effect cleanup에서 반환 함수를 호출한다. */
export function startRequest<T>(
  load: (signal: AbortSignal) => Promise<T>,
  onSuccess: (value: T) => void,
  onError: (error: unknown) => void,
): () => void {
  const controller = new AbortController();
  void Promise.resolve().then(() => {
    if (controller.signal.aborted) return;
    return load(controller.signal).then(
      (value) => { if (!controller.signal.aborted) onSuccess(value); },
      (error: unknown) => { if (!controller.signal.aborted) onError(error); },
    );
  }).catch((error: unknown) => {
    if (!controller.signal.aborted) onError(error);
  });
  return () => controller.abort();
}
