-- BUILD_READINESS_QUESTIONNAIRE.md H01/H02: each export package contains
-- three files (PROJECT_CONTEXT.md, EVIDENCE_INDEX.md, EXPORT_MANIFEST.md),
-- not one. project_exports.content already holds PROJECT_CONTEXT.md;
-- add the other two as their own immutable columns on the same
-- versioned row rather than a second table, since all three are always
-- generated and read together as one package.

alter table public.project_exports
  add column evidence_index_content text not null default '',
  add column export_manifest_content text not null default '';
