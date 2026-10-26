import os, re, csv, io, json, uuid, time, sqlite3, smtplib, threading, logging, mimetypes
from collections import Counter
from queue import Queue, Empty
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = int(os.getenv("MAX_REQUEST_MB", "100")) * 1024 * 1024

DB_PATH     = "queue.db"
SMTP_HOST   = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT   = int(os.getenv("SMTP_PORT", "587"))
DEF_SUBJECT = os.getenv("MAIL_SUBJECT", "Hello")
DEF_BODY    = os.getenv("MAIL_BODY", "Test message")
DELAY       = float(os.getenv("SEND_DELAY", "0.2"))
WORKERS     = int(os.getenv("WORKERS", "8"))
DEBUG_SMTP  = os.getenv("SMTP_DEBUG", "0") == "1"

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ATTACH_COLUMN_NAME = "attachment"

jobs = {}
jobs_lock = threading.Lock()


def human_size(n):
    n = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30)
    conn.execute("PRAGMA busy_timeout = 30000")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL,
            email  TEXT NOT NULL,
            data   TEXT,
            files  TEXT
        )
    """)
    conn.commit()
    return conn


if os.path.exists(DB_PATH):
    try:
        os.remove(DB_PATH)
        for ext in ("-wal", "-shm"):
            if os.path.exists(DB_PATH + ext):
                os.remove(DB_PATH + ext)
    except Exception:
        pass
db().close()


# ---------------- Credentials helper ----------------
def extract_credentials(req):
    """Read sender_email + sender_password from form. Returns (creds_dict, error_msg)."""
    email = (req.form.get("sender_email") or "").strip().lower()
    password = (req.form.get("sender_password") or "").strip().replace(" ", "")
    if not email or not EMAIL_RE.match(email):
        return None, "Invalid sender email address"
    if not password:
        return None, "Missing App Password"
    return {"email": email, "password": password}, None


# ---------------- CSV parsing ----------------
def parse_csv(raw):
    rows = list(csv.reader(io.StringIO(raw)))
    if not rows:
        return None

    first_norm = [c.strip().lower() for c in rows[0]]
    has_header = ('email' in first_norm) or (not any('@' in c for c in rows[0]))

    if has_header:
        headers   = first_norm
        data_rows = rows[1:]
    else:
        headers   = ['email']
        data_rows = rows

    if 'email' not in headers:
        return None

    email_idx = headers.index('email')
    attach_idx = headers.index(ATTACH_COLUMN_NAME) if ATTACH_COLUMN_NAME in headers else None

    all_valid   = []
    email_data  = {}
    email_files = {}
    invalid_rows = 0
    empty_rows = 0

    for row in data_rows:
        if not any(c.strip() for c in row):
            empty_rows += 1
            continue
        if len(row) <= email_idx:
            invalid_rows += 1
            continue
        email = row[email_idx].strip().lower()
        if not EMAIL_RE.match(email):
            invalid_rows += 1
            continue
        all_valid.append(email)

        files = []
        if attach_idx is not None and len(row) > attach_idx:
            cell = row[attach_idx].strip()
            if cell:
                for p in re.split(r'[|;]', cell):
                    p = p.strip()
                    if p and p not in files:
                        files.append(p)

        if email not in email_data:
            record = {}
            for i, h in enumerate(headers):
                record[h] = row[i].strip() if i < len(row) else ''
            record['email'] = email
            email_data[email]  = record
            email_files[email] = list(files)
        else:
            for f in files:
                if f not in email_files[email]:
                    email_files[email].append(f)

    return {
        "headers": headers,
        "all_valid": all_valid,
        "email_data": email_data,
        "email_files": email_files,
        "has_attachment_col": attach_idx is not None,
        "invalid_rows": invalid_rows,
        "empty_rows": empty_rows,
        "total_data_rows": len(data_rows),
    }


def build_column_stats(headers, email_data):
    total = len(email_data)
    out = []
    for h in headers:
        filled = 0
        unique_vals = []
        seen = set()
        for rec in email_data.values():
            v = (rec.get(h) or '').strip()
            if v:
                filled += 1
                if v not in seen:
                    unique_vals.append(v)
                    seen.add(v)
        out.append({
            "name": h,
            "filled": filled,
            "empty": total - filled,
            "total": total,
            "unique_count": len(unique_vals),
            "values": unique_vals,
        })
    return out


def build_files_map(files):
    m = {}
    for af in files:
        if af and af.filename:
            data = af.read()
            mt = af.mimetype or mimetypes.guess_type(af.filename)[0] or "application/octet-stream"
            key = af.filename.lower()
            if key not in m:
                m[key] = {
                    "filename": af.filename,
                    "content": data,
                    "mimetype": mt,
                    "size": len(data),
                }
    return m


def files_info_list(files_map):
    return [
        {"filename": v["filename"], "size": v["size"], "size_human": human_size(v["size"])}
        for v in files_map.values()
    ]


# ---------------- SMTP ----------------
def open_smtp(sender_email, sender_password):
    """Open authenticated SMTP with user-provided credentials. Not stored anywhere."""
    if not sender_email or not sender_password:
        raise RuntimeError("Missing sender credentials")

    if SMTP_PORT == 465:
        server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=30)
    else:
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30)
        server.ehlo()
        server.starttls()
        server.ehlo()
    if DEBUG_SMTP:
        server.set_debuglevel(1)
    server.login(sender_email, sender_password)
    return server


def personalize(text, to_addr, record):
    result = text
    for k, v in record.items():
        v = str(v) if v is not None else ''
        result = result.replace(f"[{k}]", v)
        result = result.replace(f"[{k.upper()}]", v)
        result = result.replace(f"[{k.title()}]", v)
        result = result.replace(f"{{{{{k}}}}}", v)
        result = result.replace(f"{{{{{k.upper()}}}}}", v)
    result = result.replace("{{email}}", to_addr)
    return result


def build_msg(to_addr, sender_email, record, subject, body, attachments):
    msg = MIMEMultipart()
    msg["From"]    = sender_email
    msg["To"]      = to_addr
    msg["Subject"] = personalize(subject, to_addr, record)
    msg.attach(MIMEText(personalize(body, to_addr, record), "plain", "utf-8"))
    for att in attachments:
        mt = att["mimetype"] or "application/octet-stream"
        maintype, _, subtype = mt.partition("/")
        part = MIMEBase(maintype, subtype or "octet-stream")
        part.set_payload(att["content"])
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", "attachment", filename=att["filename"])
        msg.attach(part)
    return msg


# ---------------- worker ----------------
def worker(job_id, email_q, subject, body, files_map, sender_email, sender_password):
    try:
        server = open_smtp(sender_email, sender_password)
    except Exception as e:
        log.exception("worker SMTP connect failed")
        conn = db()
        while True:
            try:
                email, _, _ = email_q.get_nowait()
            except Empty:
                break
            with jobs_lock:
                jobs[job_id]["failed"] += 1
                jobs[job_id]["last_error"] = f"{type(e).__name__}: {e}"
                jobs[job_id].setdefault("failed_emails", []).append(
                    {"email": email, "error": f"{type(e).__name__}: {e}"}
                )
            conn.execute("DELETE FROM queue WHERE job_id=? AND email=?", (job_id, email))
            conn.commit()
            email_q.task_done()
        conn.close()
        return

    conn = db()

    while True:
        try:
            email, record, fnames = email_q.get_nowait()
        except Empty:
            break

        attachments = []
        for fname in fnames:
            info = files_map.get(fname.lower())
            if info:
                attachments.append(info)
            else:
                log.warning(f"skip missing attachment '{fname}' for {email}")

        ok, err = False, None
        try:
            server.send_message(
                build_msg(email, sender_email, record, subject, body, attachments)
            )
            ok = True
        except smtplib.SMTPServerDisconnected:
            log.warning("SMTP disconnected, reconnecting...")
            try:
                server = open_smtp(sender_email, sender_password)
                server.send_message(
                    build_msg(email, sender_email, record, subject, body, attachments)
                )
                ok = True
            except Exception as e2:
                err = f"{type(e2).__name__}: {e2}"
        except Exception as e:
            err = f"{type(e).__name__}: {e}"

        with jobs_lock:
            if ok:
                jobs[job_id]["sent"] += 1
            else:
                jobs[job_id]["failed"] += 1
                jobs[job_id]["last_error"] = err
                jobs[job_id].setdefault("failed_emails", []).append(
                    {"email": email, "error": err}
                )

        try:
            conn.execute("DELETE FROM queue WHERE job_id=? AND email=?", (job_id, email))
            conn.commit()
        except Exception as e:
            log.warning(f"db delete failed: {e}")

        email_q.task_done()
        if DELAY > 0:
            time.sleep(DELAY)

    try: server.quit()
    except Exception: pass
    conn.close()


def process_queue(job_id, subject, body, files_map, sender_email, sender_password):
    conn = db()
    rows = conn.execute(
        "SELECT email, data, files FROM queue WHERE job_id=? ORDER BY id", (job_id,)
    ).fetchall()
    conn.close()

    if not rows:
        with jobs_lock:
            jobs[job_id]["status"] = "done"
            jobs[job_id]["completed_at"] = time.time()
        return

    email_q = Queue()
    for email, data_json, files_json in rows:
        record = json.loads(data_json) if data_json else {"email": email}
        fnames = json.loads(files_json) if files_json else []
        email_q.put((email, record, fnames))

    n_workers = min(WORKERS, len(rows))
    log.info(f"job {job_id}: {len(rows)} emails, {n_workers} workers")

    threads = [
        threading.Thread(
            target=worker,
            args=(job_id, email_q, subject, body, files_map, sender_email, sender_password),
            daemon=True,
        )
        for _ in range(n_workers)
    ]
    for t in threads: t.start()
    for t in threads: t.join()

    with jobs_lock:
        jobs[job_id]["status"] = "done"
        jobs[job_id]["completed_at"] = time.time()
    log.info(f"job {job_id} done: sent={jobs[job_id]['sent']} failed={jobs[job_id]['failed']}")


# ---------------- routes ----------------
@app.errorhandler(413)
def too_large(e):
    return jsonify({"error": "File(s) too large. Reduce size or raise MAX_REQUEST_MB."}), 413


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/defaults")
def defaults():
    return jsonify({"subject": DEF_SUBJECT, "body": DEF_BODY, "workers": WORKERS})


@app.route("/verify-smtp", methods=["POST"])
def verify_smtp():
    """Test SMTP login with user-provided credentials. Used on credentials page."""
    creds, err = extract_credentials(request)
    if err:
        return jsonify({"ok": False, "error": err}), 200
    try:
        server = open_smtp(creds["email"], creds["password"])
        try: server.quit()
        except Exception: pass
        return jsonify({"ok": True})
    except smtplib.SMTPAuthenticationError:
        return jsonify({
            "ok": False,
            "error": "Authentication failed. The App Password is incorrect (or 2FA not enabled on the account)."
        }), 200
    except smtplib.SMTPConnectError:
        return jsonify({
            "ok": False,
            "error": f"Could not connect to {SMTP_HOST}:{SMTP_PORT}. Check network/firewall."
        }), 200
    except Exception as e:
        return jsonify({"ok": False, "error": f"{type(e).__name__}: {e}"}), 200


@app.route("/preview", methods=["POST"])
def preview():
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "no CSV file"}), 400

    raw_bytes = f.read()
    raw = raw_bytes.decode("utf-8", errors="ignore")
    parsed = parse_csv(raw)
    if not parsed:
        return jsonify({"error": "CSV must have an 'email' column (header row)"}), 400

    files_map = build_files_map(request.files.getlist("attachments"))
    has_att = parsed["has_attachment_col"]

    sample = []
    all_referenced = set()
    all_missing = set()
    missing_per_email_count = 0

    for email in parsed["email_data"].keys():
        wanted = parsed["email_files"].get(email, []) if has_att else list(files_map.keys())
        resolved, missing = [], []
        for fname in wanted:
            key = fname.lower()
            if key in files_map:
                resolved.append(files_map[key]["filename"])
                all_referenced.add(key)
            else:
                missing.append(fname)
                all_missing.add(fname)
        if missing:
            missing_per_email_count += 1
        if len(sample) < 5:
            sample.append({"email": email, "resolved": resolved, "missing": missing})

    unused_keys = sorted(set(files_map.keys()) - all_referenced) if has_att else []
    unused = [files_map[k]["filename"] for k in unused_keys]

    files_info = files_info_list(files_map)
    total_files_size = sum(x["size"] for x in files_info)

    return jsonify({
        "columns": parsed["headers"],
        "column_stats": build_column_stats(parsed["headers"], parsed["email_data"]),
        "row_count": len(parsed["all_valid"]),
        "total_data_rows": parsed["total_data_rows"],
        "invalid_rows": parsed["invalid_rows"],
        "empty_rows": parsed["empty_rows"],
        "unique_emails": len(parsed["email_data"]),
        "duplicates_in_csv": len(parsed["all_valid"]) - len(parsed["email_data"]),
        "csv_size": len(raw_bytes),
        "csv_size_human": human_size(len(raw_bytes)),
        "has_attachment_col": has_att,
        "attachment_column": ATTACH_COLUMN_NAME,
        "uploaded_files_count": len(files_map),
        "files_info": files_info,
        "total_files_size": total_files_size,
        "total_files_size_human": human_size(total_files_size),
        "sample": sample,
        "missing_files": sorted(all_missing),
        "missing_emails_count": missing_per_email_count,
        "unused_files": unused,
    })


@app.route("/upload", methods=["POST"])
def upload():
    creds, err = extract_credentials(request)
    if err:
        return jsonify({"error": err}), 401

    f = request.files.get("file")
    if not f or not f.filename.lower().endswith(".csv"):
        return jsonify({"error": "Please upload a .csv file"}), 400

    subject = (request.form.get("subject") or "").strip() or DEF_SUBJECT
    body    = (request.form.get("body") or "").strip() or DEF_BODY

    raw_bytes = f.read()
    raw = raw_bytes.decode("utf-8", errors="ignore")
    parsed = parse_csv(raw)
    if not parsed:
        return jsonify({"error": "CSV must have an 'email' column (header row)"}), 400

    headers     = parsed["headers"]
    all_valid   = parsed["all_valid"]
    email_data  = parsed["email_data"]
    email_files = parsed["email_files"]
    has_att     = parsed["has_attachment_col"]

    counter = Counter(all_valid)
    found = set(counter.keys())
    valid_count = len(all_valid)
    duplicates_detail = sorted(
        [{"email": e, "count": c} for e, c in counter.items() if c > 1],
        key=lambda x: (-x["count"], x["email"]),
    )
    duplicates_removed = sum(c - 1 for c in counter.values() if c > 1)

    if not found:
        return jsonify({"error": "No valid emails found in CSV"}), 400

    files_map = build_files_map(request.files.getlist("attachments"))

    resolved_per_email = {}
    all_referenced = set()
    all_missing = set()
    emails_with_files = 0
    for email in found:
        wanted = email_files.get(email, []) if has_att else list(files_map.keys())
        resolved = []
        for fname in wanted:
            key = fname.lower()
            if key in files_map:
                resolved.append(fname)
                all_referenced.add(key)
            else:
                all_missing.add(fname)
        resolved_per_email[email] = resolved
        if resolved:
            emails_with_files += 1

    unused_keys = sorted(set(files_map.keys()) - all_referenced)
    unused_files = [files_map[k]["filename"] for k in unused_keys]

    files_info = files_info_list(files_map)
    total_files_size = sum(x["size"] for x in files_info)

    log.info(
        f"CSV: {valid_count} entries, {len(found)} unique, {duplicates_removed} dupes | "
        f"sender={creds['email']} | files uploaded={len(files_map)} "
        f"referenced={len(all_referenced)} missing={len(all_missing)} unused={len(unused_files)}"
    )

    job_id = str(uuid.uuid4())
    conn = db()
    conn.executemany(
        "INSERT INTO queue (job_id, email, data, files) VALUES (?, ?, ?, ?)",
        [(job_id, e, json.dumps(email_data[e]), json.dumps(resolved_per_email[e])) for e in found],
    )
    conn.commit()
    conn.close()

    with jobs_lock:
        jobs[job_id] = {
            "total": len(found), "sent": 0, "failed": 0,
            "status": "running", "error": None, "last_error": None,
            "duplicates_removed": duplicates_removed,
            "duplicates_detail": duplicates_detail,
            "workers": min(WORKERS, len(found)),
            "columns": headers,
            "has_attachment_col": has_att,
            "missing_files": sorted(all_missing),
            "unused_files": unused_files,
            "uploaded_files_count": len(files_map),
            "files_info": files_info,
            "total_files_size_human": human_size(total_files_size),
            "csv_size_human": human_size(len(raw_bytes)),
            "started_at": time.time(),
            "completed_at": None,
            "subject": subject,
            "body": body,
            "emails_with_files": emails_with_files,
        }

    threading.Thread(
        target=process_queue,
        args=(job_id, subject, body, files_map, creds["email"], creds["password"]),
        daemon=True,
    ).start()

    return jsonify({
        "job_id": job_id,
        "total": len(found),
        "valid_count": valid_count,
        "total_data_rows": parsed["total_data_rows"],
        "invalid_rows": parsed["invalid_rows"],
        "empty_rows": parsed["empty_rows"],
        "duplicates_removed": duplicates_removed,
        "duplicates_detail": duplicates_detail,
        "workers": min(WORKERS, len(found)),
        "columns": headers,
        "column_stats": build_column_stats(headers, email_data),
        "has_attachment_col": has_att,
        "missing_files": sorted(all_missing),
        "unused_files": unused_files,
        "uploaded_files_count": len(files_map),
        "files_info": files_info,
        "total_files_size_human": human_size(total_files_size),
        "csv_size_human": human_size(len(raw_bytes)),
        "subject": subject,
        "body": body,
        "emails_with_files": emails_with_files,
    })


@app.route("/status/<job_id>")
def status(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "not found"}), 404
    return jsonify(job)


if __name__ == "__main__":
    app.run(debug=True, port=5000)