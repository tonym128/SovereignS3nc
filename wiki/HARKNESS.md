---
title: "Agent Harkness: Wiki Schema"
tags: ["meta", "schema"]
---

# Agent Harkness: Wiki Schema

This document defines the conventions for maintaining this Knowledge Base.

## Directory Structure
- /raw: Immutable source documents.
- /wiki: LLM-maintained markdown files.
- /wiki/assets: Local images and attachments.
- /wiki/index.md: Content-oriented catalog.
- /wiki/log.md: Chronological activity log.

## Documentation Rules
1. **Persistence**: Every task must be summarized in the Wiki.
2. **Interlinking**: Use [[Page Name]] syntax to connect concepts.
3. **Frontmatter**: Start every new page with YAML frontmatter (title, date, tags).
4. **Sources**: If processing a file from /raw, link it as a source.
5. **No Chitchat**: Maintain a professional, technical tone in the wiki.

## Synthesis Workflow
Upon task completion:
1. Append an entry to wiki/log.md.
2. Update wiki/index.md if a new category or entity is introduced.
3. Update relevant concept pages or create new ones.
