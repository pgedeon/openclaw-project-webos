-- Migration 010: Harmonize service catalog with business operations plan
-- Adds business-facing service rows while preserving legacy service entries.

-- Link exact slug matches to workflow templates where possible.
UPDATE service_catalog sc
SET workflow_template_id = wt.id,
    metadata = jsonb_set(COALESCE(sc.metadata, '{}'::jsonb), '{workflow_template_name}', to_jsonb(wt.name), true),
    updated_at = NOW()
FROM workflow_templates wt
WHERE sc.workflow_template_id IS NULL
  AND wt.name = sc.slug;

-- Add explicit workflow-template metadata for legacy service slugs that map indirectly.
UPDATE service_catalog
SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{workflow_template_name}', to_jsonb('site-fix'::text), true),
    updated_at = NOW()
WHERE slug = 'bug-report';

UPDATE service_catalog
SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{workflow_template_name}', to_jsonb('incident-investigation'::text), true),
    updated_at = NOW()
WHERE slug IN ('security-issue', 'general-request');

UPDATE service_catalog
SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{workflow_template_name}', to_jsonb('code-change'::text), true),
    updated_at = NOW()
WHERE slug = 'feature-request';

UPDATE service_catalog
SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{workflow_template_name}', to_jsonb('affiliate-article'::text), true),
    updated_at = NOW()
WHERE slug = 'content-creation';

UPDATE service_catalog
SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{workflow_template_name}', to_jsonb('image-generation'::text), true),
    updated_at = NOW()
WHERE slug = 'image-generation';

UPDATE service_catalog
SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{workflow_template_name}', to_jsonb('site-fix'::text), true),
    updated_at = NOW()
WHERE slug = 'website-update';

-- Add business-plan service rows that match the explicit operating model.
INSERT INTO service_catalog (
  name,
  slug,
  description,
  department_id,
  default_agent_id,
  workflow_template_id,
  intake_fields,
  sla_hours,
  is_active,
  sort_order,
  metadata
)
VALUES
  (
    'Affiliate Article',
    'affiliate-article',
    'Structured request to research, draft, review, and publish an affiliate article.',
    (SELECT id FROM departments WHERE name = 'Content & Publishing'),
    'affiliate-editorial',
    (SELECT id FROM workflow_templates WHERE name = 'affiliate-article'),
    '[{"name":"title","type":"text","required":true,"label":"Article Title"},{"name":"description","type":"textarea","required":true,"label":"Brief"},{"name":"site","type":"text","required":false,"label":"Target Site"},{"name":"keyword","type":"text","required":false,"label":"Primary Keyword"}]'::jsonb,
    72,
    true,
    110,
    '{"workflow_template_name":"affiliate-article"}'::jsonb
  ),
  (
    'Image Pack',
    'image-pack',
    'Generate an image set or visual asset pack for content or publishing.',
    (SELECT id FROM departments WHERE name = 'Media & Vision'),
    'comfyui-image-agent',
    NULL,
    '[{"name":"title","type":"text","required":true,"label":"Asset Title"},{"name":"description","type":"textarea","required":true,"label":"Brief"},{"name":"style","type":"text","required":false,"label":"Style"},{"name":"dimensions","type":"text","required":false,"label":"Dimensions"}]'::jsonb,
    48,
    true,
    120,
    '{"workflow_template_name":"image-generation"}'::jsonb
  ),
  (
    'WordPress Publish',
    'wordpress-publish',
    'Publish prepared content to WordPress and verify the live result.',
    (SELECT id FROM departments WHERE name = 'Content & Publishing'),
    'blogger-publisher',
    (SELECT id FROM workflow_templates WHERE name = 'wordpress-publish'),
    '[{"name":"title","type":"text","required":true,"label":"Publish Title"},{"name":"description","type":"textarea","required":true,"label":"Publish Notes"},{"name":"site","type":"text","required":false,"label":"Site"},{"name":"post_id","type":"text","required":false,"label":"Post ID"}]'::jsonb,
    48,
    true,
    130,
    '{"workflow_template_name":"wordpress-publish"}'::jsonb
  ),
  (
    'Site Fix',
    'site-fix',
    'Request investigation and repair of a site issue or defect.',
    (SELECT id FROM departments WHERE name = 'Web Properties'),
    '3dput',
    (SELECT id FROM workflow_templates WHERE name = 'site-fix'),
    '[{"name":"title","type":"text","required":true,"label":"Issue Title"},{"name":"description","type":"textarea","required":true,"label":"Issue Description"},{"name":"site","type":"text","required":false,"label":"Affected Site"},{"name":"severity","type":"select","required":true,"label":"Severity","options":["critical","high","medium","low"]}]'::jsonb,
    48,
    true,
    140,
    '{"workflow_template_name":"site-fix"}'::jsonb
  ),
  (
    'Incident Investigation',
    'incident-investigation',
    'Request triage, investigation, and remediation of an incident.',
    (SELECT id FROM departments WHERE name = 'Core Platform'),
    'main',
    (SELECT id FROM workflow_templates WHERE name = 'incident-investigation'),
    '[{"name":"title","type":"text","required":true,"label":"Incident Title"},{"name":"description","type":"textarea","required":true,"label":"Incident Details"},{"name":"impact","type":"textarea","required":false,"label":"Impact"},{"name":"severity","type":"select","required":true,"label":"Severity","options":["critical","high","medium","low"]}]'::jsonb,
    24,
    true,
    150,
    '{"workflow_template_name":"incident-investigation"}'::jsonb
  ),
  (
    'Code Change',
    'code-change',
    'Structured request for a code implementation or refactor.',
    (SELECT id FROM departments WHERE name = 'Core Platform'),
    'coder',
    (SELECT id FROM workflow_templates WHERE name = 'code-change'),
    '[{"name":"title","type":"text","required":true,"label":"Change Title"},{"name":"description","type":"textarea","required":true,"label":"Change Description"},{"name":"repo","type":"text","required":false,"label":"Repository"},{"name":"acceptance_criteria","type":"textarea","required":false,"label":"Acceptance Criteria"}]'::jsonb,
    72,
    true,
    160,
    '{"workflow_template_name":"code-change"}'::jsonb
  ),
  (
    'QA Review',
    'qa-review',
    'Request a formal QA review before publication or completion.',
    (SELECT id FROM departments WHERE name = 'Content & Publishing'),
    'qa-auditor',
    (SELECT id FROM workflow_templates WHERE name = 'qa-review'),
    '[{"name":"title","type":"text","required":true,"label":"Review Title"},{"name":"description","type":"textarea","required":true,"label":"Review Scope"},{"name":"artifact_ref","type":"text","required":false,"label":"Artifact Reference"}]'::jsonb,
    24,
    true,
    170,
    '{"workflow_template_name":"qa-review"}'::jsonb
  ),
  (
    'Topic Research',
    'topic-research',
    'Research a topic cluster or content opportunity and return structured findings.',
    (SELECT id FROM departments WHERE name = 'Content & Publishing'),
    'topic-planner',
    NULL,
    '[{"name":"title","type":"text","required":true,"label":"Research Topic"},{"name":"description","type":"textarea","required":true,"label":"Research Brief"},{"name":"site","type":"text","required":false,"label":"Target Site"}]'::jsonb,
    72,
    true,
    180,
    '{"workflow_template_name":null}'::jsonb
  )
ON CONFLICT (slug) DO NOTHING;

INSERT INTO schema_migrations (migration_name) VALUES ('010_harmonize_service_catalog') ON CONFLICT DO NOTHING;
