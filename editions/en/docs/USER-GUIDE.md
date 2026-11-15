# User guide

This guide follows the English interface. Choose the desktop installer or source run mode in the [README](../README.md). See the [desktop guide](DESKTOP.md) for installer build status, data locations and startup. The current service accepts loopback access on its host computer only. Multiple accounts do not imply that access from other computers or the internet is already supported.

## 1. Create local accounts

The sign-in page offers **Login** and **Register**. Registration asks for a display name, username, password and confirmation. Usernames contain 3–40 ASCII letters, numbers, periods, underscores or hyphens; passwords contain 12–256 characters. A mismatched confirmation is rejected before a registration request is sent.

The first successful registration creates a workspace administrator; later registrations create members. The server determines the role at registration time, including when two people register concurrently. Successful registration signs the account in automatically. Administrators can also create accounts in **People & Agents**.

Accounts are stored on the computer hosting the service. Passwords are stored as individually salted hashes. No email, third-party identity or cloud signup is required. Registration does not verify capabilities or grant execution permissions.

| Role | Responsibilities and controls |
| --- | --- |
| All members | View shared goals and public state, create goals, submit their own knowledge and capability claims |
| Goal owner or administrator | Assign work at permitted stages, manage goal execution and independently review other people's ordinary deliverables |
| Assigned member | Accept, start, update and submit their own tasks when requirements are met |
| Administrator | Manage accounts, verify capabilities, grant execution permissions separately and configure models |

A submitter cannot independently approve their own ordinary deliverable. A dedicated approval task must also be handled by its assigned reviewer.

## 2. Turn a goal into shared tasks

In **Organization workspace**, select **New goal** and enter the title, context and acceptance criteria. Use observable criteria, such as “Every recommendation names its source, owner, deliverable and validation method.”

The default template contains goal analysis, plan drafting, quality review, human approval and a retrospective. It is an explicit workflow template, not a claim of automatic organizational planning. Optional custom steps can define other dependencies. Each `depends_on` references a step `key` in that workflow; dependency cycles are rejected.

Members see the same organizational goals and public task states. Their action buttons differ according to role, assignment and task phase.

## 3. Assign a named member or Agent

A goal owner or administrator selects **Assign task** or **Reassign** directly in the task row. Search by name, responsibilities or provider type, or switch between All, Members and Agents.

The roster includes every account-linked member and registered Agent. The selected provider's panel shows requirements such as capability registration and verification, execution permission, availability, risk and type restrictions, dependencies, and relevant Agent budget or model conditions.

- Assign responsibility before qualification is complete when useful.
- Assignment does not verify a capability, grant permission, activate an inactive member or substitute another provider.
- Unmet requirements remain visible next to the assigned task; execution is still blocked until they are resolved.
- A task that is already running, awaiting review, completed, paused or part of the original workflow may not permit reassignment. The interface explains why.

Members can accept only tasks assigned to themselves. An authorized owner opens **Run overview** to initiate an Agent step; selecting an Agent does not automatically run it.

## 4. Accept, work and update progress

| State | Next action |
| --- | --- |
| Unassigned | The owner chooses a provider |
| Assigned | The assigned member selects **Accept task** once requirements are met |
| Accepted | The member selects **Start work** |
| In progress | Update public progress, publish interim work and submit the deliverable when ready |
| Awaiting review | Another authorized person reviews the work or returns it for revision |
| Completed | Hand off a published result where appropriate and follow the downstream task |

Public progress is visible to everyone; do not paste private material into it. Progress stays within 0–99% before completion and reaches 100% after review. Generated text, uploaded attachments and published updates do not independently establish approval.

Use **Task board**, **Deliverables & handoffs** and **Activity** to review responsibilities, published work and process records. The synchronization indicator shows connection state. Normal polling occurs about every two seconds.

## 5. Publish updates and additional materials

**Publish update** records work direction, stage, completed work, next steps and information needed. Each update supports up to 10 attachments, each no larger than 32 MiB.

Supported formats include common images, MP4/WebM video, PDF, text, Markdown, CSV, JSON, ZIP and selected Office document formats. Images and supported videos can be previewed; other files are downloaded. HTML and SVG are not rendered as uploaded web content.

Uploads are staged and visible only to the uploader until **Publish to organization** is selected. Publication shares that update and its chosen attachments. Existing private knowledge documents are not automatically made public. Publish a new update for additional material so earlier versions remain traceable.

## 6. Submit, review and hand off

**Submit deliverable** sends the actual completed text and evidence for review. The original content is access-controlled for the submitter, goal owner and administrator; submission is separate from publication to the organization. Authorized downstream assignees can also receive completed prerequisite outputs as task context. This does not grant access to private knowledge documents or unreviewed submission histories.

Another authorized person independently reviews an ordinary deliverable. A return should identify specific gaps; the assignee continues work and resubmits. A dedicated approval node uses **Independent review**, with rationale and a decision from its assigned person.

After an upstream task is completed and has a published update, use **Hand off deliverables** or **Hand off to the next person**. Choose a version and a directly dependent task assigned to a member, then explain the next steps. The server derives the recipient from that downstream assignment.

The recipient can **Receive materials** and confirm receipt, or return them for more information. **Receipt acknowledges materials only. It does not reassign, start or complete tasks, and it does not bypass other dependencies.** Rework, a newer source result or downstream reassignment may invalidate an older handoff; the history remains visible with an explanation.

## 7. Knowledge, capabilities and Skills

In **Knowledge**, import `.md` or `.txt` files, or paste text. Imports are snapshots, not automatic synchronization with the original file. Personal and organizational documents have different visibility and editing rules.

In **My capabilities**, describe your experience, choose a capability, self-assess at L1–L5 and quote evidence that appears exactly in the source. Levels describe proficiency, not permission. A self-report or keyword suggestion is not certification. An administrator verifies the claim and separately grants execution permission.

**Capability catalog** accepts Markdown and JSON capability packages. Parse and preview first, complete the name, description, inputs, outputs and acceptance criteria, then register. A human package creates a claim awaiting verification; an Agent package records a declaration. Uploading does not execute its instructions, install dependencies or connect tools.

## 8. Model settings and Agent execution

An administrator opens **Model settings** and enters the connection type, compatible protocol, API base URL, model name and any required key. Do not append `/chat/completions` or `/messages` to the base URL.

**Test current connection** tests the draft. Select **Save and activate** to apply it. Status distinguishes not configured, unavailable, configured but not tested, test passed and test failed. Keeping, replacing or removing a saved key is explicit; an endpoint or protocol change cannot silently retain the old key.

Tests send fixed text. Actual Agent work sends the material required for the task to the configured service. Budgets count Agent attempts. Human collaboration remains available without a model; an unavailable Agent connection reports failure rather than silently substituting a simulated model answer.

## 9. Conflicts, disconnection and local data

When someone changes a task while you are editing, the draft is preserved. On a version conflict, load the latest version, compare the current state and decide whether to resubmit. Changes are not silently overwritten. During disconnection, the last data stays visible and writes pause until synchronization resumes.

For source runs, stop the service before backing up the full `data/workspace/` directory, including databases and attachments. Desktop runs use a separate AppData workspace described in the [desktop guide](DESKTOP.md). Do not publish that directory. Moving encrypted model credentials to another computer or Windows account may require entering the key again. Preserve needed work data separately before deleting the source package.

See [LICENSE](../LICENSE) and [LICENSING.md](../LICENSING.md) for use and modification terms.
