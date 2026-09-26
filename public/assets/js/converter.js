(function () {
  const $ = (id) => document.getElementById(id);
  let uploadedFile = null; // { name, type, dataUrl, html }
  let pdfUrl = null;

  function toast(msg, type = 'info') {
    const box = $('toast');
    if (!box) return;
    box.textContent = msg;
    box.className = `toast toast-${type} show`;
    clearTimeout(box._t);
    box._t = setTimeout(() => box.classList.remove('show'), 3200);
  }

  function setLoading(loading) {
    $('convert-btn').disabled = loading;
    $('convert-label').textContent = loading ? 'Converting…' : 'Convert to PDF';
    $('convert-spinner').style.display = loading ? 'inline-block' : 'none';
  }

  // ---- File handling ----
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  function setFileChip(name) {
    const chip = $('file-chip');
    if (!name) {
      chip.classList.remove('show');
      $('file-chip-name').textContent = '';
      return;
    }
    chip.classList.add('show');
    $('file-chip-name').textContent = name;
  }

  async function handleFile(file) {
    if (!file) return;
    const maxMB = 5;
    if (file.size > maxMB * 1024 * 1024) {
      toast(`File too large (max ${maxMB} MB)`, 'warn');
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await fetch('/api/prepare-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          type: file.type,
          dataUrl,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to prepare file');

      uploadedFile = { name: file.name, type: file.type, dataUrl, html: data.html };
      setFileChip(file.name);

      // Auto-fill filename field if empty
      const fnInput = $('filename');
      if (!fnInput.value.trim()) {
        fnInput.value = file.name.replace(/\.[^.]+$/, '');
      }

      // Switch mode indicator
      $('mode-badge').textContent = 'File upload';
      toast(`Loaded "${file.name}"`, 'ok');
    } catch (err) {
      console.error(err);
      toast('Upload failed: ' + err.message, 'warn');
    }
  }

  function clearFile() {
    uploadedFile = null;
    setFileChip(null);
    $('file-input').value = '';
    $('mode-badge').textContent = 'URL / HTML';
  }

  // ---- Convert ----
  async function convert() {
    const urlOrHtml = $('source').value.trim();
    const filename = $('filename').value.trim();

    let source;
    if (uploadedFile) {
      source = uploadedFile.html;
    } else if (urlOrHtml) {
      source = urlOrHtml;
    } else {
      toast('Please upload a file or enter a URL/HTML.', 'warn');
      return;
    }

    const payload = {
      source,
      filename,
      format: $('format').value,
      margin: $('margin').value,
      landscape: $('landscape').checked,
      use_print: $('use_print').checked,
    };

    setLoading(true);
    const t0 = performance.now();

    try {
      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const ct = res.headers.get('content-type') || '';
      if (!res.ok || !ct.includes('application/pdf')) {
        let details = '';
        try { details = (await res.json()).details || ''; } catch {}
        throw new Error(`Server returned ${res.status}. ${details}`.trim());
      }

      const blob = await res.blob();
      const elapsed = Math.round(performance.now() - t0);
      const url = URL.createObjectURL(blob);

      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      pdfUrl = url;

      // Preview
      $('pdf-frame').src = url;
      $('preview-wrap').classList.add('has-pdf');
      $('empty-state').style.display = 'none';

      // Download link with custom filename
      const safeName = (filename || 'document')
        .replace(/\.pdf$/i, '')
        .replace(/[^a-zA-Z0-9-_ ]/g, '')
        .replace(/\s+/g, '-') || 'document';
      const dl = $('download-link');
      dl.href = url;
      dl.download = `${safeName}.pdf`;
      dl.style.display = 'inline-flex';

      // Stats
      const kb = (blob.size / 1024).toFixed(1);
      $('stat-size').textContent = `${kb} KB`;
      $('stat-time').textContent = `${elapsed}ms`;
      const credits = res.headers.get('x-credits-consumed');
      $('stat-credits').textContent = credits || '—';

      toast(`PDF generated · ${safeName}.pdf · ${kb} KB`, 'ok');
    } catch (err) {
      console.error(err);
      toast('Conversion failed: ' + err.message, 'warn');
    } finally {
      setLoading(false);
    }
  }

  // ---- Init ----
  document.addEventListener('DOMContentLoaded', () => {
    // Convert button
    $('convert-btn').addEventListener('click', convert);

    // Presets
    document.querySelectorAll('[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        clearFile();
        $('source').value = btn.dataset.preset;
        $('source').focus();
        $('mode-badge').textContent = 'URL / HTML';
      });
    });

    // File input
    const fileInput = $('file-input');
    const dropzone = $('dropzone');

    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
      if (e.target.files[0]) handleFile(e.target.files[0]);
    });

    // Drag & drop
    ['dragenter', 'dragover'].forEach(evt =>
      dropzone.addEventListener(evt, e => {
        e.preventDefault();
        dropzone.classList.add('drag');
      })
    );
    ['dragleave', 'drop'].forEach(evt =>
      dropzone.addEventListener(evt, e => {
        e.preventDefault();
        dropzone.classList.remove('drag');
      })
    );
    dropzone.addEventListener('drop', e => {
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    });

    // Clear file
    $('file-clear').addEventListener('click', e => {
      e.stopPropagation();
      clearFile();
    });

    // Source textarea clears file when typing
    $('source').addEventListener('input', () => {
      if (uploadedFile) {
        clearFile();
      }
    });
  });
})();