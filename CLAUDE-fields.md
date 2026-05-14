# CLAUDE-fields.md — Salesforce Field Maps
*Load this file when building or modifying tools that query Salesforce objects.*

---

## Key Custom Objects

### Gamma__c
- `Name` — Text(80), deck name
- `Gamma_Link__c` — URL(255)
- `Account__c` — Lookup(Account)
- `Lead__c` — Lookup(Lead)
- Relationship: Lookup (not master-detail). Written by sf_research_prospect and n8n Workflow 1.

### Refund_Request__c
Open refund requests. Critical churn signal — forces accounts to top of churn risk regardless of health score.

### Change_Order__c
Change orders with cancellation/pause dates. Cancellation Change Orders = churn signal.

### Business_Objectives__c
Client goals linked to Account.

### Reassignments__c
AM transition history per Account.

### Invoices__c
Invoice records with delinquency signals.

### Sales_Order__c
Active service contracts. Multiple per Account = proposals. Filter to Signed/Active only.

### TCI_Training_Progress__c
TCI program tracking per client.

### TCI_Events__c
The Closing Institute events (Bootcamp, FAGC).

---

### Call_Intelligence__c ✅ BUILT (26 custom fields — confirmed 5/1/2026)
Per-call AI analysis. Every VideoCall processed by Workflow 11 gets a record.

| Field | Type | Notes |
|---|---|---|
| `VideoCall__c` | Lookup(Video Call) | Source call |
| `Account__c` | Lookup(Account) | Client account |
| `Call_Date__c` | Date/Time | |
| `Call_Duration_Seconds__c` | Number(8,0) | |
| `Is_Recorded__c` | Checkbox | |
| `Language__c` | Text(10) | |
| `Vendor__c` | Text(50) | e.g., ZOOM |
| `Processing_Status__c` | Picklist | Pending / Processing / Processed / Error |
| `Sentiment_Label__c` | Picklist | Positive / Neutral / Negative / Mixed |
| `Sentiment_Score__c` | Number(5,0) | -100 to +100 |
| `Tone_Shift__c` | Picklist | Improved / Stable / Declined / N/A |
| `SF_Intelligence_Score__c` | Number(8,0) | Salesforce CI-generated score |
| `Key_Topics__c` | Long Text(1000) | |
| `Commitments_Made__c` | Long Text(5000) | |
| `Risk_Signals__c` | Long Text(3000) | |
| `Competitor_Mentions__c` | Long Text(1000) | |
| `AI_Summary__c` | Long Text(10000) | Claude's synthesis |
| `Doctor_Reached__c` | Checkbox | |
| `Satisfaction_Signal__c` | Picklist | Satisfied / Neutral / Frustrated / Escalation Risk |
| `Follow_Up_Required__c` | Checkbox | |
| `Budget_Concern__c` | Checkbox | |
| `Pause_Cancel_Language__c` | Checkbox | Triggers save play in Workflow 10 |
| `Competitor_Mentioned__c` | Checkbox | |
| `Processed_Date__c` | Date/Time | |
| `Processing_Error__c` | Long Text(500) | |
| `Transcript_Char_Count__c` | Number(10,0) | |

---

### Competitor_Snapshot__c ✅ BUILT (24 custom fields — confirmed 5/1/2026)
Quarterly competitor intelligence snapshots per Account or Lead.

| Field | Type | Notes |
|---|---|---|
| `Account__c` | Lookup(Account) | |
| `Lead__c` | Lookup(Lead) | |
| `Competitor_Name__c` | Text(255) | Required |
| `Competitor_Website__c` | URL(255) | |
| `Snapshot_Date__c` | Date | When taken |
| `Previous_Snapshot_Date__c` | Date | Prior snapshot date |
| `Google_Review_Count__c` | Number(6,0) | Current count |
| `Previous_Review_Count__c` | Number(6,0) | Count at last snapshot |
| `Review_Delta__c` | Formula(Number) | Current − Previous |
| `Estimated_Monthly_Reviews__c` | Number(4,0) | Velocity estimate |
| `Google_Star_Rating__c` | Number(3,1) | e.g., 4.8 |
| `Maps_Pack_Position__c` | Number(2,0) | Maps Pack rank |
| `Running_Google_Ads__c` | Checkbox | |
| `Running_Facebook_Ads__c` | Checkbox | |
| `Has_YouTube_Channel__c` | Checkbox | |
| `Social_Platforms__c` | Text(255) | Comma-delimited |
| `Primary_Services__c` | Text(255) | e.g., "Implants, All-on-4" |
| `Primary_Services_Marketed__c` | Long Text(500) | Full breakdown |
| `Competitive_Pressure_Score__c` | Number(3,0) | 0–100 composite |
| `Is_Primary_Competitor__c` | Checkbox | Dominant competitor flag |
| `Alert_Triggered__c` | Checkbox | Set true when delta exceeds threshold |
| `Research_Notes__c` | Long Text(2000) | |
| `Scan_Analysis__c` | Rich Text(32768) | Full AI-written competitive analysis |
| `Record_Name__c` | Auto Number | System name field |

---

### Event_Engagement__c ✅ BUILT (27 custom fields — confirmed 5/1/2026)
Tracks engagement records from any PDM event (TCI Bootcamp, FAGC, corporate events).

| Field | Type | Notes |
|---|---|---|
| `Account__c` | Lookup(Account) | Matched account |
| `Contact__c` | Lookup(Contact) | Matched contact |
| `TCI_Events__c` | Lookup(TCI_Events__c) | Parent event |
| `Opportunity__c` | Lookup(Opportunity) | Linked deal |
| `Interaction_Date_Time__c` | Date/Time | |
| `Interaction_Type__c` | Picklist | Booth Visit / Breakout / Hallway / One-on-One |
| `Source__c` | Picklist | How captured |
| `Matched_By__c` | Picklist | Email / Name / Company / Manual |
| `Duplicate_Check_Key__c` | Text(255) **Unique** | Dedup key |
| `Engagement_Level__c` | Picklist | Hot / Warm / Cold / Existing Client |
| `Buying_Signal__c` | Picklist | Signal detected |
| `Urgency__c` | Picklist | Timeframe indicated |
| `Primary_Interest__c` | Picklist | PDM product asked about |
| `Services_Discussed__c` | Multi-Select Picklist | All services mentioned |
| `Pain_Point__c` | Multi-Select Picklist | Problems described |
| `Confidence_Score__c` | Number(2,0) | 0–99 rep confidence |
| `Conversation_Summary__c` | Long Text(3000) | What was said |
| `Original_Message__c` | Long Text(2000) | Raw rep notes |
| `Notes__c` | Long Text(2000) | Additional context |
| `Follow_Up_Date__c` | Date | When to reach out |
| `Follow_Up_Channel__c` | Picklist | Phone / Email / Text / LinkedIn |
| `Follow_Up_Status__c` | Picklist | Not Started / In Progress / Complete / No Response |
| `Next_Step__c` | Picklist | Agreed next action |
| `Next_Step_Type__c` | Picklist | Category of next step |
| `Opportunity_Created__c` | Checkbox | Deal opened from this engagement |
| `Task_Created__c` | Checkbox | Follow-up task created |
| `Revenue_Influence__c` | Currency(18,0) | Closed revenue attributed |

---

## Account Custom Fields

| Field | Type | Notes |
|---|---|---|
| `Status__c` | Picklist | Core marketing status field |
| `Total_Monthly_Recurring_Amount__c` | Formula Currency | MRR |
| `Tier__c` | Picklist | Account tier |
| `Account_Intel__c` | Rich Text(2000) | AM intelligence notes |
| `Contract_Renewal_Date__c` | Date | Authoritative renewal date |
| `Contract_End_Date__c` | Formula | Points to Contract_Renewal_Date__c — keep, do not remove |
| `Next_Alignment_Call__c` | Date/Time | Next scheduled alignment call |
| `AM_Spoke_to_Doctor__c` | Date | Last doctor contact date |
| `Cancellation_or_Pause_Request_Date__c` | Date | Leading churn indicator |
| `Flagged_Status__c` | Checkbox | Flagged for attention |
| `Delinquent__c` | Checkbox | Billing delinquency |
| `Upsell_Opportunity__c` | Picklist | Upsell signal |
| `Engagement_Status__c` | Picklist | AM engagement assessment |
| `Health_Score__c` | Number(3,0) | Composite 0–100, written by nightly scanner |
| `Health_Tier__c` | Picklist | Healthy / Watch / At Risk / Critical |
| `Health_Score_Date__c` | Date | Last score calculation |
| `Sentiment_Trend__c` | Picklist | Improving / Stable / Declining / Unknown |
| `Call_Frequency_30d__c` | Number(3,0) | Calls in last 30 days |
| `Doctor_Contact_90d__c` | Number(3,0) | Doctor reached in last 90 days |
| `Account_Manager_Lookup__c` | Lookup(User) | Assigned AM |
| `Account_Manager_Email__c` | Formula Text | AM email |
| `TCI_Status__c` | Picklist | TCI program status |
| `TCI_Enrolled__c` | Checkbox | TCI enrollment flag |
| `Specialty__c` | Multi-Select Picklist | Dental specialties |
| `Phase__c` | Multi-Select Picklist | Service phase enrollment |
| `Budget__c` | Currency | Overall budget |
| `SEO_Budget__c` | Currency | SEO budget |
| `Social_Budget__c` | Currency | Social budget |

---

## Contact Custom Fields
- `Doctor__c` — Checkbox, is this a doctor
- `Primary_Contact__c` — Checkbox, primary non-doctor contact
- `Contact_Type__c` — Picklist (Doctor / Office Manager / etc.)
- `Status__c` — Active / Inactive

## Task Custom Fields
- `Description` — Long Text(32000), full call notes
- `Spoke_with_Doctor__c` — Checkbox, doctor-level engagement flag

---

## Zoom Integration Fields

**On Task/Event:**
- `ZVC__Zoom_Meeting__c` — Lookup to Zoom Meeting
- `ZVC__Zoom_Call_Log__c` — Lookup to Zoom Call Log
- `ZVC__Session_History__c` — Lookup to Session History
- `ZVC__Zoom_ZRA_Analysis__c` — Lookup to Zoom ZRA Analysis

**AI Summary Fields:**
- `ZVC__Zoom_Meeting__c.ZVC__Meeting_AI_Summary__c` — Long Text(131072)
- `ZVC__Zoom_Call_Log__c.ZVC__AIC_Call_Summary__c` — Long Text(131072)

---

## Conversation Insights Objects
- `UnifiedVideoCall` — 10 fields, metadata for recorded video meetings
- `UnifiedVoiceCall` — 10 fields, metadata for recorded voice calls
- `UnifiedVideoCallParticipant` — 7 fields, TalkRatio/ListenRatio per participant
- `CITranscriptEvent` — 17 fields. **CRITICAL:** Full transcript stored as ONE text block in `TranscriptEntries` (250,000 chars max). Not row-per-utterance. One record = one complete call.

---

## Fields To Build (Not Yet Created)

| Field | Object | Type | Purpose |
|---|---|---|---|
| `Stage_Entry_Date__c` | Opportunity | Date/Time | Stamped by Flow on stage change |
| `Days_In_Current_Stage__c` | Opportunity | Formula Number | TODAY − Stage_Entry_Date__c |
| `Baseline_Marketing_Maturity__c` | Account | Number | Locked at close, never changes |
| `External_Competitive_Pressure__c` | Account | Number | Updated quarterly by n8n |
| `Marketing_Maturity_Score__c` | Lead + Account | Number | Written by sf_research_prospect |
| `Likelihood_to_Buy_Score__c` | Lead + Account | Number | Written by sf_research_prospect |
| `Priority_Level__c` | Lead + Account | Picklist | Low / Moderate / High / Top Priority |
| `Research_Summary__c` | Lead + Account | Long Text | Research snapshot |
| `Primary_Gap_Type__c` | Lead + Account | Picklist | Drives Gamma template selection |
| `Competitive_Gap_Summary__c` | Lead + Account | Long Text(32,000) | Full gap analysis |
| `Estimated_Monthly_Gap_Value__c` | Lead + Account | Currency | Upsell opportunity value |
| `Renewal_Deck_URL__c` | Account | URL | Renewal deck link from n8n |
