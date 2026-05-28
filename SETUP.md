# Pipeline Client Portal — Netlify Setup Guide

## What You're Deploying

Four separate Netlify sites, each with its own password:

| Site | Folder | URL (after DNS) |
|---|---|---|
| Mackinac Center | `sites/mackinac` | mackinac.pipeline.app |
| Life International | `sites/lifeinternational` | lifeinternational.pipeline.app |
| EverRaise | `sites/everraise` | everraise.pipeline.app |
| Admin (you only) | `sites/admin` | admin.pipeline.app |

Each client site + the Netlify Function folder need to be deployed together.

---

## Step 1 — Get Your Linear API Key

1. Open Linear → click your workspace name (top left)
2. Go to **Settings → API → Personal API keys**
3. Click **Create key** → name it "Pipeline Portal"
4. Copy the key — you only see it once

---

## Step 2 — Deploy Each Site to Netlify

For **each** of the four sites, do the following:

### 2a. Create a new Netlify site
1. Log in to Netlify → **Add new site → Deploy manually**
2. Drag and drop the site folder (e.g. `sites/mackinac`) — but wait, you also need the functions. See 2b first.

### 2b. Structure each deploy folder
Before dragging into Netlify, combine the site with the shared function:

```
mackinac-deploy/
  index.html              ← from sites/mackinac/index.html
  netlify.toml            ← from root netlify.toml
  netlify/
    functions/
      linear-data.js      ← from netlify/functions/linear-data.js
```

Do this for all four sites (mackinac, lifeinternational, everraise, admin).

### 2c. Drag and drop the folder into Netlify
- Netlify will auto-detect the `netlify.toml` and wire up the function
- Deploy takes about 30 seconds

---

## Step 3 — Add the Linear API Key as an Environment Variable

Do this for **each of the four Netlify sites**:

1. In Netlify → open the site → **Site configuration → Environment variables**
2. Click **Add a variable**
3. Key: `LINEAR_API_KEY`
4. Value: paste your Linear API key
5. Save → **Trigger redeploy**

---

## Step 4 — Enable Password Protection

For each site:
1. Netlify → Site → **Site configuration → Access control**
2. Under **Password protection** → click **Enable password protection**
3. Set a unique password per client:
   - Mackinac: something memorable, share with your Mackinac contact
   - Life International: separate password
   - EverRaise: separate password
   - Admin: your own strong password

---

## Step 5 — Connect Custom Domains

For each site:
1. Netlify → Site → **Domain management → Add a domain**
2. Enter the subdomain (e.g. `mackinac.pipeline.app`)
3. Netlify gives you a CNAME value — add it in your DNS provider:
   - Type: `CNAME`
   - Name: `mackinac`
   - Value: `[your-netlify-site].netlify.app`
4. Repeat for all four subdomains

DNS usually propagates within 10–30 minutes.

---

## Step 6 — Update the Now/Next/Later Roadmap

The **This Cycle** and **Now** lanes pull live from Linear automatically.

The **Next** and **Later** lanes are manually curated in each `index.html`. When your roadmap shifts, open the file and edit the `ROADMAP` object near the top of the `<script>` section — it is clearly labeled. Redeploy by dragging the updated folder into Netlify.

---

## How the Linear Data Mapping Works

| What Linear has | Where it appears on the portal |
|---|---|
| Issue title starts with `[MAK]` | Appears on Mackinac portal only |
| Issue title starts with `[LI]` | Appears on Life International portal only |
| Issue title starts with `[EVR]` | Appears on EverRaise portal only |
| Issue is in active cycle | **This Cycle** lane |
| Issue is `Todo` or `In Progress`, not in cycle | **Now** lane |
| Issue is `Backlog` + label `Feature` or `Improvement` + created last 7 days | **Idea Bucket** (this week) |
| Issue is `Backlog` + label `Feature` or `Improvement` + created last 30 days | **Idea Bucket** (this month) |

No new labels needed. No workflow changes. It uses your existing `[MAK]`, `[LI]`, `[EVR]` naming convention.

---

## Troubleshooting

**"Could not load live data" error on the page**
→ Check that `LINEAR_API_KEY` is set correctly in Netlify environment variables and that you triggered a redeploy after adding it.

**This Cycle lane is empty**
→ Confirm there is an active cycle in Linear. Go to Linear → Cycles → confirm one is marked active.

**Ideas not showing up**
→ Confirm the issues have either a `Feature` or `Improvement` label AND are in `Backlog` status AND were created within the last 30 days.

**Domain not resolving**
→ DNS can take up to 24 hours in rare cases. Check your CNAME record is correct in your DNS provider.
