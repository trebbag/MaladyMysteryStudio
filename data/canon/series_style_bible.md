# Series Style Bible

```yaml
# Series Style Bible — “Felt Detectives in Pixar‑3D Anatomy”
# This document is intentionally strict. It is the law of the series.

version: 1.0
series_title: "Detective Cyto Kine & Deputy Pip: Micro-Mysteries of the Human Body"

global_art_direction:
  characters:
    material: "felt"
    texture_notes:
      - "visible felt fibers (macro fuzz), but clean, not messy"
      - "subtle stitching seams (consistent locations across episodes)"
      - "soft rounded shapes; tactile, handmade look"
    lighting:
      - "soft key light with gentle falloff"
      - "clear rim light to separate felt from background"
    consistency_rules:
      - "Character silhouettes must remain consistent across slides and episodes"
      - "Faces/eyes must be identical to the canonical renders"
  environments:
    style: "high-quality 3D animation (Pixar-like)"
    constraints:
      - "medical anatomy must be accurate in overall structure and key landmarks"
      - "backgrounds should feel cinematic: depth-of-field, volumetric light where appropriate"
      - "avoid gore; keep educational and approachable"
    anatomy_accuracy:
      required_landmarks:
        - "correct spatial relationships (e.g., alveoli-capillary interface, nephron regions, dermal layers)"
        - "correct flow directions (airflow, blood flow, filtrate flow, etc.)"
      prohibited:
        - "nonsense organ geometry"
        - "mislabeling structures"
        - "impossible vessel connections"

recurring_ui_and_graphics:
  mission_hud_overlay:
    purpose: "creates continuity; provides quick ‘clue’ and location metadata"
    elements:
      - "mission timer"
      - "location tag (organ + micro-location)"
      - "CLUE FOUND box"
      - "vitals readout (stylized, not clinical monitor exact)"
    placement:
      timer: "top-left"
      location: "top-right"
      clue_box: "bottom-right"
      vitals: "bottom-left"
    reuse_rule: "HUD design must be identical across all slides tagged [HUD]"
  body_map_transition:
    purpose: "flipbook motion + pacing: show travel between body locations"
    design:
      - "human silhouette + highlighted organ system"
      - "waypoint dot + arrow"
      - "short caption with destination"
    reuse_rule: "Map template identical across episodes; only highlighted region changes"
  clue_board:
    purpose: "differential diagnosis visualization"
    layout:
      suspects_column: "Differential diagnoses"
      evidence_column: "Symptoms / Exam / Labs / Imaging"
      verdict_column: "Working Dx + confidence"
    reuse_rule: "Board layout identical across slides tagged [CLUE_BOARD]"

slide_types_and_rules:
  HYBRID:
    intent: "default slide type; story action and medical teaching happen together"
    rules:
      - "medical-only composition is forbidden"
      - "panel-1 bullets must teach standalone medical points"
      - "panel-2 medical visual is required unless in-scene annotated equivalent is used"
      - "characters remain in-scene and involved in the teaching action"
    on_slide_density:
      bullets_max: 6
      words_per_bullet_max: 14
    visuals: ["diagram", "algorithm", "table", "annotated anatomy render", "in-scene annotated medical visual"]
  CHECKPOINT:
    intent: "retrieval practice subtype of HYBRID"
    on_slide_density:
      question_max_words: 18
      answer_on_slide: false
  STORY_TRANSITION:
    intent: "location/time/action jump; used sparingly"
    rules:
      - "allowed only for action or location change"
      - "may omit medical bullets"
      - "must not become a medical-only slide"
    on_slide_density:
      caption_max_words: 10
    visuals: ["full-bleed cinematic scene with felt characters"]

storytelling_rules:
  tone:
    - "mystery/thriller with humor"
    - "James Bond energy during treatment/mission sequences"
    - "never mean-spirited; patient is respected"
  variety_engine:
    seed_knobs:
      - "genre wrapper"
      - "body setting"
      - "antagonist archetype"
      - "signature gadget"
      - "twist type"
    non_repetition_rule: "must change at least 3/5 knobs vs last episode"
  motion_in_stills:
    shot_rule: "any movement/conflict/reveal beat requires ≥2 STORY slides (setup + visible change)"
    delta_required: "each STORY slide declares what changed from the previous story slide"

accessibility_and_clarity:
  readability:
    - "high contrast text"
    - "avoid tiny fonts"
  clinical_voice:
    - "clear PCP actions: what to do now, what to order, when to refer"

```
