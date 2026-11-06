type Snapshot = { body: string; etag: string; at: number; checked: number };
type Conditional = Snapshot | { same: true; etag: string; at: number; checked: number };
type Reader = { get(key: string): Promise<Snapshot | null>; getIf(key: string, etag: string): Promise<Conditional | null> };

// 화면 틀 하나만 보관. Promise는 나누지 않고 요청마다 DO의 ETag·현재 시각을 확인함.
export class PageSnapshot {
  private value: Snapshot | null = null;
  async read(stub: Reader): Promise<Snapshot | null> {
    const previous = this.value;
    let got: Conditional | null;
    try { got = await stub.getIf("page", previous?.etag || ""); }
    catch { got = await stub.get("page"); }   // 구형 DO · 섞인 배포는 기존 읽기로
    if (!got) { this.value = null; return null; }
    if ("same" in got) {
      // 다른 요청이 새 판을 받아도, 이 응답의 ETag와 맞는 당시 본문을 씀.
      if (previous?.etag === got.etag) return { ...previous, etag: got.etag, at: got.at, checked: got.checked };
      const full = await stub.get("page"); this.value = full; return full;
    }
    this.value = got;
    return got;
  }
}
