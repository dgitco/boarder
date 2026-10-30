# Privacy Policy

_Last updated: October 29, 2026_

This policy explains what Boarder collects, why, on what legal basis, and what control you have. It covers the hosted gateway at boarder.dgit.co and the `boarder` command-line tool. 한국어: [개인정보 처리방침](/policy/privacy-ko), with the items Korean law asks for.

## Who we are

We are {{OPERATOR}} (ldg@dgit.co), and we run the service from the Republic of Korea ("we", "us"). We decide how the personal data described here is used, so for it we are the controller.
Registered as {{COMPANY_NAME_EN}}, {{COMPANY_ADDRESS}}, Republic of Korea. Business registration number {{BUSINESS_NO}}. Representative: {{REPRESENTATIVE}}.
Privacy questions and requests go to ldg@dgit.co; anything else to ldg@dgit.co or our [contact form](mailto:ldg@dgit.co).

When a team or company uses Boarder for its workspace, it decides about the data of its members and of the people in what they connect or upload; there we process that data for it, under the [Data Processing Agreement](/policy/dpa).

## What we collect

**Account.** Your email address. If you sign in with Google or GitHub, also your name, profile picture and the account ID the provider shares. We do not receive your Google or GitHub password.

**Sign-in records.** Sessions and how each was signed in, one-time sign-in codes (kept until they expire or are used), device tokens for the `boarder` tool (stored only as a hash), and the apps you authorize, with their consent records and access tokens. If you add a passkey: its public key, name and device type (the private key never leaves your device), and your recovery codes, stored only as hashes. When a machine asks to sign in with your email: a hash of the email, the machine's name and system, and the country, until the request expires.

**Connected services.** For each service you connect: its address, the label you give it, the projects you limit it to, and the OAuth tokens the service issues (or the API key you give for an API connection) so Boarder can act for you. These are stored encrypted in storage dedicated to your account and used only to make the requests your AI tools ask for; an API key is never shown to those tools or back to you.

**Projects.** The repositories you set up as projects and which connections each one uses. If you connect the Boarder GitHub App, a token that lets Boarder list the repositories you chose when installing it (names, visibility and last push; not their contents), stored encrypted.

**Secrets vault.** If you use it: the names of your values, the repo and environment each belongs to, whether it's a secret or a plain variable and whether it's switched on, notes you add (encrypted like the values), and the values themselves encrypted on your device. The key that opens them stays on your devices; we never receive it, so we can't read the values. If you turn on passkey unlock, we also keep a copy of that key encrypted with your passkey, which only your passkey can open. We also keep short-lived records of approvals you give (a device using production values, a new device receiving your vault key).

**Conversation history.** Only if you turn it on with `boarder history on`: your conversations with AI tools on that machine (Claude Code, including the Claude app's Code tab, Codex, Gemini CLI, Grok and Cursor) — your messages, the agents' replies, and questions the agents asked you with your answers; not the tools they ran or their output — with the folder, repository, device name and times. Values from your vault and text shaped like keys or tokens are masked on your machine before upload. By default the text is stored so the server can read it, so your coding agents can search it through Boarder, and chat apps such as Claude and ChatGPT only if you turn on the chat history setting in the dashboard (off by default, and never for a connector directory listing). End-to-end mode is optional: with `boarder history mode e2e` the text is encrypted with your vault key on your machine, we store only ciphertext and the metadata, and only your devices can search it. Exclude repositories, delete a session, or delete everything at any time (`boarder history exclude`, `boarder history forget`).

**Chat checkpoints.** If you ask a chat app or a coding agent to save a summary of a conversation (`bridge__session_save`), the title, summary and any messages it sends are stored with your history, with text shaped like keys masked.

**Session board.** If its hooks are on (`boarder sessions on`, or `boarder history hooks on`): for each coding session, the tool, session id, state, repository, branch, the last two parts of the folder path, the machine's name, a title and up to two short lines of text (your prompt's first line, the agent's notice, the last line of its answer), with values from your vault and text shaped like keys hidden. The server can read them. With end-to-end history no title or lines are kept. Finished sessions go after a day (idle ones after 3 days, anything after 7).

**Token usage.** If history or `boarder usage on` is on: token counts per session, model and hour, with the tool, the machine's name and the repository's name. Counts only, never prompts or answers. They stay readable by the server even with end-to-end history, so it can add them up.

**Profile, instructions, skills and memory.** If you use `boarder context` or `boarder memory`, or add them on the dashboard: your profile, global instructions, skills and the short notes your AI tools save for you. Unlike your vault, these are stored so the server can read them, because chat apps have to read them to use them; text shaped like keys is masked when saved. A short excerpt of your profile is sent to chat apps as connector instructions unless you turn that off.

**Agent control.** Only if you turn on agent control in the dashboard and on a machine with `boarder agent on`: the machines you connect (name, system and the repositories you allowed), the tasks you start (the agent, the repository, a title and the state), the prompts you send, what the agent prints and its permission requests, kept for the task page (at most 500 events or 256 KB per task), with text shaped like keys masked. The server can read them.

**Webhooks.** If you set up a webhook: the events services send to its address, with their bodies, so they can be routed and your AI tools can read them. The server can read them; they aren't sealed. For a webhook that runs a command on your machine, we get back only the exit code, how long it took and a short reason; the command and its output stay on your machine. Forward secrets and Routine tokens are stored sealed.

**Clipboard.** What you send with `boarder clip` or paste on the dashboard's Clipboard page (an image, files or text), until an agent reads it or 10 minutes pass. The server can read it.

**Notifications.** If you set an ntfy topic or a notification email: the topic or address, and which notifications you turned on. A notification carries a title such as a task's state or a session's one-line notice and a link to the dashboard.

**Drive files.** Files you or your AI apps save to Drive: their content, path, size, type and times, who saved each version and through what (the dashboard, the CLI or which app), and earlier versions so you can restore them. The server can read them, because AI apps search and read them through Boarder; they're stored encrypted at rest by our hosting provider and reachable only from your account, or by members of a team workspace you put them in. To make PDFs, Office files and images searchable, their text is extracted with Cloudflare Workers AI and stored with the file. Files are scanned for things like resident registration, card and account numbers to warn you; the scan's result (the kind and a masked sample) is stored with the file. Changes that AI apps propose to a folder's instructions are kept until the owner or an admin applies or rejects them.

**Mail to Drive.** Only if you give a Drive folder an email address: the messages sent to it (sender, recipients, subject, date, the result of our authentication checks, the text and attachments). Accepted mail is saved as files in that folder, and the sender gets a short receipt. Mail that isn't accepted right away waits in the Inbox for up to 14 days and is then rejected. The original message is kept for 30 days.

**Personal files.** Only if you use `boarder files`: files you choose to sync between clones of a repository (such as AGENTS.local.md). They are encrypted with your vault key on your machine; we store the ciphertext, the repository and path, size, device name and time of each version, and the last 50 versions of each file. We can't read them.

**Billing.** If you buy a paid plan: the plan and product, its state and period, and Polar's customer and subscription IDs. Before a trial turns paid or a price goes up, the answer an owner gives: who, when, the price and seats, and where in the dashboard; it's kept with the workspace, and the account is unlinked from it if deleted. Card details and invoices are with Polar, not us.

**Product updates.** Only if you turn on product updates by email in Settings (off by default): that choice, when you turned it on or off, and which updates were sent to you.

**Feedback and early access.** Reports you or your AI tools send us (the dashboard's Feedback button, `boarder feedback`, `bridge__feedback`): what's written in them, the versions, page, browser or log lines you choose to include, where each came from and when, with text shaped like keys masked before it's stored; we're emailed a copy. If you join team early access: your team's name and size, the AI tools it uses, what you'd like to do and a work email if you give one, until you withdraw it.

**Messages to us.** What you send through the [contact form](mailto:ldg@dgit.co), with or without an account: the topic, your email address, the name and company if you give them, and your message, with text shaped like keys masked before it's stored; we're emailed a copy so we can reply. If you're signed in, the message is linked to your account and the reply goes to its address.

**Usage records.** Security and audit logs: sign-ins, token and connection changes, and which tool was called on which connection, when, and whether it succeeded. We do not store the arguments or results of tool calls.

**Technical data.** IP address, user agent and request metadata that our hosting provider processes to deliver and protect the service.

**Page views.** Cloudflare Web Analytics counts visits to boarder.dgit.co pages (the page, the referring site, country, browser and load time). It sets no cookies and doesn't identify you across sites.

**Product analytics in your browser.** PostHog counts the pages you view on boarder.dgit.co and in the dashboard. Until you choose, and if you reject analytics cookies, it does so without cookies or anything else stored on your device, without what you click, and without linking the views to you or your account. If you accept, it uses a cookie that recognizes your browser when you come back, records on the public pages (not sign-in or the dashboard) what you click, and sends errors that happen in your browser and how fast pages load; in the dashboard the views are linked to your account ID, never your email or name. It never records what you type or what's on the screen: no session recordings. See [Cookies](/policy/privacy#cookies).

**Tool-call and product analytics from our server.** Whatever you chose about cookies, our server tells PostHog about the use of Boarder, linked to your account ID; nothing is stored on your device for it. When an AI tool calls a tool through your Boarder: the tool's name, the service it belongs to (for example "linear"), the kind of app that called it (for example "Claude Code"), how long it took and whether it worked. Never the arguments, the results or anything from your services. And steps in using Boarder: signing up and in, connecting the CLI, an app or a service (its name only), creating a project, a workspace or a trigger, inviting someone, and a team subscription's state. You can object to this (see [Your rights](/policy/privacy#your-rights)).

## Google user data

If you connect a Google service (such as Google Calendar), Boarder signs in to it with its own Google app and asks only for the access that service's tools need — for Google Calendar, viewing and editing your events, viewing your list of calendars, and creating new calendars (and managing only the ones it created). With that access, Boarder only carries out the requests your AI tools make through your Boarder account (for example, list today's events or create an event) and returns the result to that tool. The event data is relayed, not stored; the OAuth tokens are stored encrypted, as for any connected service.

We do not use Google user data for advertising, do not sell it, do not use it to train AI models, and do not let people read it, except with your permission for a specific request (such as support), for security, or when the law requires it. We do not transfer it to anyone else except to provide the features described here.

Boarder's use and transfer of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. You can remove Boarder's access at any time by disconnecting the service in Boarder or at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## What we don't collect

- The content passing between your AI tools and your services is relayed, not stored.
- The `boarder` tool's local data — your manifest, synced configs and backups — stays on your computer. Your vault key and secrets referenced by local tools are kept in your operating system's keychain; vault values leave your computer only encrypted.
- We do not sell personal information, use it for advertising, or use your data to train AI models.

## How we use it

To sign you in, keep your connections working and carry out what you ask of the service, protect the service against abuse, show you your own activity, understand how Boarder is used so we can improve it, and contact you about your account or changes to the service. If you turn on product updates, we also email you what's new in Boarder, about once a month; every one has a one-click unsubscribe. We don't send marketing email otherwise.

## Legal bases

Where the GDPR or the UK GDPR applies, we rely on:

- **Contract** (Art. 6(1)(b)): providing what you signed up for — your account and sign-in, connections, projects, the vault, history, the session board and usage, profile and memory, agent control, webhooks, the clipboard, Drive and personal files, notifications you set up, and billing.
- **Legitimate interests** (Art. 6(1)(f)): keeping the service and its users safe (security, abuse prevention, rate limits, audit logs), answering messages and feedback, and understanding how Boarder is used through the tool-call analytics from our server and Cloudflare's cookieless page counts and PostHog's cookieless page views. You can object to these at any time.
- **Consent** (Art. 6(1)(a)): analytics cookies, and product-update emails. You can withdraw it at any time, as easily as you gave it, without affecting what happened before.
- **Legal obligations** (Art. 6(1)(c)): keeping the records tax and consumer law require, and answering lawful requests from authorities.

## Cookies

We use cookies and browser storage only for what's listed here. Change your choice at any time with the **Cookie settings** button below, signed in or not; in the dashboard it's also in the account menu.

[Cookie settings](#cookie-settings)

- **Strictly necessary (always on):** the sign-in session cookies (one for each account signed in in the browser), a short-lived cookie while you connect GitHub, and in your browser's local storage your cookie choice, your light or dark theme and a few dashboard layout preferences. Without them the site can't sign you in or remember these settings.
- **Analytics (only if you accept):** PostHog's cookie (`ph_…_posthog`) and its local storage, which recognize your browser when you come back, and PostHog's record that you accepted. Off until you choose Accept. Rejecting, or a browser that sends Do Not Track or Global Privacy Control, keeps them off; PostHog then only counts page views without storing anything. When you change your choice to Reject, we remove what PostHog stored.

Cloudflare Web Analytics and the analytics from our server store nothing on your device.

## Who processes it

- **Cloudflare** hosts the service (Workers, Durable Objects, D1, R2), extracts text from Drive files (Workers AI), receives mail sent to Drive folders (Email Routing), sends our emails (sign-in codes, security notices, the notifications and product updates you turn on) and counts page views (Web Analytics).
- **PostHog** (United States, PostHog US Cloud) receives the product analytics described above.
- **Polar** (United States) handles payment for paid plans as the merchant of record; card details go to its payment processor (Stripe), not to Boarder.
- **Google** and **GitHub**, only if you choose to sign in with them.
- **ntfy.sh** (or the ntfy server you set), only if you set an ntfy topic for notifications: it receives the notifications you turned on. You choose it; it acts under its own terms.
- **Services you connect** receive the requests your tools make through Boarder, under their own privacy policies.

The current list, and the Data Processing Agreement for teams and companies, are at [Sub-processors](/policy/subprocessors) and [DPA](/policy/dpa).

We disclose data to others only when the law requires it or to protect the service and its users.

## International transfers

We are in the Republic of Korea, and our providers process data in the United States and on Cloudflare's global network. For data from the EEA, the European Commission has decided that Korea protects personal data adequately (Decision (EU) 2022/254); for data from the UK, the UK–Korea data bridge does the same. Our US providers receive it under the EU-U.S. Data Privacy Framework (and its UK Extension) where they are certified (Cloudflare and PostHog), and otherwise under the European Commission's Standard Contractual Clauses (Polar). Ask us at ldg@dgit.co for a copy of the safeguards.

## How long we keep it

Account data is kept while your account exists. Audit logs are kept for 90 days. Codes, sessions, tokens and approval requests stop working when they expire or are revoked. Vault values are kept until you delete them. App tokens you create expire on the date you chose, at most a year. Conversation history, Drive files, personal files, profile, memory and skills are kept until you delete them; a deleted Drive file's earlier versions stay, so it can be restored, under the rule that follows. Earlier versions of a Drive file are kept for 30 days, and the newest 20 of each file longer, within your plan's storage; a file's content and the text extracted from it go when no file or version uses them, attachments of mail that was accepted or rejected included. Mail waiting in a Drive Inbox is rejected after 14 days, and original messages are deleted after 30. Webhook events are kept 7 days by default (up to 30 if you choose). Clipboard items go when read or after 10 minutes. Session board entries go after one to 7 days, as above. Token counts are kept 400 days. Agent task events are kept with the task, within the limits above, and tasks on machines you remove are deleted. Feedback reports are kept while your account exists. Messages sent through the contact form are kept as our correspondence with you; ask us and we'll delete them. Product analytics are kept in PostHog under our project's retention settings. When you delete your account, we delete your account data, connections, stored tokens, vault, conversation history, usage, webhooks and their events, your personal Drive, personal files, profile, memory, skills, the session board, agent data, the billing records of workspaces only you are in, feedback and early-access request (copies already emailed to us stay in our support inbox); contact form messages are kept without the link to your account. Encrypted backups of the service are kept for up to 28 days (weekly ones for 12 weeks), so deleted data leaves them within that time. Polar keeps its payment and invoice records as the law requires of it.

## Your rights

You can ask us to:

- **access** the personal data we hold about you, and get a copy;
- **correct** it;
- **delete** it;
- **restrict** how we use it;
- **port** it: get what you gave us in a common machine-readable format, or have it sent to another service;
- **object** to what we do on the basis of legitimate interests, including the analytics from our server;
- **withdraw consent** you gave (analytics cookies, product updates) at any time.

Much of this you can do yourself: disconnect a service, revoke an app or device token, or remove a passkey or vault value with `boarder` or the web dashboard; turn product updates off in Settings or with the unsubscribe link in any of them (no sign-in needed); change your cookie choice with Cookie settings (under [Cookies](#cookies), or the dashboard's account menu); delete your account in the dashboard (Settings → Delete account). For anything else, write to ldg@dgit.co or use the [contact form](mailto:ldg@dgit.co). We answer within a month (in Korea, within 10 days), and may ask you to confirm it's you.

If you think we've handled your data wrongly, tell us first if you can. You can also complain to a supervisory authority: in the EU or EEA, the one where you live or work ([list of the EDPB's members](https://www.edpb.europa.eu/about-edpb/about-edpb/members_en)); in the UK, the [Information Commissioner's Office](https://ico.org.uk); in Korea, the Personal Information Protection Commission ([privacy.go.kr](https://www.privacy.go.kr)) or its Privacy Infringement Report Center ([privacy.kisa.or.kr](https://privacy.kisa.or.kr), call 118). The [개인정보 처리방침](/policy/privacy-ko) lists Korea's other remedies.

## Security

Connections use HTTPS. OAuth tokens for your connected services are encrypted at rest with a key per account. Device tokens and recovery codes are stored hashed, access tokens can be revoked immediately, vault values and personal files are end-to-end encrypted (and history too, if you choose end-to-end mode), everything else is encrypted at rest by our hosting provider, and access to production systems is limited to us.

## Children

Boarder isn't meant for children under 14, and we don't knowingly collect their data. If you think a child has given us data, tell us and we'll delete it.

## Changes

We will post changes to this policy on this page and update the date above. Material changes will be announced before they take effect.

## Contact

ldg@dgit.co for privacy, ldg@dgit.co otherwise, or the [contact form](mailto:ldg@dgit.co).
