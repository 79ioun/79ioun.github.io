// scripts/sync-notion.js
//
// 노션 데이터베이스 3개를 읽어서 index.html을 자동으로 갱신합니다.
//
// ✅ 열(속성) 이름은 자유롭게 지으셔도 됩니다!
//    스크립트가 "이름"이 아니라 "속성 종류(타입)"로 알아서 인식해요.
//    예: 제목 칸 이름을 '과목'이라고 하든 '주차'라고 하든 상관없이,
//        Notion에서 "제목(title)" 타입으로 되어있기만 하면 자동으로 인식됩니다.
//
// 1) "수업 메모" DB
//    - 제목 타입 속성 1개 → 할 일 텍스트
//    - 체크박스 타입 속성 1개 → 완료 여부
//
// 2) "링크모음" DB
//    - 제목 타입 속성 1개 → 카드 제목
//    - URL 타입 속성 1개 → 카드가 연결될 링크
//    - Select(선택) 타입 속성 1개, 값은 "패들렛" 또는 "바이브코딩" → 어느 섹션에 들어갈지
//    - 파일과 미디어 타입 속성 1개 (선택) → 카드 썸네일 이미지
//    - 텍스트(rich text) 타입 속성 1개 (선택) → 카드 설명
//
// 3) "커리큘럼" DB
//    - 제목 타입 속성 1개 → 주차/회차
//    - 텍스트(rich text) 타입 속성 2개 → 순서대로 "주제", "내용"
//
// 필요한 환경변수:
//   NOTION_TOKEN        (2단계에서 발급받은 토큰)
//   NOTION_DB_ID         (수업 메모 DB ID)
//   NOTION_LINKS_DB_ID   (링크모음 DB ID)
//   NOTION_CURR_DB_ID    (커리큘럼 DB ID)
//
// 실행: NOTION_TOKEN=... NOTION_DB_ID=... node scripts/sync-notion.js

const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
const NOTION_LINKS_DB_ID = process.env.NOTION_LINKS_DB_ID;
const NOTION_CURR_DB_ID = process.env.NOTION_CURR_DB_ID;
const INDEX_PATH = path.join(__dirname, '..', 'index.html');
const IMAGES_DIR = path.join(__dirname, '..', 'images');

if (!NOTION_TOKEN || !NOTION_DB_ID) {
  console.error('NOTION_TOKEN, NOTION_DB_ID 환경변수가 필요합니다.');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

// ── 속성 "종류"로 값을 찾아주는 헬퍼들 ──────────────────────
// (열 이름이 뭐든 상관없이, 속성의 타입만 보고 값을 뽑아옵니다)

function findByType(properties, type) {
  return Object.values(properties).find((p) => p.type === type);
}

function getTitleText(properties) {
  const prop = findByType(properties, 'title');
  return prop?.title?.map((t) => t.plain_text).join('') || '';
}

// 노션에서 제목 텍스트에 직접 지정한 색상을 그대로 가져옵니다.
// (노션에서 글자를 선택 → 색상 적용 → 여기 자동 반영)
const NOTION_COLOR_MAP = {
  gray: '#9B9A97',
  brown: '#64473A',
  orange: '#D9730D',
  yellow: '#DFAB01',
  green: '#0F7B6C',
  blue: '#0B6E99',
  purple: '#6940A5',
  pink: '#AD1A72',
  red: '#E03E3E',
};

function colorToStyle(notionColor) {
  if (!notionColor || notionColor === 'default') return '';
  if (notionColor.endsWith('_background')) {
    const base = notionColor.replace('_background', '');
    const hex = NOTION_COLOR_MAP[base];
    return hex ? `background:${hex}33; border-radius:4px; padding:2px 6px;` : '';
  }
  const hex = NOTION_COLOR_MAP[notionColor];
  return hex ? `color:${hex};` : '';
}

function buildInlineStyle({ color, bold }) {
  const parts = [];
  const colorCss = colorToStyle(color);
  if (colorCss) parts.push(colorCss);
  if (bold) parts.push('font-weight:700;');
  return parts.length ? ` style="${parts.join(' ')}"` : '';
}

function getTitleColor(properties) {
  const prop = findByType(properties, 'title');
  return prop?.title?.[0]?.annotations?.color || 'default';
}

function getTitleBold(properties) {
  const prop = findByType(properties, 'title');
  return !!prop?.title?.[0]?.annotations?.bold;
}

function getCheckbox(properties) {
  const prop = findByType(properties, 'checkbox');
  return !!prop?.checkbox;
}

function getUrl(properties) {
  const prop = findByType(properties, 'url');
  return prop?.url || '';
}

function getSelectName(properties) {
  const prop = findByType(properties, 'select');
  return prop?.select?.name || '';
}

function getFirstFile(properties) {
  const prop = findByType(properties, 'files');
  return prop?.files?.[0];
}

// rich_text 타입 속성들을 노션에 표시된 순서대로 배열로 반환
function getRichTextList(properties) {
  return Object.values(properties)
    .filter((p) => p.type === 'rich_text')
    .map((p) => p.rich_text.map((t) => t.plain_text).join(''));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function todayLabel() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day} · TODAY`;
}

function replaceBetween(html, startMarker, endMarker, content) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  if (start === -1 || end === -1) {
    throw new Error(`마커를 찾을 수 없습니다: ${startMarker}`);
  }
  return (
    html.slice(0, start + startMarker.length) +
    '\n' + content + '\n          ' +
    html.slice(end)
  );
}

const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// 노션의 임시 이미지 URL(1시간 정도면 만료됨)을 다운로드해서
// 저장소 안 images/ 폴더에 영구적으로 저장하고, 로컬 경로를 돌려줍니다.
async function downloadImage(url, pageId) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`상태 코드 ${res.status}`);
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const ext = EXT_BY_TYPE[contentType.split(';')[0]] || 'jpg';
    const fileName = `link-${pageId.replace(/-/g, '')}.${ext}`;
    const filePath = path.join(IMAGES_DIR, fileName);

    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

    return `images/${fileName}`;
  } catch (err) {
    console.log(`⚠️ 이미지 다운로드 실패 (${pageId}): ${err.message}`);
    return '';
  }
}

function buildLinkCard(item) {
  const label = item.category ? escapeHtml(item.category).toUpperCase() : 'LINK';
  const thumb = item.image
    ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" />`
    : label;
  return `        <a class="link-card" href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener">
          <div class="link-thumb">${thumb}</div>
          <div class="link-body">
            <h3>${escapeHtml(item.title)} <span class="link-arrow">↗</span></h3>
            <p>${escapeHtml(item.desc)}</p>
          </div>
        </a>`;
}

async function syncNotes(html) {
  const res = await notion.databases.query({
    database_id: NOTION_DB_ID,
    sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
  });

  const items = res.results.map((page) => ({
    text: getTitleText(page.properties) || '(제목 없음)',
    done: getCheckbox(page.properties),
  }));

  const listHtml = items
    .map(
      (item) =>
        `          <li><span class="chk${item.done ? ' done' : ''}"></span><span>${escapeHtml(
          item.text
        )}</span></li>`
    )
    .join('\n');

  html = replaceBetween(html, '<!-- NOTION:NOTES:START -->', '<!-- NOTION:NOTES:END -->', listHtml);
  html = replaceBetween(html, '<!-- NOTION:DATE:START -->', '<!-- NOTION:DATE:END -->', todayLabel());

  console.log(`✅ 수업 메모 ${items.length}개 항목 반영`);
  return html;
}

async function syncLinks(html) {
  if (!NOTION_LINKS_DB_ID) {
    console.log('ℹ️ NOTION_LINKS_DB_ID가 없어 패들렛/바이브코딩 섹션은 건너뜁니다.');
    return html;
  }

  const res = await notion.databases.query({
    database_id: NOTION_LINKS_DB_ID,
    sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
  });

  const items = [];
  for (const page of res.results) {
    const props = page.properties;
    const title = getTitleText(props) || '(제목 없음)';
    const desc = getRichTextList(props)[0] || '';
    const url = getUrl(props) || '#';
    const category = getSelectName(props);

    const imageFile = getFirstFile(props);
    const rawImageUrl = imageFile
      ? imageFile.type === 'external'
        ? imageFile.external?.url
        : imageFile.file?.url
      : '';

    let image = '';
    if (rawImageUrl) {
      image = await downloadImage(rawImageUrl, page.id);
    }

    items.push({ title, desc, url, category, image });
  }

  const padletItems = items.filter((i) => i.category === '패들렛');
  const vibeItems = items.filter((i) => i.category === '바이브코딩');

  html = replaceBetween(
    html,
    '<!-- NOTION:PADLET:START -->',
    '<!-- NOTION:PADLET:END -->',
    padletItems.map(buildLinkCard).join('\n')
  );

  html = replaceBetween(
    html,
    '<!-- NOTION:VIBECODING:START -->',
    '<!-- NOTION:VIBECODING:END -->',
    vibeItems.map(buildLinkCard).join('\n')
  );

  console.log(`✅ 패들렛 ${padletItems.length}개, 바이브코딩 ${vibeItems.length}개 카드 반영`);
  return html;
}

async function syncCurriculum(html) {
  if (!NOTION_CURR_DB_ID) {
    console.log('ℹ️ NOTION_CURR_DB_ID가 없어 커리큘럼 섹션은 건너뜁니다.');
    return html;
  }

  const res = await notion.databases.query({
    database_id: NOTION_CURR_DB_ID,
    sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
  });

  const rows = res.results.map((page) => {
    const week = getTitleText(page.properties);
    const weekStyle = buildInlineStyle({
      color: getTitleColor(page.properties),
      bold: getTitleBold(page.properties),
    });
    const [topic = '', desc = ''] = getRichTextList(page.properties);
    return { week, weekStyle, topic, desc };
  });

  const rowsHtml = rows
    .map(
      (r) =>
        `          <tr>
            <td class="curr-week"><span${r.weekStyle}>${escapeHtml(r.week)}</span></td>
            <td class="curr-topic">${escapeHtml(r.topic)}</td>
            <td class="curr-desc">${escapeHtml(r.desc)}</td>
          </tr>`
    )
    .join('\n');

  html = replaceBetween(
    html,
    '<!-- NOTION:CURRICULUM:START -->',
    '<!-- NOTION:CURRICULUM:END -->',
    rowsHtml
  );

  console.log(`✅ 커리큘럼 ${rows.length}개 행 반영`);
  return html;
}

async function main() {
  let html = fs.readFileSync(INDEX_PATH, 'utf-8');

  html = await syncNotes(html);
  html = await syncLinks(html);
  html = await syncCurriculum(html);

  fs.writeFileSync(INDEX_PATH, html, 'utf-8');
  console.log('✅ index.html 전체 갱신 완료');
}

main().catch((err) => {
  console.error('❌ 동기화 실패:', err.message);
  process.exit(1);
});
