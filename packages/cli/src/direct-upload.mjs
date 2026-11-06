async function putPart(url, headers, body, signal, progress) {
  if (typeof XMLHttpRequest === 'undefined') {
    const controller = new AbortController(), cancel = () => controller.abort(signal.reason), timer = setTimeout(() => controller.abort(new Error('올리기 시간 초과')), 120000);
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
    try { return await fetch(url, { method: 'PUT', headers, body, credentials: 'omit', signal: controller.signal }); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest(); let timer, settled = false;
    const finish = (err, response) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); err ? reject(err) : resolve(response); };
    const cancel = () => { finish(signal.reason || new Error('올리기 취소')); x.abort(); };
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { finish(new Error('2분 동안 진행 없음')); x.abort(); }, 120000); };
    x.open('PUT', url); x.withCredentials = false;
    for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() !== 'content-length') x.setRequestHeader(key, value);
    x.upload.onprogress = e => { arm(); if (e.lengthComputable) progress(e.loaded / e.total); };
    x.upload.onload = arm;
    x.onload = () => finish(null, { ok: x.status >= 200 && x.status < 300, status: x.status, headers: { get: key => x.getResponseHeader(key) } });
    x.onerror = () => finish(new Error('연결 끊김'));
    x.onabort = () => finish(new Error('올리기 취소'));
    if (signal?.aborted) return cancel();
    signal?.addEventListener('abort', cancel, { once: true }); arm(); x.send(body);
  });
}
export function legacyUploadAllowed(error) {
  return [404,405,410,415,501].includes(error?.status) || error?.status === 503 && error?.code === 'direct_upload_unavailable';
}
// 이 모듈은 CLI와 보드에서 함께 쓴다. 제어 요청의 인증은 R2 PUT으로 넘기지 않는다.
export async function uploadDirect(blob, { control, init, session, progress = () => {}, signal, legacy } = {}) {
  if (!blob || !Number.isSafeInteger(blob.size) || blob.size < 0 || blob.size > 500 * 1024 * 1024) throw new Error('500MB 이하의 파일을 골라 주세요');
  if (!session) {
    try { session = await control('init', init); }
    catch (e) { if (legacy && (legacyUploadAllowed(e) || e?.status === 400 && !e?.code) && !signal?.aborted) return legacy(); throw e; }
  }
  if (session.done) return session;
  session.uploaded ||= [];
  const wait = ms => new Promise((resolve, reject) => {
    const done = () => { clearTimeout(t); signal?.removeEventListener('abort', fail); resolve(); };
    const fail = () => { clearTimeout(t); signal?.removeEventListener('abort', fail); reject(signal.reason || new Error('올리기 취소')); };
    const t = setTimeout(done, ms); signal?.addEventListener('abort', fail, { once: true });
  });
  try {
  for (let number = 1; number <= session.parts; number++) {
    signal?.throwIfAborted();
    const start = (number - 1) * session.partSize, chunk = blob.slice(start, Math.min(blob.size, start + session.partSize));
    if (session.uploaded[number - 1]) { progress(Math.min(blob.size, start + chunk.size) / blob.size); continue; }
    for (let attempt = 0; ; attempt++) {
      try {
        const signed = await control('part', { id: session.id, number }), headers = { ...signed.headers };
        // Forbidden header in browsers; fetch attaches the exact Blob length itself.
        if (typeof window !== 'undefined') delete headers['content-length'];
        const r = await putPart(signed.url, headers, chunk, signal, fraction => progress((start + fraction * chunk.size) / blob.size));
        if (!r.ok) throw Object.assign(new Error(`R2 ${r.status}`), { status: r.status });
        const etag = r.headers.get('etag'); if (!etag) throw new Error('R2 응답에서 파일 확인값을 읽을 수 없어요');
        session.uploaded[number - 1] = { partNumber: number, etag: etag.replace(/^"|"$/g, '') }; break;
      } catch (e) {
        if (signal?.aborted || attempt >= 2 || (e.status >= 400 && e.status < 500 && e.status !== 403 && e.status !== 429)) throw e;
        await wait(1000 * (attempt + 1));
      }
    }
    progress(Math.min(blob.size, start + chunk.size) / blob.size);
  }
  return await control('complete', { id: session.id, parts: session.uploaded });
  } catch (e) {
    if (signal?.aborted) await control('abort', { id: session.id }).catch(() => {});
    throw e;
  }
}
