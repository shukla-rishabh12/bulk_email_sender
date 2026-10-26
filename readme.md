<div align="center">

# 📬 Bulk Email Sender

**Send personalized emails to hundreds of recipients — with per-recipient attachments — from a single CSV. Nothing stored. Ever.**

[![Flask](https://img.shields.io/badge/Flask-3.x-000000?style=flat-square&logo=flask)](https://flask.palletsprojects.com/)
[![Python](https://img.shields.io/badge/Python-3.9+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![SQLite](https://img.shields.io/badge/SQLite-3-003B57?style=flat-square&logo=sqlite)](https://sqlite.org)
[![Privacy](https://img.shields.io/badge/Privacy-first-10b981?style=flat-square)](#-privacy--security-model)
[![License](https://img.shields.io/badge/License-Internal-8b5cf6?style=flat-square)](#-license)

[Features](#-features) · [Quick Start](#-quick-start) · [User Guide](#-user-guide) · [CSV Format](#-csv-format) · [API](#-api-reference) · [FAQ](#-faq)

</div>


<div align="center">
## Setup for new contributors

```bash
git clone <repo-url>
cd bulk-email-sender

python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Create .env (see .env.example)
cp .env.example .env
# Edit .env with your SMTP settings

python app.py 
```
</div>

## 📖 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Architecture](#-architecture)
- [Quick Start](#-quick-start)
- [Getting an App Password](#-getting-an-app-password)
- [User Guide](#-user-guide)
  - [Step 1 — Welcome Page](#step-1--welcome-page)
  - [Step 2 — Credentials Page](#step-2--credentials-page)
  - [Step 3 — App Page](#step-3--app-page)
- [CSV Format](#-csv-format)
- [Placeholders (Personalization)](#-placeholders-personalization)
- [Attachments](#-attachments)
- [Duplicate Handling](#-duplicate-handling)
- [Speed Tuning](#-speed-tuning)
- [Configuration (`.env`)](#-configuration-env)
- [Report Download](#-report-download)
- [Privacy & Security Model](#-privacy--security-model)
- [API Reference](#-api-reference)
- [Project Structure](#-project-structure)
- [Troubleshooting](#-troubleshooting)
- [FAQ](#-faq)
- [Best Practices](#-best-practices)
- [Limitations](#-limitations)

---

## 🎯 Overview

**Bulk Email Sender** is a locally-hosted web app for sending personalized bulk emails. You provide:

1. A **CSV file** with recipient data (emails, names, companies, etc.)
2. A **subject** and **body** with optional placeholders
3. Optional **files** (global or per-recipient)
4. Your **email credentials** (stored only in your browser)

The app sends an individualized version to every recipient — in parallel — and **deletes everything** as it goes. Restart the server and nothing remains.

### Who is this for?

| Role | Use case |
|------|----------|
| **HR** | Offer letters, salary slips, joining kits — one PDF per candidate |
| **Sales** | Monthly invoices, proposals — personalized per client |
| **Teachers** | Report cards, certificates — one per student |
| **Event organizers** | Tickets, passes, schedules — personalized per attendee |
| **Founders / marketers** | Product updates, newsletters — personalized greetings |

---

## ✨ Features

### Core
- ✅ Bulk sending via CSV (unlimited rows, limited by SMTP provider)
- ✅ Custom subject + body per session
- ✅ Parallel worker threads — configurable (default: 8)
- ✅ Live progress bar with speed, ETA, worker count
- ✅ Session report download (`.txt`) with full details

### Personalization
- ✅ Placeholders: `[name]`, `[company]`, `[email]`, or any CSV column
- ✅ Case-insensitive (`[NAME]`, `[Name]` all work)
- ✅ Legacy `{{name}}` syntax supported
- ✅ Click-to-insert chips in the UI

### Attachments
- ✅ Global mode — all files to everyone (no `attachment` column)
- ✅ Per-recipient mode — files specified per row
- ✅ Multiple files per email (`a.pdf|b.png` or `a.pdf;b.png`)
- ✅ Duplicate emails — file sets **merge** automatically
- ✅ Missing file → email still sends, file is skipped + warning
- ✅ Case-insensitive filename matching
- ✅ All file bytes stay in **RAM only** (never touch disk)

### Security & Privacy
- ✅ SMTP credentials live **only in your browser** (`sessionStorage` / `localStorage`)
- ✅ Credentials sent to server per request, dropped after job
- ✅ Per-row DB delete immediately after each send
- ✅ SQLite DB auto-wiped on every server restart
- ✅ No logs, no history, no "recently sent" list

### CSV Handling
- ✅ Header auto-detection (`email` column required)
- ✅ Headerless CSV supported
- ✅ Case-insensitive email deduplication
- ✅ Duplicate occurrence report with counts
- ✅ Invalid / empty row skipping
- ✅ Full column statistics with all unique values

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          BROWSER                                │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │   Welcome    │→ │ Credentials  │→ │       App view       │   │
│  │  (tutorial)  │  │  (SMTP test) │  │  (CSV + subject...)  │   │
│  └──────────────┘  └──────┬───────┘  └──────────┬───────────┘   │
│                           │                     │               │
│                  saves to │                     │ sends creds   │
│                           ▼                     │ per request   │
│              ┌────────────────────────┐         │               │
│              │  localStorage /        │         │               │
│              │  sessionStorage        │         │               │
│              └────────────────────────┘         │               │
└─────────────────────────────────────────────────│───────────────┘
                                                  │
                        ┌─────────────────────────▼─────────────┐
                        │             FLASK BACKEND             │
                        │                                       │
                        │  /verify-smtp → open SMTP, close      │
                        │  /preview     → parse CSV, return     │
                        │                 stats (no send)       │
                        │  /upload      → queue rows, spawn     │
                        │                 worker threads        │
                        │  /status/<id> → live progress         │
                        │                                       │
                        │  ┌─────────────────────────────────┐  │
                        │  │  Worker threads (N parallel)    │  │
                        │  │                                 │  │
                        │  │  - pick row from queue          │  │
                        │  │  - build MIME (attachments)     │  │
                        │  │  - send via SMTP                │  │
                        │  │  - DELETE row from DB           │  │
                        │  │  - repeat                       │  │
                        │  └─────────────────────────────────┘  │
                        │                                       │
                        │  SQLite queue.db (temp, boot-wiped)   │
                        │  Files in RAM only (files_map)        │
                        └───────────────────────────────────────┘
```

**Key design principles:**

1. **Zero persistence of credentials** — sender email + App Password never touch disk on the server
2. **RAM-only attachments** — file bytes live only while a job runs
3. **Per-row deletion** — DB is empty immediately after each email sends, not at the end
4. **Boot wipe** — server restart guarantees fresh state

---

## 🚀 Quick Start

### Prerequisites

- **Python 3.9+**
- **pip** (comes with Python)
- An email account with **App Password** support (Gmail, Outlook, Yahoo, etc.)

### 1. Clone and install

```bash
git clone <your-repo>
cd bulk-email-sender
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install flask python-dotenv
```

### 2. Create `.env`

```env
# SMTP server (no credentials here — user supplies them in browser)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587

# Default subject/body (users can override in UI)
MAIL_SUBJECT=Hello
MAIL_BODY=Default message

# Speed
WORKERS=8
SEND_DELAY=0.2

# Debug / Limits
SMTP_DEBUG=0
MAX_REQUEST_MB=100
```

### 3. Run

```bash
python app.py
```

Open **[http://localhost:5000](http://localhost:5000)** in your browser.

> **⚠️ Important:** Always use the **same URL** (`localhost:5000` vs `127.0.0.1:5000` are different origins for browser storage).

---

## 🔑 Getting an App Password

Your normal email password **will not work**. Google, Microsoft, and Yahoo all require a separate **App Password** for third-party apps.

<details open>
<summary><b>📧 Gmail (most common)</b></summary>

1. Open **[myaccount.google.com](https://myaccount.google.com)** and sign in
2. Left sidebar → **Security**
3. **2-Step Verification** → turn it **ON** if not already
4. Search "**App Passwords**" in the Security page, or go to **[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)**
5. Click **Create** → type name "Bulk Email Sender" → **Generate**
6. Copy the **16-character password** (e.g., `abcd efgh ijkl mnop`) — you won't see it again

> 💡 Spaces don't matter — the app strips them automatically.

</details>

<details>
<summary><b>📧 Outlook / Microsoft</b></summary>

1. Go to **[account.microsoft.com/security](https://account.microsoft.com/security)**
2. **Advanced security options**
3. **Two-step verification** → turn on
4. Under "App passwords" → **Create a new app password**
5. Copy the password

</details>

<details>
<summary><b>📧 Yahoo</b></summary>

1. Go to **[account.yahoo.com](https://account.yahoo.com)**
2. **Account Security** → **App passwords**
3. **Generate app password** → "Other" → name it
4. Copy the password

</details>

<details>
<summary><b>📧 Other providers (Zoho, Fastmail, custom SMTP)</b></summary>

Ask your provider for "SMTP settings" and "App Password / SMTP password". Update `.env`:

| Provider | SMTP_HOST | SMTP_PORT |
|---|---|---|
| Zoho | `smtp.zoho.com` | `465` |
| Fastmail | `smtp.fastmail.com` | `465` |
| SendGrid | `smtp.sendgrid.net` | `587` (user: `apikey`, pass: API key) |
| Mailgun | `smtp.mailgun.org` | `587` |

Port `465` uses SSL; `587` uses STARTTLS. Both are supported by the app.

</details>

---

## 📘 User Guide

### Flow overview

```
Welcome page → Credentials page → App page
   (tutorial)     (SMTP test)       (send emails)
```

Each step is a separate view in the same page — no navigation, no page reloads.

---

### Step 1 — Welcome Page

The first thing you see. It's an interactive tutorial:

- **Hero section** — app intro with a call-to-action button
- **What you'll need** — 3 cards explaining CSV, email account, and files
- **Get your App Password** — tabbed guide (Gmail / Outlook / Yahoo) with numbered steps
- **How to use** — 3-step overview of the whole workflow
- **Privacy banner** — reassurance about data handling
- **Final CTA** — "I have my App Password" button

**Click "Let's get started"** → moves to Credentials.

---

### Step 2 — Credentials Page

You enter your **email address** and **App Password**.

| Field | Notes |
|-------|-------|
| **Email address** | Your full email (e.g., `you@gmail.com`) |
| **App Password** | The 16-character password from Google/Microsoft/Yahoo — **not** your normal login password |
| **Remember on this device** | Checkbox — explained below |

#### Password visibility

Click the 👁 icon to toggle visibility of the password field.

#### "Remember on this device" — what it does

| Checkbox | Where stored | When cleared |
|----------|-------------|--------------|
| **Unchecked** (default) | `sessionStorage` | When the browser tab closes |
| **Checked** | `localStorage` | Only when you click "Switch account" or manually clear browser data |

> 🔐 **Security warning:** `localStorage` stores the password as **plaintext**. Only use "Remember" on your **personal computer**. Never on shared/office computers.

#### SMTP verification

When you click **"Test connection & continue"**, the app:

1. Reads your credentials
2. Sends them to `/verify-smtp` endpoint
3. Server opens a real SMTP connection, logs in, closes it
4. Returns ✓ or a specific error message

**You cannot proceed to the App page until SMTP connection succeeds.** This prevents you from finding out later that your password was wrong.

Possible errors:

| Error | Meaning |
|-------|---------|
| `Authentication failed` | App Password is wrong, or 2FA not enabled |
| `Connection refused / timeout` | Network / firewall blocking SMTP |
| `Invalid sender email address` | Email format is wrong |

#### Auto-login

On subsequent visits, if credentials are saved, the app **skips the Welcome and Credentials pages** and goes straight to the App.

You can verify credentials are loaded by opening the browser console — look for `[creds] loaded from localStorage`.

---

### Step 3 — App Page

The main sending interface. You see:

- **Header** — your logged-in email + a power button to switch accounts
- **Form** — subject, body, CSV upload, files upload
- **Preview** — appears once you upload a CSV
- **Progress** — appears when sending starts
- **Report** — appears when done

#### Header

| Element | Action |
|---------|--------|
| `📬 Bulk Email Sender` | App title |
| `you@gmail.com` | Current logged-in account |
| `⏻` (power icon) | Clears credentials, returns to Credentials page |

#### Form fields

| Field | Required | Notes |
|-------|----------|-------|
| **Subject** | Yes (or default from `.env`) | Supports placeholders |
| **Body** | Yes (or default from `.env`) | Multi-line, newlines preserved |
| **CSV file** | Yes | `.csv` only |
| **Attach files** | No | Multiple allowed |

#### Preview panel

The moment you upload a CSV, five sections appear:

1. **📄 CSV summary** — size, rows, valid/invalid/empty, unique emails, duplicates, column count
2. **🏷️ Columns** — clickable chips; click to insert `[column]` at cursor position
3. **📊 Column details** — every column, fill count, all unique values (scrollable)
4. **📎 Uploaded files** — filenames + sizes, total size
5. **🔗 Attachment mapping** — first 5 emails and which files each will receive

Plus warnings for:
- ⚠️ Files referenced in CSV but not uploaded
- ℹ️ Uploaded files not referenced in CSV

**This is your last check before sending.** Verify the mapping, then click **Send Emails**.

#### Progress panel

While sending:

| Stat | Meaning |
|------|---------|
| **Sent** | Successfully sent emails |
| **Failed** | Emails that errored out |
| **Total** | Emails queued |
| **Speed** | Emails/second (live) |
| **ETA** | Seconds remaining (live) |
| **Workers** | Parallel SMTP connections in use |

Plus a live progress bar with percentage.

#### Report panel

After sending completes, you see:
- **Duplicate summary** — if any emails were deduplicated
- **Table** — each duplicate email and its occurrence count
- **Attachment warnings** — missing/unused files
- **⬇ Download Detailed Report** button

---

## 📄 CSV Format

### Minimum — just emails

```csv
email
alice@example.com
bob@example.com
carol@example.com
```

Or even simpler, no header:

```csv
alice@example.com
bob@example.com
carol@example.com
```

### With personalization columns

```csv
email,name,company,designation
alice@example.com,Alice,Google,Engineer
bob@example.com,Bob,Microsoft,Manager
carol@example.com,Carol,Amazon,Designer
```

### With per-email attachments

```csv
email,name,attachment
alice@example.com,Alice,invoice-alice.pdf
bob@example.com,Bob,report-bob.pdf
carol@example.com,Carol,
```

### With multiple files per email

```csv
email,name,attachment
alice@example.com,Alice,pass.pdf|schedule.pdf|map.png
bob@example.com,Bob,pass.pdf
carol@example.com,Carol,
```

### Column rules

| Column | Required? | Rule |
|--------|-----------|------|
| `email` | **✅ Yes** | Case-insensitive header. Must be a valid email per row. |
| `attachment` | Optional | **Exact name only** (no aliases). Files per row. |
| Any other column | Optional | Used as placeholder values |

### Rows

| Row type | Behavior |
|----------|----------|
| Valid email | Queued for sending |
| Duplicate email | Deduplicated — files merged, data uses first row |
| Invalid email (`not-an-email`) | Skipped, counted as invalid |
| Empty row | Skipped |
| Short row (`len < email_index`) | Skipped, counted as invalid |

### Multiple files per cell

Use **`|`** (pipe) or **`;`** (semicolon) to separate:

```csv
alice@example.com,pass.pdf|schedule.pdf|map.png
```

Both work. Spaces around separators are trimmed.

### How to export CSV from Excel

1. Open your Excel file
2. **File → Save As**
3. Choose format: **CSV (Comma delimited)**
4. Save

### From Google Sheets

1. **File → Download → Comma-separated values (.csv)**
2. Save

---

## 🔤 Placeholders (Personalization)

Use `[column_name]` in subject or body. The app replaces them per-recipient from the matching CSV row.

### Example

**CSV:**
```csv
email,name,company,designation
alice@example.com,Alice,Google,Engineer
bob@example.com,Bob,Microsoft,Manager
```

**Subject:** `Hi [name], update from [company]`
**Body:**
```
Hello [name],

You are registered as [designation] at [company].
Your email is [email].

Regards
Team
```

**Alice receives:**
```
Subject: Hi Alice, update from Google
Body:    Hello Alice,
         You are registered as Engineer at Google.
         Your email is alice@example.com.
         Regards, Team
```

**Bob receives:**
```
Subject: Hi Bob, update from Microsoft
Body:    Hello Bob,
         You are registered as Manager at Microsoft.
         Your email is bob@example.com.
         Regards, Team
```

### Supported syntax

| Syntax | Works? | Notes |
|--------|--------|-------|
| `[name]` | ✅ | Recommended |
| `[NAME]` | ✅ | Case-insensitive |
| `[Name]` | ✅ | Case-insensitive |
| `{{name}}` | ✅ | Legacy syntax |
| `{{NAME}}` | ✅ | Legacy |
| `{{email}}` | ✅ | Legacy auto-placeholder |

### Missing values

If a placeholder's column doesn't exist in the CSV, it stays as literal text:

`Hi [unknown_column]` → stays as `Hi [unknown_column]`

If the column exists but the row's cell is empty, the placeholder is replaced with an empty string.

### Click-to-insert

On the App page, after uploading a CSV, clickable chips appear for each column:

```
[email] [name] [company] [designation] [attachment]
```

Click any chip while the cursor is in the subject or body field → inserts `[column_name]` at the cursor position.

---

## 📎 Attachments

The app supports two modes of attachments, controlled by whether your CSV has an `attachment` column.

### Mode 1 — Global (no `attachment` column)

```csv
email,name
alice@example.com,Alice
bob@example.com,Bob
```

Upload files → **every recipient gets every file**.

Use for: same brochure to everyone, common terms & conditions, generic welcome packet.

### Mode 2 — Per-recipient (`attachment` column)

```csv
email,name,attachment
alice@example.com,Alice,invoice-alice.pdf
bob@example.com,Bob,invoice-bob.pdf
carol@example.com,Carol,
```

Upload all referenced files → **each recipient gets only their files**.

- `alice` → `invoice-alice.pdf`
- `bob` → `invoice-bob.pdf`
- `carol` → no attachment (empty cell)

### Multiple files per recipient

```csv
email,attachment
alice@example.com,slip.pdf|form16.pdf|policy.pdf
bob@example.com,slip.pdf
```

- `alice` → 3 files
- `bob` → 1 file

### Missing files

If CSV references a file that wasn't uploaded:

```csv
alice@example.com,invoice.pdf|missing.pdf
```

- Uploaded: `invoice.pdf` only
- Result: Alice gets `invoice.pdf` only (email **still sends**)
- Preview shows: ⚠️ `missing.pdf (missing)`

The email **never fails** because of a missing attachment — the file is just skipped.

### Unused files

If you upload files that aren't referenced:

- Preview shows: ℹ️ `2 uploaded file(s) unused: extra1.pdf, extra2.pdf`
- Those files are **not sent to anyone**

### Duplicate emails

If the same email appears in multiple rows with different files:

```csv
alice@example.com,invoice.pdf
alice@example.com,receipt.pdf
```

- Result: Alice gets **both files** (`invoice.pdf` + `receipt.pdf`)
- Data (name, company) uses the **first row**
- Report shows: "alice@example.com — 2 occurrences"

### Case-insensitive matching

CSV says `Invoice.pdf`, upload has `invoice.pdf` → they match.

### File size limits

| Limit | Default | Configurable |
|-------|---------|--------------|
| Total upload (CSV + all files) | 100 MB | `MAX_REQUEST_MB` in `.env` |
| Per-email (SMTP provider limit) | Gmail: 25 MB | — |

For Gmail, keep **total attachment size per email under 20 MB** to be safe.

---

## 🔁 Duplicate Handling

### What counts as a duplicate

Same email (case-insensitive) appearing more than once:

```csv
alice@example.com
Alice@Example.com
ALICE@EXAMPLE.COM
```

All three → treated as **one email** `alice@example.com`.

### What happens

| Aspect | Behavior |
|--------|----------|
| Email | Sent **once** to `alice@example.com` |
| Data (name, company) | Uses the **first** row's values |
| Attachments | **All unique files merged** from all rows |
| Report | Shows `alice@example.com — 3 occurrences` |

### Example

```csv
email,name,attachment
alice@example.com,Alice,invoice.pdf
alice@example.com,Alice2,receipt.pdf
alice@example.com,Alice3,extra.pdf
bob@example.com,Bob,report.pdf
```

**Result:**
- Alice receives **1 email** with subject/body using "Alice" (first row)
- Attachments: `invoice.pdf` + `receipt.pdf` + `extra.pdf`
- Bob receives his email with `report.pdf`
- Report shows:
  - `alice@example.com — 3 occurrences`
  - `2 duplicate occurrences removed`
  - `4 valid entries → 2 unique emails`

---

## ⚡ Speed Tuning

### Default settings

```
WORKERS=8        # parallel SMTP connections
SEND_DELAY=0.2   # seconds between sends per worker
```

**Throughput:** ~8 × 5 = **~7-8 emails/second** → 100 emails in ~15 seconds.

### Tuning table

| Use case | WORKERS | SEND_DELAY | 100 emails ETA |
|----------|---------|------------|----------------|
| **Maximum speed** | 8 | 0.1 | ~7-10s |
| **Balanced** (recommended) | 8 | 0.2 | ~15-20s |
| **Large batches (200-500)** | 5 | 0.4 | ~25-35s |
| **Very safe / shared SMTP** | 3 | 0.5 | ~45-60s |
| **Conservative** | 2 | 1.0 | ~90-110s |

### SMTP provider limits

| Provider | Daily limit | Rate limit |
|----------|-------------|------------|
| Gmail (free) | ~500 | ~20/sec burst |
| Gmail Workspace | ~2000 | ~20/sec |
| Outlook | ~500 | ~30/min |
| Yahoo | ~500 | varies |
| SendGrid | 100/day free, paid higher | high |
| Mailgun | 100/day free, paid higher | high |

### How to know you're being throttled

If emails fail with `421 4.7.0 Try again later`, `450` errors, or connection disconnects:

1. Reduce `WORKERS` to **3-4**
2. Increase `SEND_DELAY` to **0.5-1.0**
3. Restart server
4. Retry

---

## ⚙️ Configuration (`.env`)

### Full reference

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | `smtp.gmail.com` | SMTP server hostname |
| `SMTP_PORT` | `587` | `587` = STARTTLS, `465` = SSL |
| `MAIL_SUBJECT` | `Hello` | Default subject (user can override) |
| `MAIL_BODY` | `Test message` | Default body (user can override) |
| `WORKERS` | `8` | Parallel SMTP connections |
| `SEND_DELAY` | `0.2` | Delay between sends per worker (seconds) |
| `SMTP_DEBUG` | `0` | `1` = verbose SMTP logging in terminal |
| `MAX_REQUEST_MB` | `100` | Max total upload size |

> **⚠️ Important:** `SENDER_EMAIL` and `SENDER_PASSWORD` are **NOT** in `.env` anymore. Users enter them in the browser; they're stored in `localStorage`/`sessionStorage`.

### Provider presets

**Gmail:**
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
```

**Outlook:**
```env
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
```

**Yahoo:**
```env
SMTP_HOST=smtp.mail.yahoo.com
SMTP_PORT=465
```

**SendGrid:**
```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
# User: apikey (literal)
# Password: your SendGrid API key (enter in credentials page)
```

---

## 📋 Report Download

After a session completes, click **⬇ Download Detailed Report** for a timestamped `.txt` file with **9 sections**:

### Section 1 — Session Overview
- Report generated at
- Sender account (your email)
- Job started at
- Job completed at
- Total duration
- Job ID

### Section 2 — Send Result Summary
- Emails targeted
- Emails sent successfully
- Emails failed
- Success rate (percentage)
- Last failure reason (if any)

### Section 3 — CSV Source File
- File size
- Total data rows
- Valid / invalid / empty rows
- Unique emails found
- Duplicate occurrences removed

### Section 4 — CSV Columns Detected
- Every column name
- Fill count for each
- Unique value count
- Up to 50 example values per column
- Which column is the attachment column

### Section 5 — Duplicate Emails
- Full list of duplicates with occurrence counts
- Merge note explaining what happened

### Section 6 — Attachments
- Attachment mode (per-email / global)
- Uploaded file count and total size
- Full list of uploaded files with sizes
- Missing files (with note that emails still sent)
- Unused files

### Section 7 — Email Template
- Exact subject used
- Exact body used
- Placeholder syntax explanation

### Section 8 — Failed Emails (if any)
- Each failed email address
- The specific error reason

### Section 9 — Privacy Note
- Where credentials live
- How emails are deleted
- How attachments are handled
- Server restart behavior

**Sample output:**
```
======================================================================
  BULK EMAIL SENDER — DETAILED REPORT
======================================================================

1) SESSION OVERVIEW
----------------------------------------------------------------------
  Report generated at             : 26/10/2026, 3:42:15 pm
  Sender account                  : you@gmail.com
  Job started at                  : 26/10/2026, 3:41:58 pm
  Job completed at                : 26/10/2026, 3:42:14 pm
  Total duration                  : 16.2 seconds
  Job ID                          : a3f2b8c1-4d5e-6f7a-8b9c-0d1e2f3a4b5c

2) SEND RESULT SUMMARY
----------------------------------------------------------------------
  Emails targeted (unique)        : 60
  Emails sent successfully        : 59
  Emails failed                   : 1
  Success rate                    : 98.33 %
  Last failure reason             : SMTPRecipientsRefused: invalid address

...
```

---

## 🔒 Privacy & Security Model

### Where each piece of data lives

| Data | Location | Lifetime |
|------|----------|----------|
| **Sender email + password** | Browser `sessionStorage` or `localStorage` | Until tab close / manual clear |
| **Credentials in transit** | HTTPS POST (localhost HTTP in dev) | Per-request |
| **Credentials on server** | Thread-local variable in worker | Dropped when job finishes |
| **Emails + names + companies** | SQLite `queue.db` | Deleted per-row, immediately after send |
| **Attachment bytes** | RAM (`files_map` dict) | Freed when job ends (GC) |
| **Uploaded filenames** | SQLite `queue` table (JSON list) | Deleted with the row |
| **Job stats (counts)** | In-memory `jobs` dict | Freed when Flask restarts |
| **Error reasons** | In-memory `last_error` | Freed on restart |
| **`.env` on disk** | Server file | Forever (SMTP config only, **no credentials**) |

### Guarantees

1. ✅ **Credentials never touch disk** on the server
2. ✅ **Credentials not in DB**, not in logs
3. ✅ **Emails deleted per-row** (right after sending, not at end)
4. ✅ **Attachments never written to disk** — RAM only
5. ✅ **Restart = clean slate** — DB auto-wiped on boot

### Local storage security

**When you check "Remember on this device":**

- Password is stored as **plaintext** in `localStorage`
- Any JavaScript on the same origin can read it
- Any browser extension with `localStorage` access can read it
- Any XSS vulnerability in this app could leak it

**Best practices:**

- ✅ Use "Remember" only on **personal laptop/desktop**
- ❌ Never on **shared / office / public** computers
- ✅ Click **⏻ switch account** when done on public machines
- ✅ Use browser "Clear browsing data → Cookies and site data" to manually clear

### Production considerations

If deploying this publicly (not just localhost):

1. **Use HTTPS** — credentials in plain HTTP are visible on the network
2. **Don't use `localStorage` for production** — use server-side sessions with short TTL, or an OAuth flow
3. **Add auth** to `/upload`, `/preview`, `/verify-smtp` — currently open
4. **Rate-limit** `/verify-smtp` to prevent brute-force
5. **Set SPF/DKIM/DMARC** for your domain

---

## 🔌 API Reference

All endpoints are POST/GET, JSON in/out (except multipart for file uploads).

### `GET /`
Renders the main SPA (`index.html`).

### `GET /defaults`
Returns default subject/body/workers from `.env`.

**Response:**
```json
{
  "subject": "Hello",
  "body": "Default message",
  "workers": 8
}
```

---

### `POST /verify-smtp`

Test SMTP credentials without sending any email.

**Request (multipart):**
```
sender_email: you@gmail.com
sender_password: abcd1234efgh5678
```

**Response — success:**
```json
{ "ok": true }
```

**Response — failure:**
```json
{
  "ok": false,
  "error": "Authentication failed. The App Password is incorrect (or 2FA not enabled on the account)."
}
```

---

### `POST /preview`

Parse CSV and return statistics + attachment mapping preview. **No emails sent.**

**Request (multipart):**
```
file: <CSV file>
attachments: <file1>, <file2>, ...   (multiple, optional)
```

**Response:**
```json
{
  "columns": ["email", "name", "company", "attachment"],
  "column_stats": [
    {
      "name": "email",
      "filled": 85,
      "empty": 0,
      "total": 85,
      "unique_count": 85,
      "values": ["alice@example.com", "bob@example.com", "..."]
    }
  ],
  "row_count": 85,
  "total_data_rows": 87,
  "invalid_rows": 2,
  "empty_rows": 0,
  "unique_emails": 85,
  "duplicates_in_csv": 0,
  "csv_size": 4218,
  "csv_size_human": "4.1 KB",
  "has_attachment_col": true,
  "attachment_column": "attachment",
  "uploaded_files_count": 85,
  "files_info": [
    { "filename": "invoice.pdf", "size": 245000, "size_human": "239.3 KB" }
  ],
  "total_files_size": 20825000,
  "total_files_size_human": "19.9 MB",
  "sample": [
    {
      "email": "alice@example.com",
      "resolved": ["invoice.pdf"],
      "missing": []
   