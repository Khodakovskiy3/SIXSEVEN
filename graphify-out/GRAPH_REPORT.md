# Graph Report - SIXSEVEN  (2026-07-02)

## Corpus Check
- 56 files · ~42,806 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 513 nodes · 1151 edges · 16 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 16 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d03f47ca`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]

## God Nodes (most connected - your core abstractions)
1. `apiFetch()` - 79 edges
2. `formatDate()` - 41 edges
3. `query()` - 34 edges
4. `authRequired()` - 17 edges
5. `escapeHtml()` - 16 edges
6. `requireRole()` - 15 edges
7. `ROLE` - 15 edges
8. `requireFreshAuth()` - 12 edges
9. `hydrateAccount()` - 11 edges
10. `initManagerArm()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `run()` --calls--> `withClient()`  [EXTRACTED]
  scripts/db-migrate.js → server/db.js
- `fetchAccount()` --calls--> `apiFetch()`  [EXTRACTED]
  public/js/account.js → public/js/api.js
- `saveAdminProfile()` --calls--> `hydrateAccount()`  [EXTRACTED]
  public/js/admin.js → public/js/account.js
- `saveClientProfile()` --calls--> `hydrateAccount()`  [EXTRACTED]
  public/js/client.js → public/js/account.js
- `getSchedulesForSelectedDay()` --calls--> `formatDate()`  [EXTRACTED]
  public/js/admin.js → public/js/api.js

## Import Cycles
- None detected.

## Communities (16 total, 0 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (64): __dirname, migrationsDir, run(), __dirname, seedFile, pool, query(), withClient() (+56 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (67): accessTypeLabels, AVATAR_PALETTE, chatConversations, clients, clientsFeedback, clientsPage, clientsSearch, clientsTableBody (+59 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (49): applyAccountFields(), fetchAccount(), hydrateAccount(), clearAuth(), getAuth(), getPageByRole(), requireAuth(), requireFreshAuth() (+41 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (48): formatDate(), setAuth(), accessTypeLabels, activePlans, bookings, bookSchedule(), cancelBooking(), changePassword() (+40 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (51): assignPlan(), bindImageUpload(), changeAdminPassword(), closeModal(), closePasswordModal(), createVisit(), _deferUpdatePlansBtns(), deleteMessage() (+43 more)

### Community 5 - "Community 5"
Cohesion: 0.10
Nodes (28): ACCESS_TYPE_LABEL, _allPlans, _allWorkouts, bindDescToggle(), buildCard(), buildPlanCard(), escapeHtml(), fetchJson() (+20 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (24): availableSpots(), buildMiniSession(), buildScheduleCard(), describeDay(), escapeHtml(), formatTime(), getDaySchedules(), getWeekDates() (+16 more)

### Community 7 - "Community 7"
Cohesion: 0.27
Nodes (13): buildCalHtml(), fmtCalDate(), getScheduleDates(), loadSchedules(), pickDefaultScheduleDate(), renderAssignPlanForm(), renderSchedCalendar(), renderScheduleDateStrip() (+5 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (19): attachPhoneMasks(), _buildAdminSvcCard(), deleteClient(), deleteSchedule(), escapeHtml(), formatTime(), getAvatarColor(), getInitials() (+11 more)

### Community 9 - "Community 9"
Cohesion: 0.40
Nodes (5): getFilteredTrainers(), loadTrainers(), openTrainerDetails(), renderTrainers(), setTrainerFeedback()

### Community 10 - "Community 10"
Cohesion: 0.32
Nodes (11): apiFetch(), appendMessage(), enterApp(), escapeHtml(), fetchThreadMessages(), handleAuthFailure(), loadConversations(), openConversation() (+3 more)

### Community 11 - "Community 11"
Cohesion: 0.25
Nodes (7): appendMessage(), closePanel(), escapeHtml(), fetchMessages(), openPanel(), startPolling(), stopPolling()

### Community 12 - "Community 12"
Cohesion: 0.15
Nodes (14): getFilteredMessages(), getFilteredPlans(), getFilteredServices(), getSchedulesForSelectedDay(), getSpecializationList(), normalizeSpecialization(), normalizeText(), renderMessages() (+6 more)

### Community 13 - "Community 13"
Cohesion: 0.33
Nodes (7): _buildBubble(), _loadAndAppendMsgs(), loadChatConversations(), openChatConversation(), renderChatList(), _renderChatWindowShell(), startChatListPolling()

### Community 14 - "Community 14"
Cohesion: 0.20
Nodes (10): addDaysIso(), animateCountUp(), getFilteredClients(), loadDashboard(), renderClients(), renderDashboard(), setMetric(), setTrend() (+2 more)

## Knowledge Gaps
- **126 isolated node(s):** `titles`, `pageRoutes`, `sheetContent`, `clients`, `trainers` (+121 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `apiFetch()` connect `Community 4` to `Community 1`, `Community 2`, `Community 3`, `Community 6`, `Community 7`, `Community 8`, `Community 9`, `Community 13`, `Community 14`?**
  _High betweenness centrality (0.111) - this node is a cross-community bridge._
- **Why does `formatDate()` connect `Community 3` to `Community 1`, `Community 2`, `Community 4`, `Community 6`, `Community 7`, `Community 8`, `Community 9`, `Community 12`, `Community 14`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Why does `requireFreshAuth()` connect `Community 2` to `Community 1`, `Community 3`, `Community 4`, `Community 6`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `titles`, `pageRoutes`, `sheetContent` to the rest of the system?**
  _126 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.052564102564102565 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.02531645569620253 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.058653846153846154 - nodes in this community are weakly interconnected._