# PDM Account Manager Intelligence Hub

MCP server that connects Claude Desktop to Salesforce for dental implant practice account management at Progressive Dental Marketing.

## Setup

```bash
npm install
cp .env.example .env
# Fill in SF_USERNAME, SF_PASSWORD, SF_SECURITY_TOKEN in .env
npm run build
```

## Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pdm-salesforce": {
      "command": "node",
      "args": ["/Users/williamsummers/salesforce-retention-mcp/dist/index.js"],
      "env": {
        "SF_LOGIN_URL": "https://login.salesforce.com",
        "SF_USERNAME": "your.email@progressivedental.com",
        "SF_PASSWORD": "yourpassword",
        "SF_SECURITY_TOKEN": "yourtoken"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

## Tools

| Tool | Description |
|------|-------------|
| `sf_get_weekly_synopsis` | New cases, upcoming renewals, and stale accounts for the current week |
| `sf_get_pre_call_brief` | Full account brief with contacts, products, cases, health score, and talking points |
| `sf_log_account_note` | Log a completed call, email, meeting, or note to a Salesforce account |
| `sf_get_account_health_report` | Detailed health score breakdown for one account |
| `sf_get_churn_risk_accounts` | Ranked list of accounts most at risk of churning |
| `sf_get_renewal_pipeline` | Open opportunities closing within N days |
| `sf_get_upsell_opportunities` | Accounts missing PDM products, with recommended upsell rationale |

## Health Score Formula

```
Overall = (Engagement × 40%) + (Case Health × 30%) + (Renewal × 30%)
```

**Engagement (40%)** — Completed tasks in the last 30 days:
- Calls: 15 pts each, max 60
- Emails: 5 pts each, max 20
- Meetings: 20 pts each, max 20

**Case Health (30%)** — Starts at 100, deducts per open case:
- High/Escalated: −30 | Medium: −15 | Low: −5
- Cases open > 14 days: additional −10

**Renewal (30%)** — Based on `Contract_End_Date__c` or open opportunity stage/close date.

| Score | Rating |
|-------|--------|
| 80–100 | Excellent |
| 65–79 | Good |
| 50–64 | Fair |
| 35–49 | At Risk |
| 0–34 | Critical |

## PDM Product Catalog

Web Development · Video & Photography · PPC · Social Media · SEO · TCI Mentorship ($3,500/mo) · TCI Events · Traditional Media

## Development

```bash
npm run dev    # TypeScript watch mode
npm run build  # Compile to dist/
npm start      # Run compiled server
```
