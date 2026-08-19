# Counter Tracker — Bot specification

**Archetype:** custom

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot for tracking personal and shared counters in groups. Users can create, manage, and adjust counters via buttons, with shared counters controlled by admins. All changes are instantly visible and logged for transparency.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- small-to-medium Telegram groups
- habit trackers
- occurrence counters

## Success criteria

- users can create and manage personal counters
- admins can manage shared counters
- all counter changes are instantly visible in list views
- admin notifications are sent for shared counter changes

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu and onboarding explanation
- **My counters** (button, actor: user, callback: list:personal) — Show list of personal counters
- **Shared counters** (button, actor: user, callback: list:shared) — Show list of shared counters
- **Create counter** (button, actor: user, callback: create:counter) — Start counter creation flow

## Flows

### counter_creation
_Trigger:_ create:counter

1. show creation options
2. validate admin rights for shared counters
3. create counter with name and type

_Data touched:_ Counter

### counter_adjustment
_Trigger:_ adjust:counter

1. show adjustment buttons
2. apply delta or set value
3. update counter and log event

_Data touched:_ Counter, Event log

### counter_rename_delete
_Trigger:_ rename:counter

1. show confirmation
2. rename/delete counter
3. log event

_Data touched:_ Counter, Event log

### admin_notification
_Trigger:_ counter_change

1. format notification message
2. send to ADMIN_CHAT_ID

_Data touched:_ Admin list

## Owner-supplied settings

The OWNER provides these; they are collected in chat and injected into the environment at deploy. Read each one from the environment where it is used (`ctx.env.<KEY>` / `env.<KEY>` on Cloudflare Workers; `process.env.<KEY>` only as a Node/harness fallback — never the sole read). Do NOT invent your own way of learning the value, do NOT ask for it in a bot message, and do NOT hardcode a default.

- **ADMIN_CHAT_ID** — where admin notifications for shared counter changes are sent
  - this is the OWNER's own chat id; the platform already knows it. Read `ADMIN_CHAT_ID` via `ctx.env` (prefer toolkit `adminChatId` / `requireOwner`) — never ask a user, never treat whoever writes first as the admin, never invent claim-admin or open manage for everyone.
  - may be UNSET at runtime: the bot must still start, and the feature needing ADMIN_CHAT_ID must say so plainly instead of failing.

Your behavioral specs run WITHOUT these values, so no spec may depend on one.

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

An entity that merely NAMES an owner-supplied setting above (an admin chat, an API account) is not something to store or discover — read it from the environment.

- **Counter** _(retention: persistent)_ — A named counter with value and metadata
  - fields: id, name, type, current_value, creator_id, created_at, last_modified_at
- **Event log** _(retention: persistent)_ — Record of all counter changes
  - fields: counter_id, delta, new_value, user_id, timestamp
- **Admin list** _(retention: persistent)_ — Telegram user IDs with permission to modify shared counters
  - fields: user_id

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- edit admin list
- view recent events
- configure ADMIN_CHAT_ID

## Notifications

- admin notifications for shared counter creation, rename, delete, and value changes

## Permissions & privacy

- only admins can modify shared counters
- personal counters are private to the owner
- event logs are append-only and visible to admins

## Edge cases

- non-admin users attempting to create shared counters
- deleting a counter with a long history
- renaming a counter with duplicate name

## Required tests

- verify personal counter creation and adjustment
- verify admin-only shared counter management
- verify event logging and admin notifications
- verify UI flows for all counter actions

## Assumptions

- counters are global across all chats
- admins include owner and Telegram chat admins by default
- ADMIN_CHAT_ID is provided by the owner
