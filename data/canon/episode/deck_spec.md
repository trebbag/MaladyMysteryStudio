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
  slide_mix_target:
    MED: 16
    STORY: 12
    TRANSITION: 2
    CHECKPOINT: 2
  max_story_slides_in_a_row: 3
  min_med_anchor_every_minutes: 2.5
  story_time_fraction_target: 0.25   # story slides are quick; can be many
  story_slide_caption_max_words: 12

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
  story_slide_rule: "STORY slides introduce no new medical atoms"

```
