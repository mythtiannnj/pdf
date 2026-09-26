const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Load config ----
const CONFIG_PATH = path.join(__dirname, 'config.json');
let CONFIG = {};
try {
  CONFIG = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  console.log('✓ Loaded config.json');
} catch (e) {
  console.error('✗ config.json error:', e.message);
  process.exit(1);
}

// Allow large JSON bodies (for base64 file payloads)
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Page routes ----
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/converter', (req, res) => res.sendFile(path.join(__dirname, 'public', 'converter.html')));

// ---- Public config (safe fields only) ----
app.get('/api/config', (req, res) => {
  res.json({
    site: CONFIG.site,
    upload: CONFIG.upload,
    pdfshift: {
      sandbox: CONFIG.pdfshift.sandbox,
      defaultOptions: CONFIG.pdfshift.defaultOptions,
    },
  });
});

// ---- File upload → HTML wrapper ----
// Accepts JSON: { name, type, dataUrl }  (dataUrl is base64 data URL)
// Returns: { success, html }
app.post('/api/prepare-file', (req, res) => {
  const { name = '', type = '', dataUrl = '' } = req.body || {};
  if (!dataUrl) return res.status(400).json({ success: false, error: 'Missing dataUrl' });

  const ext = (name.split('.').pop() || '').toLowerCase();
  const allowed = CONFIG.upload?.allowedExtensions || [];
  if (allowed.length && !allowed.includes(ext)) {
    return res.status(400).json({
      success: false,
      error: `Unsupported file type ".${ext}". Allowed: ${allowed.join(', ')}`,
    });
  }

  // Estimate size from base64
  const b64 = dataUrl.split(',')[1] || '';
  const sizeBytes = Math.floor(b64.length * 3 / 4);
  const maxBytes = (CONFIG.upload?.maxFileSizeMB || 5) * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    return res.status(413).json({
      success: false,
      error: `File too large (${(sizeBytes / 1024 / 1024).toFixed(1)} MB). Max: ${CONFIG.upload.maxFileSizeMB} MB.`,
    });
  }

  try {
    let html;

    if (['html', 'htm'].includes(ext)) {
      // Decode raw HTML
      const raw = Buffer.from(b64, 'base64').toString('utf-8');
      html = wrapHtml(raw, name);

    } else if (['txt', 'md', 'markdown'].includes(ext)) {
      // Convert plain text/markdown to simple HTML
      const raw = Buffer.from(b64, 'base64').toString('utf-8');
      html = wrapHtml(`<pre class="text-body">${escapeHtml(raw)}</pre>`, name, { mono: true });

    } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      // Embed image in a full-page HTML wrapper
      html = wrapHtml(`
        <div class="image-page">
          <img src="${dataUrl}" alt="${escapeHtml(name)}" />
        </div>`, name, { imageMode: true });

    } else {
      return res.status(400).json({ success: false, error: 'Unsupported type' });
    }

    res.json({ success: true, html });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---- PDF conversion ----
app.post('/api/convert', async (req, res) => {
  const { source, format, margin, landscape, use_print, filename } = req.body || {};

  if (!source || typeof source !== 'string' || !source.trim()) {
    return res.status(400).json({ success: false, error: 'Missing "source".' });
  }

  const payload = {
    source: source.trim(),
    format: format || CONFIG.pdfshift.defaultOptions.format,
    margin: margin || CONFIG.pdfshift.defaultOptions.margin,
    landscape: !!landscape,
    use_print: !!use_print,
    sandbox: CONFIG.pdfshift.sandbox,
  };

  // Sanitize filename
  const safeName = sanitizeFilename(filename) || 'document';

  try {
    const response = await fetch(CONFIG.pdfshift.endpoint, {
      method: 'POST',
      headers: {
        'X-API-Key': CONFIG.pdfshift.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const contentType = response.headers.get('content-type') || '';

    if (!response.ok) {
      let errBody = '';
      try { errBody = await response.text(); } catch {}
      console.error('PDFShift error:', response.status, errBody);
      return res.status(response.status).json({
        success: false,
        error: `PDFShift responded with ${response.status}`,
        details: errBody,
      });
    }

    if (contentType.includes('application/pdf')) {
      const buffer = Buffer.from(await response.arrayBuffer());
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${safeName}.pdf"`);

      ['x-ratelimit-remaining', 'x-ratelimit-limit', 'x-ratelimit-reset', 'x-credits-consumed']
        .forEach(h => {
          const v = response.headers.get(h);
          if (v) res.setHeader(h, v);
        });

      return res.send(buffer);
    }

    const text = await response.text();
    res.setHeader('Content-Type', 'application/json');
    res.send(text);

  } catch (err) {
    console.error('Conversion failed:', err);
    res.status(500).json({ success: false, error: 'Conversion failed', details: err.message });
  }
});

// ---- Helpers ----
function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .trim()
    .replace(/\.pdf$/i, '')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Wrap raw content in a full styled HTML document
function wrapHtml(content, title, opts = {}) {
  const { mono = false, imageMode = false } = opts;

  const bodyStyles = imageMode
    ? 'margin:0;padding:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff;'
    : 'margin:0;padding:0;';

  const articleStyles = imageMode
    ? 'display:flex;align-items:center;justify-content:center;width:100%;min-height:100vh;'
    : 'max-width:720px;margin:0 auto;padding:48px 40px;font-family:Georgia,\'Times New Roman\',serif;color:#1a1a1a;line-height:1.7;font-size:15px;';

  const imgStyles = 'max-width:100%;max-height:100vh;object-fit:contain;display:block;';
  const monoStyles = mono
    ? 'white-space:pre-wrap;font-family:\'Courier New\',monospace;font-size:12px;line-height:1.6;'
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title || 'Document')}</title>
<style>
  * { box-sizing: border-box; }
  body { ${bodyStyles} }
  article { ${articleStyles} }
  h1, h2, h3 { color: #0b0f19; }
  .text-body { ${monoStyles} }
  .image-page img { ${imgStyles} }
  .doc-title {
    font-family: Georgia, serif;
    font-size: 26px;
    font-weight: 600;
    color: #0b0f19;
    margin: 0 0 8px;
    letter-spacing: -0.01em;
  }
  .doc-meta {
    font-family: 'Courier New', monospace;
    font-size: 11px;
    color: #64748b;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-bottom: 32px;
    padding-bottom: 20px;
    border-bottom: 1px solid #e2e8f0;
  }
</style>
</head>
<body>
${imageMode ? content : `
  <article>
    <h1 class="doc-title">${escapeHtml(title || 'Document')}</h1>
    <div class="doc-meta">Converted by PDF Converter</div>
    ${content}
  </article>
`}
</body>
</html>`;
}

// ---- Error pages ----
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).sendFile(path.join(__dirname, 'public', '500.html'));
});

app.listen(PORT, () => console.log(`📄 PDF Converter server at http://localhost:${PORT}`));