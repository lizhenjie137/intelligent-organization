---
name: Extract needs from interviews (human capability example)
description: Extract traceable needs from supplied interview notes, separating participant quotes, analyst interpretations and open questions. This format example does not establish the uploader's proficiency.
version: 1.0.0
provider_type: human
---

## Inputs

Provide the interview purpose, relevant participant context, source-numbered notes, and the permitted scope of use. Identify gaps in incomplete notes rather than inventing statements the participant did not make.

## Outputs

A needs register with an ID, description, supporting quote and source ID, analyst interpretation and open questions for each need. List conflicting statements and proposed follow-up questions separately.

## Acceptance

Every need is traceable to the supplied material. Quotes and interpretations are clearly separated. Unconfirmed claims and important conflicts remain visible. A single preference is not generalized to all users. The goal owner reviews each deliverable.

## Instructions

1. Confirm the question and permitted data scope.
2. Assign stable source IDs without changing the original meaning.
3. Record needs, current practices, pain points and constraints separately.
4. Group similar statements while preserving every source.
5. Flag conflicting, ambiguous or unsupported interpretations.
6. Check the needs register against the acceptance criteria and submit it for review.

## Limitations

Use only authorized internal research material. This capability does not replace market sizing, architecture decisions or external commitments. Report missing evidence instead of inventing quotes. Uploading this package creates a capability claim; proficiency requires work evidence, contribution details and administrator review.

## Examples

Input: In fictional interview T-01, a participant says: "Every Monday I manually merge progress from two spreadsheets. It takes about half an hour."

Output: Need R-01: Reduce repeated work when combining weekly progress sheets. Source: T-01 quote. Interpretation: Merging the sheets may be repetitive; suitability for automation is not established. Verify: field definitions, data permissions, exceptions and current error rates.

This is a fictional format example, not an actual employee deliverable or verification record.

## Tools

- Text editor
- Spreadsheet editor (optional)
