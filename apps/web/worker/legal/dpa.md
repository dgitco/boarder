# Data Processing Agreement

_Last updated: October 29, 2026_

This Data Processing Agreement ("DPA") is part of the [Terms of Service](/policy/terms) between {{OPERATOR}} (ldg@dgit.co), which provides the service ("we", the **processor**), and a customer that uses Boarder for a team or company workspace and processes personal data of others through it (the **controller**). It applies where the GDPR, the UK GDPR or a similar data protection law applies to that processing. If this DPA and the Terms conflict on personal data, this DPA wins.
The processor is registered as {{COMPANY_NAME_EN}}, {{COMPANY_ADDRESS}}, Republic of Korea, business registration number {{BUSINESS_NO}}.

To have a countersigned copy for your records, send your company's legal name and address through the [contact form](mailto:ldg@dgit.co), or to ldg@dgit.co.

## 1. What is processed, and why

- **Subject matter:** providing Boarder: the gateway between your members' AI tools and the services they connect, the secret vault, conversation history, Drive and personal files, memory, agent control, webhooks and the dashboard.
- **Duration:** while the workspace exists, and the deletion periods in section 8.
- **Nature and purpose:** storing and relaying data as your members direct: calling connected services for their AI tools, keeping their sign-ins, keeping history, files and the other data they put in, and the billing and security records the service needs.
- **Data subjects:** your members, and people whose data appears in what your members connect or upload (for example colleagues or customers in a Slack message, an issue tracker, a document or an email).
- **Special categories:** only if your members put them there; Boarder is not designed for them unless an Enterprise contract covers it (section 10).

**Categories of data:**

- account data (name, email, sign-in records);
- connection credentials (stored encrypted);
- data relayed between AI tools and connected services (passed through, not stored);
- conversation history (readable by the server unless a member turns on end-to-end mode);
- Drive files, the text extracted from them and their earlier versions, and mail sent to a Drive folder's address with its attachments;
- personal files and vault values (encrypted on members' devices; we can't read them);
- profile, instructions, skills and memory;
- session board entries (tool, repository, branch, machine, state and up to two short lines of text per session);
- agent control: machines, task prompts, agent output and permission requests;
- webhook events with their bodies;
- clipboard items, until read or 10 minutes pass;
- token usage counts per session, model and hour, with the repository's name;
- audit logs (tool names, times and outcomes, never arguments or results).

## 2. Our duties as processor

We process personal data only on your documented instructions: the Terms, this DPA and what your members do in the service. We tell you if we think an instruction breaks data protection law. We don't sell the data, use it for advertising, or use it to train AI models.

Everyone at Boarder who can access personal data is bound by confidentiality.

## 3. Security

We keep the technical and organisational measures in Annex 1 and may improve them, never reducing their overall protection.

## 4. Sub-processors

You authorise the sub-processors on the [sub-processor list](/policy/subprocessors). We bind each by a written contract with data protection terms at least as protective as this DPA, and we stay responsible for them. We announce a new sub-processor on that page and by email to workspace owners at least 30 days before it starts; you may object on reasonable data protection grounds within that time, and if we can't resolve it, you may end the affected service and get a pro-rata refund of prepaid fees.

## 5. International transfers

We are in the Republic of Korea, which the European Commission has found to protect personal data adequately (Decision (EU) 2022/254); the UK–Korea data bridge does the same for the UK. Data you send us from the EEA or the UK therefore needs no other safeguard to reach us.

Our sub-processors process data in the United States and on Cloudflare's global network. These onward transfers rely on the EU-U.S. Data Privacy Framework (with its UK Extension and the Swiss-U.S. framework) where the sub-processor is certified, and otherwise on the European Commission's Standard Contractual Clauses (Commission Implementing Decision (EU) 2021/914), Module 3 (processor to processor), with the UK Addendum where UK law applies.

Where a transfer from you to us needs the Standard Contractual Clauses after all (for example if the adequacy decision no longer covers it), they are incorporated by reference: Module 2 (controller to processor) when you are a controller, Module 3 when you are yourself a processor. For them:

- Clause 7 (docking clause) applies.
- Clause 9: Option 2, general written authorisation; we give at least 30 days' notice of a new sub-processor, as section 4 says.
- Clause 11: the optional language doesn't apply.
- Clauses 17 and 18: the law and courts of Ireland.
- Annexes I, II and III are those at the end of this DPA.

## 6. Helping you

Taking into account what we can do as processor, we help you answer requests from data subjects (access, correction, deletion, restriction, portability, objection), with data protection impact assessments and with consulting a supervisory authority. Most requests can be handled directly in the dashboard; for the rest, write to ldg@dgit.co.

## 7. Personal data breaches

We notify you without undue delay, and in any case within 48 hours of becoming aware of a personal data breach affecting your data, with what we know then and updates as we learn more, and we take reasonable steps to contain it.

## 8. Deletion and return

You can export or delete data in the dashboard at any time. When the workspace or account is deleted, we delete its data from live systems within 30 days, and it leaves encrypted backups within 12 weeks, unless law requires us to keep it.

## 9. Audits

We make available the information needed to show compliance with this DPA: on request, answers to a reasonable security questionnaire once a year, and our sub-processors' certifications (such as Cloudflare's SOC 2 Type II report under its terms). An on-site audit, or an audit report for Boarder itself, is available under an Enterprise contract.

## 10. Enterprise terms

An Enterprise contract may add or change terms here, such as a SOC 2 Type II report, a HIPAA Business Associate Agreement or data location. Without one, don't process protected health information or payment card data through Boarder.

## 11. Liability

Each party's liability under this DPA is subject to the limits in the Terms, except where the law doesn't allow them.

## Annex I. Parties, description and competent authority

**A. List of parties**

- **Data exporter:** the customer, as named when it signs or accepts this DPA (name, address, contact person and email as it gives them). Role: controller (or processor for its own customers). Activities: using Boarder for its workspace. Signature and date: on signature or acceptance of the Terms.
- **Data importer:** {{OPERATOR}}, Republic of Korea. Contact: ldg@dgit.co. Role: processor (sub-processor where the exporter is a processor). Activities: providing Boarder as section 1 describes. Signature and date: on the countersigned copy, or on the exporter's acceptance.
- **Data importer's details:** {{COMPANY_NAME_EN}}, {{COMPANY_ADDRESS}}, Republic of Korea; represented by {{REPRESENTATIVE}}.

**B. Description of the transfer:** the data subjects, categories of data, special categories, nature and purpose are in section 1. Frequency: continuous, while the workspace is used. Retention: as in section 8 and the [Privacy Policy](/policy/privacy). Transfers to sub-processors: for the subject matter, nature and duration in section 1, as the sub-processor list describes.

**C. Competent supervisory authority:** the supervisory authority competent for the data exporter under Clause 13 of the Standard Contractual Clauses.

## Annex II. Technical and organisational measures

These are the measures in Annex 1 below.

## Annex III. Sub-processors

The sub-processors on the [sub-processor list](/policy/subprocessors), as it stands when the transfer happens.

## Annex 1. Technical and organisational measures

- **Encryption in transit:** HTTPS (TLS) for every connection to and from the service.
- **Encryption at rest:** connected services' sign-ins are sealed with a per-account key on the server. The secret vault, personal files, and conversation history in end-to-end mode are encrypted on your members' devices with a key only their devices hold, so the server stores ciphertext and can't read them. Everything else — conversation history by default, Drive files and their extracted text, mail to Drive, profile, memory and skills, session board entries, agent tasks, webhook events, clipboard items, usage counts and account data — is readable by the server so the service can work, and encrypted at rest by Cloudflare.
- **Access control:** passkeys and email codes for sign-in; sensitive actions (approving a device, granting an app access, managing passkeys, reading production secrets) re-confirm with a passkey; device and app tokens can be revoked at once; tokens and recovery codes are stored hashed.
- **Least data:** the audit log records tool names, times and outcomes, never arguments or results; data relayed to connected services isn't stored; key-shaped text is masked in history, memory, session lines and agent output before it's stored.
- **Infrastructure:** Cloudflare (Workers, D1, R2, Durable Objects), which holds SOC 2 Type II, ISO 27001, ISO 27701 and PCI DSS certifications. Production access is limited to the Boarder team.
- **Resilience:** encrypted daily backups kept up to 28 days, weekly ones for 12 weeks.
- **Abuse limits:** rate limits per account and per address.
- **Testing:** automated tests and end-to-end checks of sign-in, approvals and access rules before changes ship.
