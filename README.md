# 최희 작가 홈페이지 (기록의 숲)

GitHub 저장소에 올려 두면 Cloudflare Pages가 자동으로 홈페이지를 만들어 주는 구조입니다.
글과 사진은 관리 화면(`/admin`)에서 고치고, 그 내용은 공용 DB **total-db**에 이 홈페이지 전용 표로 저장됩니다.
모든 과정은 브라우저에서 할 수 있습니다. 터미널은 필요 없습니다.

```
public/          홈페이지 파일 (Cloudflare가 이 폴더만 올립니다)
  index.html · about.html · books.html · board.html · contact.html   공개 페이지
  admin.html     관리 화면 (메뉴에 나오지 않는 비공개 주소)
  _worker.js     게시판·문의·관리 기능과 DB 연결
  assets/        스타일 · 스크립트 · 사진 · 소개서 PDF · 기본 목록(data/defaults.json)
schema.sql       DB 표 구조 (참고용. 홈페이지가 처음 열릴 때 스스로 만듭니다)
```

---

## 1. GitHub에 올리기

1. GitHub에서 **New repository** → 이름(예: `choihee-homepage`) → **Private** 선택 → **Create repository**
2. 새 저장소 화면에서 **uploading an existing file** 을 누릅니다.
3. 압축을 푼 폴더 **안의 내용물**(`public` 폴더, `README.md`, `schema.sql`)을 끌어다 놓고 **Commit changes** 를 누릅니다.
   - 바깥 폴더째 올리면 경로가 한 단계 깊어져 배포가 되지 않습니다. 저장소 첫 화면에 `public` 폴더가 바로 보여야 합니다.

## 2. Cloudflare Pages와 연결하기

1. Cloudflare 대시보드 → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
2. **GitHub** 를 고르고 방금 만든 저장소에 접근을 허락한 뒤 **Begin setup**
3. 빌드 설정을 이렇게 채웁니다.

| 항목 | 값 |
|---|---|
| Production branch | `main` |
| Framework preset | `None` |
| Build command | 비워 둠 |
| Build output directory | `public` |

4. **Save and Deploy** — 1~2분 뒤 `프로젝트이름.pages.dev` 주소가 생깁니다.
   이때는 공개 페이지만 보이고 게시판·문의·관리 화면은 아직 "준비 중"입니다.

## 3. DB와 관리자 비밀번호 연결하기

프로젝트 → **Settings**

| 메뉴 | 종류 | 이름 | 값 |
|---|---|---|---|
| Bindings → Add | D1 database | `DB` | `total-db` 선택 |
| Variables and Secrets → Add | **Secret** | `ADMIN_KEY` | 관리자 비밀번호 (영문·숫자 섞어 12자 이상) |

- 이름은 대소문자까지 정확히 `DB`, `ADMIN_KEY` 로 넣어 주십시오.
- 비밀번호는 다시 볼 수 없으니 따로 적어 두십시오.

설정은 **다음 배포부터** 적용됩니다. **Deployments** 탭 → 맨 위 배포 오른쪽 `⋯` → **Retry deployment** 를 한 번 눌러 주십시오.

## 4. 잘 됐는지 확인하기

브라우저에서 `https://홈페이지주소/api/health` 를 엽니다.

```
{"ok":true,"db":true,"admin":true,"schema":1,"prefix":"choihee_"}
```

이렇게 나오면 끝입니다. `db:false` 면 3단계의 `DB` 연결을, `admin:false` 면 `ADMIN_KEY` 를 확인하고 다시 배포하십시오.
DB 표는 이 순간 자동으로 만들어졌습니다. 따로 SQL을 실행할 필요가 없습니다.

## 5. 관리 화면 쓰기

`https://홈페이지주소/admin` → 관리자 비밀번호 입력

| 메뉴 | 할 수 있는 일 |
|---|---|
| 홈 · 작가 소개 · 저서 페이지 문구 · 게시판 문구 · 문의·제안 문구 | 페이지에 보이는 문장과 사진을 고칩니다 |
| 머리글·바닥글 | 모든 페이지 위·아래 공통 부분 (이름, 거점 주소 등) |
| 저서 목록 | 책 추가·삭제·순서 바꾸기, 표지·소개·구매 링크 |
| 이력 (연보) | 작가 소개의 연보 항목 추가·삭제·순서 바꾸기 |
| 문의함 | 들어온 문의 확인, 답장 메일 쓰기, 답변 완료 표시, 삭제 |
| 독자 게시판 글 | 광고·비방 글 삭제 |
| 사진 보관함 | 올린 사진 확인, 쓰지 않는 사진 정리 |
| 백업·복원 | 이 홈페이지 내용만 파일로 받고 되돌리기 |

- 고친 뒤 화면 아래 **저장하고 홈페이지에 반영** 을 눌러야 바뀝니다.
- 사진은 자리에 맞는 비율로 잘라 알맞은 크기로 줄인 뒤 올라갑니다. 자를 위치는 직접 고를 수 있습니다.
- 어느 칸이든 **처음 내용으로** 를 누르면 처음 상태로 돌아갑니다.
- 비밀번호를 8번 틀리면 15분 동안 잠깁니다. 로그인은 8시간 동안 유지됩니다.

## 6. 공용 DB(total-db)를 쓸 때 꼭 지킬 것

- 이 홈페이지는 이름이 **`choihee_`** 로 시작하는 표만 만들고 씁니다. 다른 홈페이지의 표는 읽지도 쓰지도 않습니다.
- 다만 D1에는 표마다 권한을 나누는 기능이 없습니다. 이름 규칙으로 구분하는 것이니, total-db를 쓰는 **다른 홈페이지도 각자 고유한 접두어**(예: `hantang_`)를 쓰도록 맞춰 두십시오.
- Cloudflare의 **Time Travel(시간 되돌리기)은 쓰지 마십시오.** total-db 전체가 되돌아가 다른 홈페이지의 데이터까지 과거로 돌아갑니다. 이 홈페이지만 되돌릴 때는 관리 화면의 **백업·복원**을 쓰십시오.
- D1 콘솔에서 `DROP`, `DELETE` 같은 명령은 실행하지 마십시오.
- 사진도 total-db에 저장됩니다. 사진 보관함의 **쓰지 않는 사진 정리**를 가끔 눌러 DB를 가볍게 유지해 주십시오.
- 표 확인용 SQL: `SELECT name FROM sqlite_master WHERE name LIKE 'choihee_%' ORDER BY name;`

## 7. 파일을 고쳐야 할 때

관리 화면으로 고칠 수 없는 부분(디자인, 새 페이지 등)은 GitHub에서 파일을 고치면 됩니다.
파일을 열고 연필 아이콘 → 수정 → **Commit changes** 를 누르면 1~2분 뒤 자동으로 다시 배포됩니다.

- 관리 화면에서 고친 내용은 DB에 따로 저장되어 있어서, 파일을 고쳐도 그대로 유지됩니다.
- 관리 화면에서 고친 내용이 파일의 처음 문구보다 우선합니다.
- 배포에 문제가 생기면 **Deployments** 에서 이전 배포의 `⋯` → **Rollback** 으로 바로 되돌릴 수 있습니다.

## 8. 예전 홈페이지에서 옮겨 올 때

- 예전에 zip 파일로 올린 Pages 프로젝트와 그때 만든 D1(`choihee-site` 등)은 새 홈페이지와 상관이 없습니다. 새 주소가 잘 동작하는 것을 확인한 뒤 정리하십시오.
- 예전 프로젝트에 연결해 둔 **도메인**이 있다면, 예전 프로젝트의 Custom domains에서 지운 뒤 새 프로젝트의 **Custom domains** 에 다시 연결하십시오.
- 예전 홈페이지에 실제 게시글이나 문의가 쌓여 있었다면 그대로 옮길 수 있으니 말씀해 주십시오.

## 9. 문제가 생겼을 때

| 증상 | 확인할 곳 |
|---|---|
| 게시판에 "준비 중"이 나옴 | `/api/health` 에서 `db` 값 → 3단계 `DB` 연결 후 다시 배포 |
| 관리 화면에서 비밀번호 설정 안내가 나옴 | 3단계 `ADMIN_KEY` 를 **Secret** 으로 넣었는지, 다시 배포했는지 |
| 고쳤는데 홈페이지가 그대로임 | 저장 버튼을 눌렀는지, 그래도 같으면 `Ctrl+F5` 로 새로고침 |
| 저장소에 올렸는데 배포가 실패함 | 저장소 첫 화면에 `public` 폴더가 바로 있는지, Build output directory가 `public` 인지 |
