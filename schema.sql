-- 최희 작가 홈페이지 — total-db 안에서 쓰는 표 (참고용)
--
-- 이 파일은 직접 실행하지 않아도 됩니다.
-- 홈페이지가 처음 접속될 때 아래 표를 스스로 만듭니다.
-- 모든 표와 색인 이름은 choihee_ 로 시작하므로, total-db를 함께 쓰는
-- 다른 홈페이지의 표와 섞이거나 겹치지 않습니다.
--
-- 표가 잘 만들어졌는지 확인할 때는 D1 콘솔에서 아래 한 줄만 실행하십시오.
--   SELECT name FROM sqlite_master WHERE name LIKE 'choihee_%' ORDER BY name;

CREATE TABLE IF NOT EXISTS choihee_meta (key TEXT PRIMARY KEY, value TEXT);

-- 관리 화면에서 고친 문구·사진 주소·링크·목록 (처음 상태와 달라진 것만 저장)
CREATE TABLE IF NOT EXISTS choihee_content (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 독자 게시판
CREATE TABLE IF NOT EXISTS choihee_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 문의·제안
CREATE TABLE IF NOT EXISTS choihee_inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 관리 화면에서 올린 사진 (정보 + 90KB씩 나눈 내용)
CREATE TABLE IF NOT EXISTS choihee_media (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  bytes INTEGER NOT NULL,
  chunks INTEGER NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS choihee_media_chunks (
  media_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (media_id, seq)
);

-- 관리자 비밀번호를 여러 번 틀린 기록 (15분 잠금용)
CREATE TABLE IF NOT EXISTS choihee_login_attempts (
  ip TEXT PRIMARY KEY,
  fails INTEGER NOT NULL,
  first_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS choihee_idx_inquiries_status ON choihee_inquiries (status, id);
