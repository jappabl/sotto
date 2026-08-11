// Pre-meeting briefs. Two sources, clearly separated:
//
//   YOURS  — what you have already said, decided, and promised with these
//            people, pulled from the local knowledge layer. Always available,
//            never leaves the Mac, and the part no cloud tool can match.
//   PUBLIC — optional, explicitly opt-in: a fetch of the counterpart company's
//            own website. Off by default, because any outbound request reveals
//            who you are meeting.
//
// The local model stitches them into a short brief. Briefs are cached per
// event so opening one twice is instant.

const https = require('https');
const fs = require('fs');
const path = require('path');

const BRIEF_SYSTEM = `You write a short pre-meeting brief from the notes given.
- Lead with what matters in the next hour: open commitments, unresolved decisions, anything promised.
- Use only what the sources say. Never invent history, names, or numbers.
- Under "## Where you left off": what was agreed or discussed before, with when it happened. Omit the section if the notes have nothing.
- Under "## Open threads": commitments and unanswered questions, one per line.
- If a company section is provided, add at most three lines under "## Them" about what the company does or recently shipped.
- Terse. No preamble, no filler, no em dashes. Output only the brief.`;

const GENERIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'icloud.com', 'me.com', 'outlook.com', 'hotmail.com',
  'live.com', 'yahoo.com', 'proton.me', 'protonmail.com', 'aol.com', 'msn.com',
  'fastmail.com', 'hey.com', 'duck.com',
]);

class Briefer {
  constructor({ knowledge, polisher, calendar, baseDir, getSettings, log = () => {} }) {
    this.knowledge = knowledge;
    this.polisher = polisher;
    this.calendar = calendar;
    this.getSettings = getSettings;
    this.log = log;
    this.cachePath = baseDir ? path.join(baseDir, 'briefs.json') : null;
    this.cache = {};
    try {
      if (this.cachePath) this.cache = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
    } catch { /* none yet */ }
  }

  _saveCache() {
    if (!this.cachePath) return;
    // Keep the cache small: briefs older than two days are useless.
    const cutoff = Date.now() - 2 * 86400000;
    for (const [k, v] of Object.entries(this.cache)) {
      if (!v || (v.builtAt || 0) < cutoff) delete this.cache[k];
    }
    try { fs.writeFileSync(this.cachePath, JSON.stringify(this.cache)); } catch { /* fine */ }
  }

  // --- local recon: your own history with these people and this topic ---
  localRecon(event) {
    if (!this.knowledge) return [];
    const seen = new Set();
    const hits = [];
    const queries = [];
    const title = String(event.title || '').trim();
    if (title) queries.push(title);
    for (const a of event.attendees || []) {
      const name = String(a.name || '').trim();
      if (name) queries.push(name);
      const local = String(a.email || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
      if (local && local.length > 2 && !queries.includes(local)) queries.push(local);
    }
    for (const q of queries.slice(0, 6)) {
      for (const h of this.knowledge.search(q, { limit: 3 })) {
        if (seen.has(h.id) || h.score < 0.6) continue;
        seen.add(h.id);
        hits.push({ ...h, matched: q });
      }
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, 8);
  }

  // --- optional public recon: the counterpart company's own site ---
  companyDomains(event) {
    const domains = new Set();
    for (const a of event.attendees || []) {
      const d = String(a.email || '').split('@')[1];
      if (!d) continue;
      const dom = d.toLowerCase().trim();
      if (GENERIC_DOMAINS.has(dom) || dom.endsWith('.local')) continue;
      domains.add(dom);
    }
    return [...domains].slice(0, 2);
  }

  async fetchCompany(domain) {
    const html = await httpsGetText(`https://${domain}`, 8000).catch(() => null);
    if (!html) return null;
    const title = (html.match(/<title[^>]*>([^<]{2,120})<\/title>/i) || [])[1] || '';
    const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,400})["']/i)
      || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{10,400})["']/i)
      || [])[1] || '';
    const body = stripHtml(html).slice(0, 1200);
    if (!title && !desc && body.length < 60) return null;
    return { domain, title: decodeEntities(title.trim()), description: decodeEntities(desc.trim()), body };
  }

  async build(event, { force = false } = {}) {
    const key = event.id || `${event.title}-${event.startMs}`;
    if (!force && this.cache[key]) return this.cache[key];

    const local = this.localRecon(event);
    const settings = this.getSettings ? this.getSettings() : {};
    let company = null;
    if (settings.webRecon) {
      for (const d of this.companyDomains(event)) {
        company = await this.fetchCompany(d);
        if (company) break;
      }
    }

    const brief = {
      eventId: key,
      title: event.title,
      startMs: event.startMs,
      attendees: (event.attendees || []).map((a) => a.name || a.email).filter(Boolean),
      sources: local.map((h) => ({ id: h.id, title: h.title, source: h.source, refId: h.refId, ts: h.ts })),
      company: company ? { domain: company.domain, title: company.title } : null,
      text: '',
      builtAt: Date.now(),
    };

    if (!local.length && !company) {
      brief.text = '';
      brief.empty = true;
      this.cache[key] = brief;
      this._saveCache();
      return brief;
    }

    if (this.polisher && this.polisher.available()) {
      const parts = [];
      parts.push(`Meeting: ${event.title}`);
      if (brief.attendees.length) parts.push(`With: ${brief.attendees.join(', ')}`);
      if (event.notes) parts.push(`Invite notes: ${String(event.notes).slice(0, 400)}`);
      if (local.length) {
        parts.push('## Your past notes');
        parts.push(local.map((h, i) =>
          `[${i + 1}] ${h.title} (${new Date(h.ts).toLocaleDateString()})\n${String(h.text).slice(0, 420)}`).join('\n\n'));
      }
      if (company) {
        parts.push(`## Company (${company.domain})`);
        parts.push([company.title, company.description, company.body.slice(0, 600)].filter(Boolean).join('\n'));
      }
      try {
        if (await this.polisher.ensureServer().catch(() => false)) {
          const out = await this.polisher._chat(
            [{ role: 'system', content: BRIEF_SYSTEM }, { role: 'user', content: parts.join('\n\n') }],
            { maxTokens: 700, timeoutMs: 90000 },
          );
          brief.text = tidyBrief(String(out || ''));
        }
      } catch (err) {
        this.log('brief generation failed: ' + err.message);
      }
    }

    // Without a model (or if it failed) the brief is still useful: the raw
    // matches beat nothing at all.
    if (!brief.text && local.length) {
      brief.text = '## Where you left off\n' + local.slice(0, 4)
        .map((h) => `- ${h.title} (${new Date(h.ts).toLocaleDateString()}): ${String(h.snippet || h.text).slice(0, 160)}`)
        .join('\n');
    }
    brief.empty = !brief.text;
    this.cache[key] = brief;
    this._saveCache();
    return brief;
  }
}

// Small models like to restate the meeting header the prompt told them to
// skip. Drop those echo lines and any lead-in before the first section.
function tidyBrief(text) {
  const lines = String(text).replace(/—/g, '-').split('\n');
  while (lines.length) {
    const l = lines[0].trim();
    if (!l || /^(meeting|with|attendees|date|time)\s*:/i.test(l)
        || /^(here('s| is)|based on|this brief)/i.test(l)) {
      lines.shift();
    } else break;
  }
  return lines.join('\n').trim();
}

// --- tiny http helpers (no dependencies) ---

function httpsGetText(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: timeoutMs,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) Sotto/1.0', Accept: 'text/html' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && /^https:/.test(res.headers.location)) {
        res.resume();
        return httpsGetText(res.headers.location, timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200 || !/text\/html/i.test(res.headers['content-type'] || '')) {
        res.resume();
        return reject(new Error('bad response'));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        data += c;
        if (data.length > 400000) { req.destroy(); resolve(data); }
      });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&mdash;/g, '-');
}

module.exports = { Briefer, stripHtml, decodeEntities, tidyBrief, GENERIC_DOMAINS };
