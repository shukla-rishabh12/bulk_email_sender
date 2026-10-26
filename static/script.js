/* =====================================================================
   BULK EMAIL SENDER — frontend
   Views: welcome → credentials → app
   Credentials kept ONLY in browser storage (session/local).
   ===================================================================== */

const $ = (id) => document.getElementById(id);

const STORAGE_KEYS = {
  email:    "bes_sender_email",
  password: "bes_sender_password",
};

/* =====================================================================
   CREDENTIALS STORAGE
   ===================================================================== */

function saveCredentials(email, password, remember) {
  clearCredentials();
  const storage = remember ? localStorage : sessionStorage;
  const target  = remember ? "localStorage" : "sessionStorage";
  try {
    storage.setItem(STORAGE_KEYS.email, email);
    storage.setItem(STORAGE_KEYS.password, password);

    // verify write actually happened (some browsers silently fail)
    const checkEmail = storage.getItem(STORAGE_KEYS.email);
    const checkPwd   = storage.getItem(STORAGE_KEYS.password);
    if (checkEmail !== email || checkPwd !== password) {
      console.error(`[creds] ${target} write failed silently. Storage might be blocked.`);
      return false;
    }
    console.log(`[creds] saved to ${target} for ${email}`);
    return true;
  } catch (e) {
    console.error(`[creds] ${target} write threw:`, e);
    return false;
  }
}

function loadCredentials() {
  let email = null, password = null, source = null;

  try {
    email    = localStorage.getItem(STORAGE_KEYS.email);
    password = localStorage.getItem(STORAGE_KEYS.password);
    if (email && password) source = "localStorage";
  } catch (e) { console.warn("[creds] localStorage read error:", e); }

  if (!email || !password) {
    try {
      email    = sessionStorage.getItem(STORAGE_KEYS.email);
      password = sessionStorage.getItem(STORAGE_KEYS.password);
      if (email && password) source = "sessionStorage";
    } catch (e) { console.warn("[creds] sessionStorage read error:", e); }
  }

  if (email && password) {
    console.log(`[creds] loaded from ${source} (origin: ${window.location.origin})`);
    return { email, password, source };
  }
  console.log(`[creds] no saved credentials (origin: ${window.location.origin})`);
  return null;
}

function clearCredentials() {
  try {
    localStorage.removeItem(STORAGE_KEYS.email);
    localStorage.removeItem(STORAGE_KEYS.password);
    sessionStorage.removeItem(STORAGE_KEYS.email);
    sessionStorage.removeItem(STORAGE_KEYS.password);
  } catch (e) {
    console.warn("[creds] clear error:", e);
  }
}

/* =====================================================================
   VIEW MANAGEMENT
   ===================================================================== */

function prefillCredentialsForm() {
  const creds = loadCredentials();
  if (!creds) return;
  const emailInp = $("cred-email");
  const pwdInp   = $("cred-password");
  const remember = $("remember-device");
  if (emailInp && !emailInp.value) emailInp.value = creds.email;
  if (pwdInp   && !pwdInp.value)   pwdInp.value   = creds.password;
  if (remember) remember.checked = creds.source === "localStorage";
}

function showView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  const el = document.getElementById(name + "-view");
  if (el) el.classList.remove("hidden");
  if (name === "credentials") prefillCredentialsForm();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function switchAccount() {
  clearCredentials();
  $("cred-email").value = "";
  $("cred-password").value = "";
  $("remember-device").checked = false;
  $("cred-error").classList.add("hidden");
  showView("credentials");
}

function initApp() {
  console.log(`[boot] origin: ${window.location.origin}`);
  const creds = loadCredentials();
  if (creds) {
    $("logged-in-email").textContent = creds.email;
    showView("app");
    console.log(`[boot] auto-logged-in as ${creds.email} (from ${creds.source})`);
  } else {
    showView("welcome");
    console.log("[boot] no saved credentials → welcome view");
  }
  fetch("/defaults")
    .then(r => r.json())
    .then(d => {
      if (!$("subject").value) $("subject").value = d.subject || "";
      if (!$("body").value)    $("body").value    = d.body    || "";
    })
    .catch(() => {});
}

/* =====================================================================
   WELCOME VIEW — provider tabs
   ===================================================================== */

document.querySelectorAll(".provider-tabs .tab").forEach(tab => {
  tab.addEventListener("click", () => {
    const provider = tab.dataset.provider;
    document.querySelectorAll(".provider-tabs .tab").forEach(t =>
      t.classList.toggle("active", t === tab)
    );
    ["gmail", "outlook", "yahoo"].forEach(p => {
      const el = $("steps-" + p);
      if (el) el.classList.toggle("hidden", p !== provider);
    });
  });
});

/* =====================================================================
   CREDENTIALS VIEW
   ===================================================================== */

const credForm  = $("credentials-form");
const togglePwd = $("toggle-password");

togglePwd.addEventListener("click", () => {
  const inp = $("cred-password");
  inp.type = inp.type === "password" ? "text" : "password";
  togglePwd.textContent = inp.type === "password" ? "👁" : "🙈";
});

credForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email    = $("cred-email").value.trim();
  const password = $("cred-password").value.trim();
  const remember = $("remember-device").checked;

  const submitBtn  = $("cred-submit");
  const submitText = $("cred-submit-text");
  const errBox     = $("cred-error");

  submitBtn.disabled = true;
  submitText.textContent = "Testing connection…";
  errBox.classList.add("hidden");

  try {
    const fd = new FormData();
    fd.append("sender_email", email);
    fd.append("sender_password", password);

    const res  = await fetch("/verify-smtp", { method: "POST", body: fd });
    const data = await res.json();

    if (!data.ok) throw new Error(data.error || "Connection failed");

    const saved = saveCredentials(email, password, remember);
    if (!saved && remember) {
      console.warn("[creds] 'remember' couldn't persist. Browser blocked storage. Falling back to session.");
      saveCredentials(email, password, false);
      errBox.textContent = "⚠️ Browser ne 'remember' block kiya — sirf is tab ke liye save hua. Incognito ya cookies block ho sakta hai.";
      errBox.classList.remove("hidden");
    }

    $("logged-in-email").textContent = email;
    submitText.textContent = "Connected ✓";
    setTimeout(() => {
      showView("app");
      submitText.textContent = "Test connection & continue";
    }, 350);
  } catch (err) {
    errBox.textContent = "❌ " + err.message;
    errBox.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
    if (!errBox.classList.contains("hidden") && submitText.textContent === "Testing connection…") {
      submitText.textContent = "Test connection & continue";
    }
  }
});

/* =====================================================================
   APP VIEW — element refs
   ===================================================================== */

const form          = $("form");
const fileInput     = $("file");
const filename      = $("filename");
const dropzoneCsv   = $("dropzone-csv");
const attachInput   = $("attachments");
const attachName    = $("attachments-name");
const dropzoneFiles = $("dropzone-files");
const subjectInput  = $("subject");
const bodyInput     = $("body");
const submitBtn     = $("submit");
const wrap          = $("progress-wrap");
const progressPct   = $("progress-percent");
const reportWrap    = $("report-wrap");
const reportSummary = $("report-summary");
const reportBody    = $("report-body");
const reportTableWrap = $("report-table-wrap");
const reportAttach  = $("report-attach");
const downloadBtn   = $("download-report");

const previewWrap   = $("preview-wrap");
const csvStats      = $("csv-stats");
const columnsLabel  = $("columns-label");
const columnsChips  = $("columns-chips");
const columnStats   = $("column-stats");
const filesInfo     = $("files-info");
const attachPreview = $("attach-preview");
const attachSummary = $("attach-summary");
const mappingList   = $("mapping-list");
const attachWarnings= $("attach-warnings");

let lastReport    = null;
let startTime     = null;
let jobStartedAt  = null;
let jobCompletedAt= null;
let previewTimer  = null;

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* =====================================================================
   PREVIEW
   ===================================================================== */

async function runPreview() {
  if (!fileInput.files[0]) { previewWrap.classList.add("hidden"); return; }
  const fd = new FormData();
  fd.append("file", fileInput.files[0]);
  Array.from(attachInput.files).forEach(f => fd.append("attachments", f));

  try {
    const res  = await fetch("/preview", { method: "POST", body: fd });
    const data = await res.json();
    previewWrap.classList.remove("hidden");

    if (!res.ok) {
      columnsLabel.className = "chip-label chip-error";
      columnsLabel.textContent = "⚠️ " + (data.error || "CSV parse error");
      columnsChips.innerHTML = "";
      csvStats.innerHTML = "";
      columnStats.classList.add("hidden");
      filesInfo.classList.add("hidden");
      attachPreview.classList.add("hidden");
      return;
    }

    csvStats.innerHTML = `
      <div class="panel-title">📄 CSV summary</div>
      <div class="stat-grid">
        <div class="stat-row"><span>File</span><b>${escapeHtml(fileInput.files[0].name)}</b></div>
        <div class="stat-row"><span>Size</span><b>${data.csv_size_human}</b></div>
        <div class="stat-row"><span>Total data rows</span><b>${data.total_data_rows}</b></div>
        <div class="stat-row"><span>Valid rows</span><b>${data.row_count}</b></div>
        <div class="stat-row"><span>Invalid rows</span><b class="${data.invalid_rows ? 'warn' : ''}">${data.invalid_rows}</b></div>
        <div class="stat-row"><span>Empty rows</span><b>${data.empty_rows}</b></div>
        <div class="stat-row"><span>Unique emails</span><b>${data.unique_emails}</b></div>
        <div class="stat-row"><span>Duplicates in CSV</span><b class="${data.duplicates_in_csv ? 'warn' : ''}">${data.duplicates_in_csv}</b></div>
        <div class="stat-row"><span>Columns</span><b>${data.columns.length}</b></div>
      </div>
    `;

    columnsLabel.className = "chip-label";
    columnsLabel.textContent = `Click a column to insert its placeholder:`;
    columnsChips.innerHTML = "";
    data.columns.forEach(c => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = `[${c}]`;
      chip.title = `Insert [${c}] into subject or body`;
      chip.addEventListener("click", () => {
        const target = document.activeElement === bodyInput ? bodyInput : subjectInput;
        const start = target.selectionStart ?? target.value.length;
        const end   = target.selectionEnd   ?? target.value.length;
        target.value = target.value.slice(0, start) + `[${c}]` + target.value.slice(end);
        target.focus();
        target.setSelectionRange(start + c.length + 2, start + c.length + 2);
      });
      columnsChips.appendChild(chip);
    });

    if (data.column_stats?.length) {
      columnStats.classList.remove("hidden");
      let html = `<div class="panel-title">📊 Column details <span class="panel-hint">Scroll inside values to see all</span></div>`;
      html += `<table class="stats-table"><thead><tr>
        <th>Column</th><th>Filled / Total</th><th>All values</th>
      </tr></thead><tbody>`;
      data.column_stats.forEach(c => {
        const isAttach = c.name.toLowerCase() === "attachment";
        let valsHtml;
        if (c.values.length === 0) {
          valsHtml = `<i class="m-none">(no values)</i>`;
        } else {
          const chips = c.values.map(v => {
            const truncated = v.length > 60 ? v.slice(0, 57) + "…" : v;
            const title = v.length > 60 ? ` title="${escapeHtml(v)}"` : "";
            return `<code${title}>${escapeHtml(truncated)}</code>`;
          }).join(" ");
          valsHtml = `<div class="values-box">${chips}</div>`;
        }
        html += `<tr class="${isAttach ? 'row-attach' : ''}">
          <td><code>${escapeHtml(c.name)}</code>${isAttach ? '<span class="tag">files</span>' : ''}<span class="uniq-count">${c.unique_count} unique</span></td>
          <td class="center-cell">${c.filled}/${c.total}${c.empty ? `<span class="empty-count">${c.empty} empty</span>` : ''}</td>
          <td>${valsHtml}</td>
        </tr>`;
      });
      html += `</tbody></table>`;
      columnStats.innerHTML = html;
    } else {
      columnStats.classList.add("hidden");
    }

    if (data.files_info?.length) {
      filesInfo.classList.remove("hidden");
      let html = `<div class="panel-title">📎 Uploaded files <span class="panel-hint">${data.files_info.length} file(s) · ${data.total_files_size_human}</span></div><div class="files-list">`;
      data.files_info.forEach(f => {
        html += `<div class="file-item"><span class="fname">${escapeHtml(f.filename)}</span><span class="fsize">${f.size_human}</span></div>`;
      });
      html += `</div>`;
      filesInfo.innerHTML = html;
    } else {
      filesInfo.classList.add("hidden");
    }

    if (data.uploaded_files_count === 0 && !data.has_attachment_col) {
      attachPreview.classList.add("hidden");
      return;
    }
    attachPreview.classList.remove("hidden");
    attachSummary.innerHTML = data.has_attachment_col
      ? `Mapping from <code>attachment</code> column (first 5 emails):`
      : `No <code>attachment</code> column found → all files go with every email.`;

    mappingList.innerHTML = "";
    data.sample.forEach(row => {
      const line = document.createElement("div");
      line.className = "mapping-line";
      const emailSpan = document.createElement("span");
      emailSpan.className = "m-email";
      emailSpan.textContent = row.email;
      const arrow = document.createElement("span");
      arrow.className = "m-arrow";
      arrow.textContent = "→";
      const filesSpan = document.createElement("span");
      filesSpan.className = "m-files";
      if (!row.resolved.length && !row.missing.length) {
        filesSpan.textContent = "(no attachment)";
        filesSpan.classList.add("m-none");
      } else {
        row.resolved.forEach(f => {
          const s = document.createElement("span");
          s.className = "m-file ok";
          s.textContent = "✓ " + f;
          filesSpan.appendChild(s);
        });
        row.missing.forEach(f => {
          const s = document.createElement("span");
          s.className = "m-file miss";
          s.textContent = "✕ " + f + " (missing)";
          filesSpan.appendChild(s);
        });
      }
      line.append(emailSpan, arrow, filesSpan);
      mappingList.appendChild(line);
    });

    attachWarnings.innerHTML = "";
    if (data.missing_files.length) {
      const d = document.createElement("div");
      d.className = "warn-line";
      d.textContent = `⚠️ ${data.missing_files.length} file(s) referenced but not uploaded: ${data.missing_files.join(", ")} — emails will still send.`;
      attachWarnings.appendChild(d);
    }
    if (data.unused_files.length) {
      const d = document.createElement("div");
      d.className = "info-line";
      d.textContent = `ℹ️ ${data.unused_files.length} uploaded file(s) unused: ${data.unused_files.join(", ")}`;
      attachWarnings.appendChild(d);
    }
  } catch (e) {
    columnsLabel.className = "chip-label chip-error";
    columnsLabel.textContent = "⚠️ Preview failed";
    console.error(e);
  }
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(runPreview, 200);
}

fileInput.addEventListener("change", () => {
  const f = fileInput.files[0];
  filename.textContent = f ? f.name : "Choose CSV file";
  dropzoneCsv.classList.toggle("has-file", !!f);
  schedulePreview();
});

attachInput.addEventListener("change", () => {
  const files = attachInput.files;
  attachName.textContent = files.length ? `${files.length} file(s)` : "Attach files";
  dropzoneFiles.classList.toggle("has-file", files.length > 0);
  schedulePreview();
});

/* =====================================================================
   REPORT (inline summary)
   ===================================================================== */

function renderReport(data) {
  reportBody.innerHTML = "";
  const dupCount  = data.duplicates_removed || 0;
  const dupEmails = data.duplicates_detail  || [];

  reportWrap.classList.remove("hidden");

  if (dupCount === 0) {
    reportSummary.textContent =
      `✅ No duplicate emails. ${data.valid_count || data.total} valid entries → ` +
      `${data.total} unique emails to send.`;
    reportTableWrap.classList.add("hidden");
  } else {
    reportSummary.innerHTML =
      `⚠️ <b>${dupCount}</b> duplicate occurrence(s) removed ` +
      `(<b>${dupEmails.length}</b> unique email(s) repeated).<br>` +
      `CSV had <b>${data.valid_count}</b> valid entries → <b>${data.total}</b> unique emails to send.<br>` +
      `<small style="color:var(--text-muted)">Duplicate rows' attachments were merged; per-row data uses the first occurrence.</small>`;
    reportTableWrap.classList.remove("hidden");
    dupEmails.forEach(d => {
      const tr = document.createElement("tr");
      const td1 = document.createElement("td");
      const td2 = document.createElement("td");
      td1.textContent = d.email;
      td2.textContent = d.count;
      td2.className = "count-cell";
      tr.append(td1, td2);
      reportBody.appendChild(tr);
    });
  }

  const mf = data.missing_files || [];
  const uf = data.unused_files || [];
  reportAttach.innerHTML = "";
  if (mf.length) {
    const d = document.createElement("div");
    d.className = "warn-line";
    d.textContent = `⚠️ Missing files (skipped): ${mf.join(", ")}`;
    reportAttach.appendChild(d);
  }
  if (uf.length) {
    const d = document.createElement("div");
    d.className = "info-line";
    d.textContent = `ℹ️ Unused uploaded files: ${uf.join(", ")}`;
    reportAttach.appendChild(d);
  }
  if (mf.length || uf.length) reportAttach.classList.remove("hidden");
  else reportAttach.classList.add("hidden");
}

/* =====================================================================
   SUBMIT + POLLING
   ===================================================================== */

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const creds = loadCredentials();
  if (!creds) {
    alert("Credentials missing. Please re-enter them.");
    switchAccount();
    return;
  }

  submitBtn.disabled = true;
  wrap.classList.remove("hidden");
  reportWrap.classList.add("hidden");
  startTime = Date.now();
  jobStartedAt = new Date();
  jobCompletedAt = null;

  const fd = new FormData();
  fd.append("file", fileInput.files[0]);
  fd.append("subject", subjectInput.value.trim());
  fd.append("body", bodyInput.value);
  fd.append("sender_email", creds.email);
  fd.append("sender_password", creds.password);
  Array.from(attachInput.files).forEach(f => fd.append("attachments", f));

  const res = await fetch("/upload", { method: "POST", body: fd });
  const data = await res.json();

  if (!res.ok) {
    $("status-msg").textContent = "❌ " + data.error;
    submitBtn.disabled = false;
    if (res.status === 401) switchAccount();
    return;
  }

  lastReport = data;
  renderReport(data);

  $("total").textContent   = data.total;
  $("workers").textContent = data.workers || "–";

  const poll = setInterval(async () => {
    const s = await fetch(`/status/${data.job_id}`).then(r => r.json());
    const done = s.sent + s.failed;

    $("sent").textContent   = s.sent;
    $("failed").textContent = s.failed;
    $("bar").style.width    = (done / s.total * 100) + "%";
    progressPct.textContent = Math.round((done / s.total) * 100) + "%";

    const elapsed = (Date.now() - startTime) / 1000;
    const rate    = elapsed > 0 ? done / elapsed : 0;
    $("speed").textContent = rate.toFixed(1);

    const remaining = s.total - done;
    if (rate > 0 && remaining > 0) {
      $("eta").textContent = Math.ceil(remaining / rate) + "s";
    } else if (remaining === 0) {
      $("eta").textContent = "0s";
    } else {
      $("eta").textContent = "–";
    }

    if (s.status === "done") {
      clearInterval(poll);
      jobCompletedAt = new Date();
      progressPct.textContent = "100%";
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      const dupMsg = data.duplicates_removed > 0 ? ` (${data.duplicates_removed} dupes skipped)` : "";
      const missMsg = data.missing_files?.length ? ` ⚠️ ${data.missing_files.length} file(s) skipped` : "";
      $("status-msg").textContent = `✅ Done in ${totalTime}s${dupMsg}${missMsg}.`;
      lastReport.final_sent = s.sent;
      lastReport.final_failed = s.failed;
      lastReport.duration_sec = parseFloat(totalTime);
      lastReport.failed_emails = s.failed_emails || [];
      lastReport.last_error = s.last_error || null;
      renderReport(lastReport);
      submitBtn.disabled = false;
    } else if (s.status === "error") {
      clearInterval(poll);
      jobCompletedAt = new Date();
      $("status-msg").textContent = "❌ " + (s.error || s.last_error || "SMTP error");
      submitBtn.disabled = false;
    }
  }, 500);
});

/* =====================================================================
   REPORT DOWNLOAD
   ===================================================================== */

downloadBtn.addEventListener("click", () => {
  if (!lastReport) return;
  const R = lastReport;
  const now = new Date();
  const sep  = "=".repeat(70);
  const sep2 = "-".repeat(70);
  const L = [];
  const pad = (s, n) => String(s ?? "").padEnd(n);
  const kv  = (k, v) => L.push(`  ${pad(k, 32)}: ${v ?? "-"}`);
  const senderEmail = loadCredentials()?.email || "-";

  L.push(sep); L.push("  BULK EMAIL SENDER — DETAILED REPORT"); L.push(sep); L.push("");

  L.push("1) SESSION OVERVIEW"); L.push(sep2);
  kv("Report generated at", now.toLocaleString());
  kv("Sender account", senderEmail);
  kv("Job started at", jobStartedAt ? jobStartedAt.toLocaleString() : "-");
  kv("Job completed at", jobCompletedAt ? jobCompletedAt.toLocaleString() : "-");
  kv("Total duration", R.duration_sec != null ? R.duration_sec + " seconds" : "-");
  kv("Job ID", R.job_id);
  L.push("");

  L.push("2) SEND RESULT SUMMARY"); L.push(sep2);
  kv("Emails targeted (unique)", R.total);
  kv("Emails sent successfully", R.final_sent ?? "-");
  kv("Emails failed", R.final_failed ?? "-");
  const successRate = (R.final_sent != null && R.total)
    ? ((R.final_sent / R.total) * 100).toFixed(2) + " %" : "-";
  kv("Success rate", successRate);
  if (R.final_failed > 0 && R.last_error) kv("Last failure reason", R.last_error);
  L.push("");

  L.push("3) CSV SOURCE FILE"); L.push(sep2);
  kv("File size", R.csv_size_human || "-");
  kv("Total data rows in CSV", R.total_data_rows ?? "-");
  kv("Valid email rows", R.valid_count ?? "-");
  kv("Invalid / skipped rows", R.invalid_rows ?? 0);
  kv("Empty rows", R.empty_rows ?? 0);
  kv("Unique emails found", R.total);
  kv("Duplicate occurrences removed", R.duplicates_removed || 0);
  L.push("");

  L.push("4) CSV COLUMNS DETECTED"); L.push(sep2);
  kv("Total columns", (R.columns || []).length);
  L.push("");
  (R.column_stats || []).forEach((c, i) => {
    L.push(`  Column #${i + 1}: "${c.name}"`);
    L.push(`    Filled       : ${c.filled} / ${c.total}${c.empty ? `  (${c.empty} empty)` : ""}`);
    L.push(`    Unique values: ${c.unique_count}`);
    if (c.values.length) {
      const vals = c.values.slice(0, 50).join(", ");
      const more = c.values.length > 50 ? ` … (+${c.values.length - 50} more)` : "";
      L.push(`    Values       : ${vals}${more}`);
    } else L.push(`    Values       : (none)`);
    if (c.name.toLowerCase() === "attachment") L.push(`    Role         : per-email attachment column`);
    L.push("");
  });

  L.push("5) DUPLICATE EMAILS"); L.push(sep2);
  if ((R.duplicates_detail || []).length === 0) {
    L.push("  No duplicates found in CSV.");
  } else {
    kv("Unique emails with duplicates", R.duplicates_detail.length);
    kv("Total duplicate occurrences removed", R.duplicates_removed);
    kv("Note", "Duplicate rows' attachments merged; per-row data uses first occurrence.");
    L.push("");
    L.push(`  ${pad("Email", 45)}Occurrences`); L.push("  " + "-".repeat(60));
    R.duplicates_detail.forEach(d => L.push(`  ${pad(d.email, 45)}${d.count}`));
  }
  L.push("");

  L.push("6) ATTACHMENTS"); L.push(sep2);
  kv("Attachment column used", R.has_attachment_col ? "'attachment' (per-email mapping)" : "none (global mode)");
  kv("Uploaded files count", R.uploaded_files_count || 0);
  kv("Total uploaded size", R.total_files_size_human || "0 B");
  kv("Emails with at least one file", R.emails_with_files ?? "-");
  L.push("");
  if ((R.files_info || []).length) {
    L.push(`  Uploaded files (${R.files_info.length}):`); L.push("  " + "-".repeat(60));
    R.files_info.forEach(f => L.push(`    - ${pad(f.filename, 45)}${f.size_human}`));
    L.push("");
  }
  if ((R.missing_files || []).length) {
    L.push(`  ⚠ Files referenced in CSV but NOT uploaded (${R.missing_files.length}):`); L.push("  " + "-".repeat(60));
    R.missing_files.forEach(f => L.push(`    - ${f}`));
    L.push("    (Emails were still sent — those files were skipped.)"); L.push("");
  }
  if ((R.unused_files || []).length) {
    L.push(`  ℹ Uploaded files NOT referenced in CSV (${R.unused_files.length}):`); L.push("  " + "-".repeat(60));
    R.unused_files.forEach(f => L.push(`    - ${f}`)); L.push("");
  }

  L.push("7) EMAIL TEMPLATE"); L.push(sep2);
  L.push("  Subject:"); L.push("  " + "-".repeat(60));
  (R.subject || "").split("\n").forEach(l => L.push(`    ${l}`));
  L.push("");
  L.push("  Body:"); L.push("  " + "-".repeat(60));
  (R.body || "").split("\n").forEach(l => L.push(`    ${l}`));
  L.push("");
  L.push("  Placeholders like [name], [company], [email] are replaced per recipient");
  L.push("  using values from the matching CSV row."); L.push("");

  if ((R.failed_emails || []).length) {
    L.push("8) FAILED EMAILS (details)"); L.push(sep2);
    R.failed_emails.forEach((f, i) => {
      if (typeof f === "string") L.push(`  ${i + 1}. ${f}`);
      else { L.push(`  ${i + 1}. ${f.email}`); L.push(`     Reason: ${f.error}`); }
    });
    L.push("");
  }

  L.push("9) PRIVACY & DATA HANDLING"); L.push(sep2);
  L.push("  • Sender credentials live only in the user's browser storage (never server)");
  L.push("  • Emails + per-row data deleted from SQLite immediately after each send");
  L.push("  • Attachment bytes stay only in RAM (never written to disk)");
  L.push("  • The queue database is auto-wiped on every server restart");
  L.push("  • Nothing from this session is permanently stored");
  L.push("");
  L.push(sep); L.push("  END OF REPORT"); L.push(sep);

  const blob = new Blob([L.join("\n")], { type: "text/plain;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `email-report-${now.toISOString().slice(0,19).replace(/[:T]/g, "-")}.txt`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

/* =====================================================================
   BOOT
   ===================================================================== */
initApp();