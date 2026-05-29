const SLACK_API = "https://slack.com/api";

const CLIENT_CANVAS = {
  mackinac: "F0B6MK210SZ",
  lifeinternational: "F0B5J9QH1S9",
  everraise: "F0B3LSQKV5F",
};

const VALID_TYPES = new Set(["feature", "fix", "improvement", "integration"]);
const VALID_PRIORITIES = new Set(["urgent", "high", "medium", "low"]);

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  },
  body: JSON.stringify(body),
});

async function slackPost(method, token, payload) {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function fetchCanvasMarkdown(canvasId, token) {
  const infoUrl = new URL(`${SLACK_API}/files.info`);
  infoUrl.searchParams.set("file", canvasId);

  const infoRes = await fetch(infoUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const info = await infoRes.json();

  if (!info.ok) {
    throw new Error(info.error || "files.info failed");
  }

  const downloadUrl =
    info.file?.url_private_download || info.file?.url_private;
  if (!downloadUrl) {
    throw new Error("Canvas download URL not available");
  }

  const contentRes = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!contentRes.ok) {
    throw new Error(`Canvas download failed (${contentRes.status})`);
  }

  const raw = await contentRes.text();
  return normalizeCanvasContent(raw);
}

async function verifyCanvasAccess(canvasId, token) {
  const lookup = await slackPost("canvases.sections.lookup", token, {
    canvas_id: canvasId,
    criteria: { section_types: ["any_header"], contains_text: "Next" },
  });
  if (!lookup.ok && lookup.error !== "section_not_found") {
    throw new Error(lookup.error || "canvases.sections.lookup failed");
  }
}

function normalizeCanvasContent(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("<")) {
    return htmlToMarkdownish(trimmed);
  }
  return trimmed;
}

function htmlToMarkdownish(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<h2[^>]*>/gi, "\n## ")
    .replace(/<h3[^>]*>/gi, "\n### ")
    .replace(/<h1[^>]*>/gi, "\n# ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseItemLine(line) {
  let type = "feature";
  let priority = "medium";
  let text = line.trim();

  for (const t of VALID_TYPES) {
    const re = new RegExp(`\\[${t}\\]`, "i");
    if (re.test(text)) {
      type = t;
      text = text.replace(re, "").trim();
    }
  }

  for (const p of VALID_PRIORITIES) {
    const re = new RegExp(`\\(${p}\\)`, "i");
    if (re.test(text)) {
      priority = p;
      text = text.replace(re, "").trim();
    }
  }

  const dashMatch = text.match(/^(.+?)\s*[—–-]\s+(.+)$/);
  if (dashMatch) {
    return {
      title: dashMatch[1].trim(),
      desc: dashMatch[2].trim(),
      type,
      priority,
    };
  }

  return { title: text, desc: "", type, priority };
}

function parseRoadmapSections(markdown) {
  const sections = { next: [], later: [] };
  let current = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) continue;

    const header = trimmed.match(/^#{1,3}\s+(Next|Later)\b/i);
    if (header) {
      current = header[1].toLowerCase();
      continue;
    }

    if (!current) continue;

    if (/^#{1,3}\s+/.test(trimmed)) {
      current = null;
      continue;
    }

    const bullet = trimmed.match(/^[-*•]\s+(.+)/);
    if (bullet) {
      sections[current].push(parseItemLine(bullet[1]));
      continue;
    }

    const last = sections[current][sections[current].length - 1];
    if (last && !last.desc) {
      last.desc = trimmed.replace(/^\s+/, "");
    } else if (last && last.desc) {
      last.desc = `${last.desc} ${trimmed}`;
    }
  }

  return {
    next: sections.next.filter((i) => i.title),
    later: sections.later.filter((i) => i.title),
  };
}

const handler = async (event) => {
  const client = event.queryStringParameters?.client;

  if (!client || !CLIENT_CANVAS[client]) {
    return jsonResponse(400, { error: "Invalid or missing client param" });
  }

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return jsonResponse(500, { error: "SLACK_BOT_TOKEN not configured" });
  }

  const canvasId = CLIENT_CANVAS[client];

  try {
    try {
      await verifyCanvasAccess(canvasId, token);
    } catch {
      // Lookup is best-effort; files.info download is the content source.
    }
    const markdown = await fetchCanvasMarkdown(canvasId, token);
    const roadmap = parseRoadmapSections(markdown);

    if (!roadmap.next.length && !roadmap.later.length) {
      return jsonResponse(404, {
        error: "No Next or Later sections found in canvas",
      });
    }

    return jsonResponse(200, {
      next: roadmap.next,
      later: roadmap.later,
      lastSynced: new Date().toISOString(),
    });
  } catch (err) {
    return jsonResponse(500, {
      error: "Slack roadmap fetch failed",
      details: err.message,
    });
  }
};

module.exports = { handler };
