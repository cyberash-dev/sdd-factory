export const ARCHITECT_MESSAGE = `Invocation inputs:
- slug: {{slug}}
- product_dir: {{product_dir}}
- spec_source_path: {{spec_source_path}}
- tech_md: {{tech_md}}
- handoff_path: {{handoff_path}}
- attempt: {{attempt}}
- rework_finding: {{rework_finding}}

Relative paths you pass to read_file, write_file and list_dir resolve against product_dir; spec_source_path and handoff_path are absolute, pass them as given.
Write tech_md, then handoff_path, then stop.`;

export const VERIFICATION_DESIGNER_MESSAGE = `Invocation inputs:
- slug: {{slug}}
- product_dir: {{product_dir}}
- verification_md: {{verification_md}}
- handoff_path: {{handoff_path}}
- attempt: {{attempt}}
- rework_finding: {{rework_finding}}

Relative paths you pass to read_file, write_file and list_dir resolve against product_dir; handoff_path is absolute, pass it as given.
Write verification_md, then handoff_path, then stop.`;

export const PLANNER_MESSAGE = `Invocation inputs:
- slug: {{slug}}
- product_dir: {{product_dir}}
- tech_md: {{tech_md}}
- verification_md: {{verification_md}}
- tasks_json: {{tasks_json}}
- handoff_path: {{handoff_path}}
- attempt: {{attempt}}
- rework_finding: {{rework_finding}}
- graph_depth: {{graph_depth}}
- min_covers_per_task: {{min_covers_per_task}}

Relative paths you pass to read_file, write_file and list_dir resolve against product_dir; handoff_path is absolute, pass it as given.
Write tasks_json, design/plan.md, then handoff_path, then stop.`;

export const HANDOFF_RERUN_SUFFIX = `

Your previous handoff at {{handoff_path}} was unparseable ({{handoff_error}}). Redo the work with the same inputs and finish by writing a handoff whose frontmatter carries every required key.`;
