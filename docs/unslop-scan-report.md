# Unslop Documentation Scan — Findings Report

**Date:** 2026-11-19
**Tool:** unslop (`tools/unslop`, cloned from github.com/OPSHARP/unslop)
**Scanners:** `banned_phrase_scan.py`, `structure_scan.py --genre docs`, `silhouette_scan.py`
**Scope:** 6 Markdown documents (backend/dev-staff-accounts.local.md excluded — local credential notes)
**Raw data:** `tools/unslop_scan_results.json`

## Summary

| Document | Phrase violations | Structure flags | Silhouette penalty (flag ≥ 1.0) |
|---|---|---|---|
| README.md | 0 | none | **21.0** ⚠️ |
| admin/README.md | 0 | none | **10.2** ⚠️ |
| docs/research/payment-patterns-teardown.md | 0 | none | **9.4** ⚠️ |
| payment-providers-teardown.md | 0 | none | **5.0** ⚠️ |
| docs/governance/sop-gap-assessment.md | 0 | opener_repetition (soft) | **4.7** ⚠️ |
| mobile/README.md | 0 | none | **3.9** ⚠️ |

## Layer 1 — Phrase scan: all clean

Zero banned-phrase hits across every document. No AI-tell phrases ("let's dive in", "delve", significance inflation, chatbot residue, etc.). The surface wording of the docs is good.

## Layer 2 — Structure scan: one soft flag

- **docs/governance/sop-gap-assessment.md — opener_repetition (soft).** Top sentence opener holds 29.2% of starts with 4 consecutive identical openers. The scanner itself notes that step-by-step docs may legitimately repeat imperative openers — this is an SOP/gap-assessment table-heavy document, so this is most likely a genre false positive. Judgment call: leave unless the prose sections read monotonously.

Everything else is clean: no triads, no connective paragraph scaffolding ("However,/Moreover,"), no staccato runs outside tolerance, no em-dash overuse, no moralizing codas.

## Layer 3 — Silhouette scan: all six documents flagged (soft)

Every document exceeds the composite `silhouette_penalty` threshold of 1.0. The dominant driver in five of six is **callback_content** — the ending reuses the opening's vocabulary, i.e. the doc closes by restating the intro. Secondary driver in the READMEs is **heading_preview** — section headings restate the intro's outline.

| Document | Penalty | Main driver | Value |
|---|---|---|---|
| README.md | 21.0 | callback_content | 4.0 (human fence 0.3) |
| admin/README.md | 10.2 | callback_content + preview_fulfillment | 1.5 / 0.25 |
| docs/research/payment-patterns-teardown.md | 9.4 | callback_content | 1.632 |
| payment-providers-teardown.md | 5.0 | callback_content | 0.972 |
| docs/governance/sop-gap-assessment.md | 4.7 | mixed (heading_preview, callback, preview) | — |
| mobile/README.md | 3.9 | callback_content | 0.571 |

**Interpretation (important):** silhouette flags are *soft* by design — unslop's own doctrine says scanners propose candidates and a human checks context. A README that opens with "this repo contains X, Y, Z" and ends with a summary will always trip callback_content; symmetric intro→sections→recap is a legitimate docs convention. These flags indicate the docs follow the standard "overview → body → recap" template, not that the prose is defective.

## Recommendations

1. **No action needed on wording** — phrase and structure layers are effectively clean.
2. **Optional tightening, in priority order:**
   - `README.md` (21.0): the closing section largely restates the intro. Ending on a concrete final point (e.g. a quickstart link or status note) instead of a recap would drop the penalty sharply.
   - `admin/README.md` and `mobile/README.md`: same pattern, smaller scale.
   - The two teardown docs: mild recap loops in their conclusions; low priority since analytical docs conventionally summarize findings.
3. **Re-scan after edits** with `python tools/scan_docs.py` to confirm penalties drop.

## Reproduce

```
python tools/scan_docs.py    # writes tools/unslop_scan_results.json
```
