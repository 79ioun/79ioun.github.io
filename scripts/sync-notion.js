// scripts/sync-notion.js
//
// 노션 데이터베이스 2개를 읽어서 index.html을 자동으로 갱신합니다.
//
// 1) "수업 메모" DB → <!-- NOTION:NOTES:START/END --> 구간
//    속성: 제목(title) / 완료(checkbox)
//
// 2) "링크모음" DB → 패들렛(<!-- NOTION:PADLET -->) / 바이브코딩(<!-- NOTION:VIBECODING -->) 구간
//    속성: 제목(title) / 설명(rich_text) / URL(url) / 카테고리(select: "패들렛" 또는 "바이브코딩")
//    → 카테고리 값에 따라 두 섹션 중 어디에 카드가 들어갈지 자동으로 나뉩니다.
//    → 이 DB에 행을 추가하면 카드가 늘어나고, 삭제하면 카드도 사라집니다.
//
// 필요한 환경변수:
//   NOTION_TOKEN     (2단계에서 발급받은 토큰)
//   NOTION_DB_ID      (수업 메모 DB ID)
//   NOTION_LINKS_DB_ID (링크모음 DB ID)
//
// 실행: NOTION_TOKEN=... NOTION_DB_ID=... NOTION_LINKS_DB_ID=... node scripts/sync-notion.js

const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
const NOTION_LINKS_DB_ID = process.env.NOTION_LINKS_DB_ID;
const PROP_TITLE = process.env.NOTION_PROP_TITLE || '이름';
const PROP_DONE = process.env.NOTION_PROP_DONE || '완료';
const LINK_PROP_TITLE = process.env.NOTION_LINK_PROP_TITLE || '제목';
const LINK_PROP_DESC = process.env.NOTION_LINK_PROP_DESC || '설명';
const LINK_PROP_URL = process.env.NOTION_LINK_PROP_URL || 'URL';
const LINK_PROP_CATEGORY = process.env.NOTION_LINK_PROP_CATEGORY || '카테고리';
const INDEX_PATH = path.join(__dirname, '..', 'index.html');

if (!NOTION_TOKEN || !NOTION_DB_ID) {
  console.error('NOTION_TOKEN, NOTION_DB_ID 환경변수가 필요합니다.');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

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
  return `        <a class="link-card" href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener">
          <div class="link-thumb">${label}</div>
          <div class="link-body">
            <h3>${escapeHtml(item.title)} <span class="link-arrow">↗</span></h3>
            <p>${escapeHtml(item.desc)}</p>
          </div>
