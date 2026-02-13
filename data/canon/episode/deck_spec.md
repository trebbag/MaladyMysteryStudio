# Deck Spec

```yaml
# Deck Spec — Fill this in per episode. Keep it short; it drives the whole workflow.
topic: "[TOPIC]"
audience: "MS3/MS4 + Primary Care (FM/IM)"

scope:
  outpatient_focus: true
  inpatient_complications_included: true
  pediatrics_included: false
  pregnancy_included: false

required_sections:
  - normal_physiology
  - pathophysiology
  - epidemiology_risk
  - clinical_presentation
  - diagnosis_workup
  - differential
  - treatment_acute
  - treatment_long_term
  - prognosis_complications
  - patient_counseling_prevention

pacing_rules:
  hybrid_default: true
  medical_only_slides_forbidden: true
  story_transition_allowed_for_action_or_location_change: true
  max_story_transition_slides: 3
  story_transition_requires_plot_reason: true
  min_med_anchor_every_minutes: 2.5
  story_transition_caption_max_words: 12

intro_outro_contract:
  intro_slide_count: 3
  outro_slide_count: 2
  required_intro_beats:
    - "quirky Cyto/Pip opening"
    - "case acquisition"
    - "office return + shrinking entry to body"
  required_outro_beats:
    - "case wrapped + return to normal size in office"
    - "fun callback ending that closes intro loop"

visual_style:
  character_material: "felt"
  environment_style: "Pixar-like 3D animation"
  anatomy_accuracy_required: true

guideline_preferences:
  - "Authoritative society guidelines when available"
  - "High-quality reviews / standard references (UpToDate) as secondary"
citation_style: "short inline + reference list in speaker notes when possible"

genspark_rendering:
  mode: "sequential"
  create_reference_slides_first: true
  reference_slides:
    - "Cyto Kine model sheet"
    - "Deputy Pip model sheet"
    - "Mission HUD overlay"
    - "Body-map transition template"
    - "Clue board template"

story_constraints:
  setting_rules:
    - "humor allowed; no gore"
    - "patient respected"
    - "story supports learning anchors but does not distort medical truth"
  required_story_anchors_in_order:
    - normal
    - path
    - epi_risk
    - presentation
    - dx_workup
    - differential
    - reveal
    - treatment
    - prognosis
  slide_composition_rule: "HYBRID slides are default and must combine story action + medical teaching payload."
  transition_slide_rule: "STORY_TRANSITION slides are allowed only for action/location changes and do not introduce standalone medical payload."

```
