// scripts/sync-notion.js
//
// 노션 데이터베이스 3개를 읽어서 index.html을 자동으로 갱신합니다.
//
// 1) "수업 메모" DB → <!-- NOTION:NOTES:START/END --> 구간
//    속성: 제목(title) / 완료(checkbox)
//
// 2) "링크모음" DB → 패들렛(<!-- NOTION:PADLET -->) / 바이브코딩(<!-- NOTION:VIBECODING -->) 구간
//    속성: 제목(title) / 설명(rich_text) / URL(url) / 카테고리(select: "패들렛" 또는 "바이브코딩")
//
// 3) "커리큘럼" DB → <!-- NOTION:CURRICULUM:START/END --> 구간
//    속성: 주차(title) / 주제(rich_text) / 내용(rich_text)
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
const PROP_TITLE = process.env.NOTION_PROP_TITLE || '이름';
const PROP_DONE = process.env.NOTION_PROP_DONE || '완료';
const LINK_PROP_TITLE = process.env.NOTION_LINK_PROP_TITLE || '이름';
const LINK_PROP_DESC = process.env.NOTION_LINK_PROP_DESC || '설명';
const LINK_PROP_URL = process.env.NOTION_LINK_PROP_URL || 'URL';
const LINK_PROP_CATEGORY = process.env.NOTION_LINK_PROP_CATEGORY || '카테고리';
const LINK_PROP_IMAGE = process.env.NOTION_LINK_PROP_IMAGE || '이미지';
const CURR_PROP_WEEK = process.env.NOTION_CURR_PROP_WEEK || '주차';
const CURR_PROP_TOPIC = process.env.NOTION_CURR_PROP_TOPIC || '주제';
const CURR_PROP_DESC = process.env.NOTION_CURR_PROP_DESC || '내용';
const INDEX_PATH = path.join(__dirname, '..', 'index.html');
const IMAGES_DIR = path.join(__dirname, '..', 'images');

if (!NOTION_TOKEN || !NOTION_DB_ID) {
  console.error('NOTION_TOKEN, NOTION_DB_ID 환경변수가 필요합니다.');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

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
    const p = page.properties;
    const title = p[LINK_PROP_TITLE]?.title?.map((t) => t.plain_text).join('') || '(제목 없음)';
    const desc = p[LINK_PROP_DESC]?.rich_text?.map((t) => t.plain_text).join('') || '';
    const url = p[LINK_PROP_URL]?.url || '#';
    const category = p[LINK_PROP_CATEGORY]?.select?.name || '';
    const imageFile = p[LINK_PROP_IMAGE]?.files?.[0];
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
    const p = page.properties;
    const week = p[CURR_PROP_WEEK]?.title?.map((t) => t.plain_text).join('') || '';
    const topic = p[CURR_PROP_TOPIC]?.rich_text?.map((t) => t.plain_text).join('') || '';
    const desc = p[CURR_PROP_DESC]?.rich_text?.map((t) => t.plain_text).join('') || '';
    return { week, topic, desc };
  });

  const rowsHtml = rows
    .map(
      (r) =>
        `          <tr>
            <td class="curr-week">${escapeHtml(r.week)}</td>
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
  const res = await notion.databases.query({
    database_id: NOTION_DB_ID,
    sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
  });

  const items = res.results.map((page) => {
    const titleProp = page.properties[PROP_TITLE];
    const doneProp = page.properties[PROP_DONE];

    const text =
      titleProp?.title?.map((t) => t.plain_text).join('') || '(제목 없음)';
    const done = !!doneProp?.checkbox;

    return { text, done };
  });

  const listHtml = items
    .map(
      (item) =>
        `          <li><span class="chk${item.done ? ' done' : ''}"></span><span>${escapeHtml(
          item.text
        )}</span></li>`
    )
    .join('\n');

  let html = fs.readFileSync(INDEX_PATH, 'utf-8');

  html = replaceBetween(
    html,
    '<!-- NOTION:NOTES:START -->',
    '<!-- NOTION:NOTES:END -->',
    listHtml
  );

  html = replaceBetween(
    html,
    '<!-- NOTION:DATE:START -->',
    '<!-- NOTION:DATE:END -->',
    todayLabel()
  );

  html = await syncLinks(html);
  html = await syncCurriculum(html);

  fs.writeFileSync(INDEX_PATH, html, 'utf-8');
  console.log(`✅ ${items.length}개 항목으로 index.html 갱신 완료`);
}

main().catch((err) => {
  console.error('❌ 동기화 실패:', err.message);
  process.exit(1);
});
