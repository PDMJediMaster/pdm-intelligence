# Foresight by PDM — Team Setup Guide

> *See what's coming before it arrives.*

**Time to set up: ~5 minutes**

---

## What Is Foresight?

Foresight connects Claude Desktop directly to Salesforce. It gives you AI-powered
intelligence about your clients and prospects — without leaving your workflow.

No logins. No dashboards. Just ask Claude in plain English.

---

## Step 1 — Install Claude Desktop

Download and install Claude Desktop if you don't have it:
**https://claude.ai/download**

Sign in with your Anthropic account (or create one — it's free to start).

> **Note:** Foresight tools require a **Claude Pro** subscription ($20/mo) or
> a PDM team seat. Ask William if you need an account set up.

---

## Step 2 — Add the Foresight Config

This is the only technical step. Copy and paste exactly.

### On Mac:

1. Open **Terminal** (search "Terminal" in Spotlight)
2. Run this command:

```bash
open ~/Library/Application\ Support/Claude/
```

3. Open the file called **`claude_desktop_config.json`** in any text editor
4. Replace the entire contents with:

```json
{
  "mcpServers": {
    "foresight": {
      "type": "http",
      "url": "https://salesforce-retention-mcp-production.up.railway.app/mcp"
    }
  }
}
```

5. Save the file

### On Windows:

1. Press **Windows + R**, type `%APPDATA%\Claude\` and hit Enter
2. Open **`claude_desktop_config.json`** in Notepad
3. Replace the entire contents with the JSON above
4. Save the file

---

## Step 3 — Restart Claude Desktop

Fully quit Claude Desktop and reopen it.

---

## Step 4 — Verify It's Working

1. Open Claude Desktop
2. Go to **Settings → Developer**
3. You should see **"foresight"** listed with **16 tools**

If you see it — you're live. If not, see Troubleshooting below.

---

## You're Live — Try These First

**Account Managers:**
```
Pull my weekly brief
```
```
Give me a pre-call brief for [Client Name]
```
```
Which of my accounts are at risk right now?
```

**Sales Reps:**
```
Pull my pipeline synopsis for this week
```
```
Research [Practice Name] in [City, State]
```
```
Pull lead intelligence on [Lead Name]
```

---

## Troubleshooting

**"No tools found" or foresight not showing:**
- Make sure you fully quit and restarted Claude Desktop (not just closed the window)
- Double-check the config file — no extra spaces or missing quotes
- On Mac: Cmd+Q to fully quit, then reopen

**"Connection error" when using a tool:**
- Check your internet connection
- The Railway server may be restarting — wait 60 seconds and try again

**Tool gives wrong account data:**
- Make sure you're spelling the account name close enough for fuzzy search
- Try using "for [exact name]" to help Claude identify the right record

**Need help:**
Contact William Summers — william@progressivedental.com

---

*Foresight by PDM — Built on Claude + Salesforce + Railway*
