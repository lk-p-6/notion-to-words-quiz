import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = '2022-06-28';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === '/api/notion') {
    if (req.method === 'OPTIONS') {
      return sendOptions(res);
    }
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    return handleNotionRequest(req, res);
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  return serveStaticFile(requestUrl.pathname, res);
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

function sendOptions(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end();
}

async function handleNotionRequest(req, res) {
  if (!NOTION_TOKEN) {
    return sendJson(res, 500, {
      error: 'Не задан токен Notion. Укажи NOTION_TOKEN в переменных окружения.'
    });
  }

  try {
    const body = await readRequestBody(req);
    const { url } = JSON.parse(body || '{}');

    if (!url || typeof url !== 'string') {
      return sendJson(res, 400, { error: 'Укажи ссылку на страницу Notion.' });
    }

    const pageId = extractPageId(url);
    if (!pageId) {
      return sendJson(res, 400, { error: 'Не удалось извлечь идентификатор страницы Notion.' });
    }

    const page = await notionRequest(`/pages/${pageId}`);
    const title = extractPageTitle(page);
    const blocks = await fetchPageBlocks(pageId);
    const sections = await extractSections(blocks);
    const flashcards = parseFlashcards(sections.newWords);

    return sendJson(res, 200, {
      title,
      sections: {
        corrections: sections.corrections,
        sentences: sections.sentences,
        newWords: flashcards
      }
    });
  } catch (error) {
    console.error('Notion API error:', error);
    if (error instanceof SyntaxError) {
      return sendJson(res, 400, { error: 'Некорректный JSON.' });
    }
    return sendJson(res, 500, {
      error: error.message || 'Не удалось получить данные из Notion.'
    });
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function serveStaticFile(requestPath, res) {
  const safePath = requestPath === '/' ? '/index.html' : requestPath;
  const resolved = path.join(__dirname, safePath);
  const relative = path.relative(__dirname, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  try {
    const stat = await fs.promises.stat(resolved);
    if (stat.isDirectory()) {
      return serveStaticFile(path.join(requestPath, 'index.html'), res);
    }
    const ext = path.extname(resolved);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(resolved).pipe(res);
  } catch (error) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

async function notionRequest(endpoint, options = {}) {
  const response = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    const message = problem?.message || `Notion API error (${response.status})`;
    throw new Error(message);
  }

  return response.json();
}

async function fetchPageBlocks(pageId) {
  const blocks = await fetchBlockChildren(pageId);
  const hydrated = [];
  for (const block of blocks) {
    hydrated.push(await hydrateBlock(block));
  }
  return hydrated;
}

async function fetchBlockChildren(blockId, startCursor) {
  const results = [];
  let cursor = startCursor;

  while (true) {
    const query = cursor ? `?start_cursor=${cursor}` : '';
    const data = await notionRequest(`/blocks/${blockId}/children${query}`);
    if (Array.isArray(data.results)) {
      results.push(...data.results);
    }
    if (!data.has_more || !data.next_cursor) {
      break;
    }
    cursor = data.next_cursor;
  }

  return results;
}

async function hydrateBlock(block) {
  const copy = { ...block };
  if (block.has_children) {
    const children = await fetchBlockChildren(block.id);
    copy.children = [];
    for (const child of children) {
      copy.children.push(await hydrateBlock(child));
    }
  }
  return copy;
}

function extractPageId(url) {
  const clean = url.replace(/-/g, '');
  const match = clean.match(/[0-9a-f]{32}/i);
  if (!match) return null;
  const id = match[0];
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function extractPageTitle(page) {
  if (!page?.properties) return 'Lesson';
  for (const key of Object.keys(page.properties)) {
    const property = page.properties[key];
    if (property?.type === 'title' && Array.isArray(property.title)) {
      const plain = property.title.map((part) => part.plain_text || '').join('').trim();
      if (plain) {
        return plain;
      }
    }
  }
  return 'Lesson';
}

const SECTION_TITLES = {
  corrections: ['תיקונים – Исправления'],
  newWords: ['מילים חדשות – Новые слова'],
  sentences: ['משפטים – Предложения']
};

async function extractSections(blocks) {
  const sections = {
    corrections: [],
    newWords: [],
    sentences: []
  };
  let current = null;

  const normalizedTargets = new Map();
  Object.entries(SECTION_TITLES).forEach(([key, titles]) => {
    titles.forEach((title) => {
      normalizedTargets.set(normalizeHeading(title), key);
    });
  });

  for (const block of blocks) {
    if (isHeading(block)) {
      const headingText = getBlockText(block).join(' ').trim();
      const normalized = normalizeHeading(headingText);
      if (normalizedTargets.has(normalized)) {
        current = normalizedTargets.get(normalized);
      } else {
        current = null;
      }
      continue;
    }

    if (!current) {
      continue;
    }

    const lines = getBlockText(block);
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (!sections[current].includes(trimmed)) {
        sections[current].push(trimmed);
      }
    });
  }

  return sections;
}

function isHeading(block) {
  return block?.type === 'heading_1' || block?.type === 'heading_2' || block?.type === 'heading_3';
}

function getBlockText(block) {
  if (!block) return [];
  const type = block.type;
  const rich = block[type]?.rich_text;
  const texts = [];
  if (Array.isArray(rich) && rich.length) {
    const text = rich.map((part) => part.plain_text || '').join('');
    if (text.trim()) {
      texts.push(text);
    }
  }
  if (Array.isArray(block.children) && block.children.length) {
    block.children.forEach((child) => {
      getBlockText(child).forEach((childText) => {
        if (childText.trim()) {
          texts.push(childText);
        }
      });
    });
  }
  return texts;
}

function normalizeHeading(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[\u2013\u2014—–]/g, '-')
    .replace(/\s+/g, '')
    .trim();
}

function parseFlashcards(entries) {
  return entries
    .map((entry) => {
      const text = entry.replace(/\s+/g, ' ').trim();
      if (!text) return null;
      const match = text.match(/^(.*?)[\s]*[\-–—]{1}[\s]*(.+)$/);
      if (!match) {
        return {
          learning: text,
          native: text,
          original: entry
        };
      }
      const learning = match[1].trim();
      const native = match[2].trim();
      return {
        learning: learning || native,
        native: native || learning,
        original: entry
      };
    })
    .filter(Boolean);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(payload));
}
