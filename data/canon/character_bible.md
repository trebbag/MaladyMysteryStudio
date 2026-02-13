# Character Bible — Canonical Characters & Props
version: 1.0

characters:
  - id: detective_cyto_kine
    name: "Detective Cyto Kine"
    role: "Lead investigator; An intergalactically famous detective from a felt-based world, now stranded (semi-voluntarily) in a shiny Pixar-like 3D universe, where he solves “disease crimes” by shrinking to microscopic size and investigating the human body like a noir city full of suspects, syndicates, and silent witnesses. He’s not just solving cases. He’s preventing a larger outbreak conspiracy that occasionally peeks through your episodic mysteries. This conspiracy is from the ICD (Internal Calamity Directorate)"
    canonical_render_path: "assets/cyto kine.jpeg"
    speaking_style:
      - "Radio-drama narration: He narrates to “organize thoughts”… except he does it out loud. Great for teaching moments because he naturally explains what he’s seeing as noir metaphors."
    personality_notes:
      - "Calm, surgical focus; speaks like every sentence is a closing argument."
      - "Dry humor that lands unexpectedly."
      - "Compassionate, but guarded — he cares too much to show it easily."
      - "Overly amused by complexity — calls it 'elegance.'"
      - "Protective big-brother energy toward Pip (even while acting annoyed)."
      - "Sees systems, not just symptoms: he reads physiology like infrastructure."
      - "Doesn’t panic inside the weirdest body environments—he treats danger as data."
      - "Empathic to victims (the human host) without being sentimental."
      - "Excellent at “micro-scale interrogation”: noticing tiny changes in flow, shape, signaling, pressure, timing."
      - "Tends to over-control plans—biology is… not a cooperative witness."
      - "Has difficulty admitting he’s attached to Pip (he acts like it’s 'operational necessity')."
      - "Elegance obsession: When a mechanism clicks—blood gas shifts, feedback loops, immune signaling—he gets genuinely delighted, almost smiling, then catches himself and returns to stoic mode. 'Elegant. Beautiful.'"
    catchphrases:
      - "[optional]"
    do_not:
      - "do not use cynical humor about patients"
    recurring_props:
      - "HUD visor"
      - "evidence vial"
  - id: deputy_pip
    name: "Deputy Pip"
    role: "Field deputy to Detective Cyto Kine; action-forward; asks clarifying questions learners would ask"
    canonical_render_path: "assets/pip.jpeg"
    speaking_style:
      - "[PASTE your character profile here]"
    personality_notes:
      - "Pip is the chaos probe. He is curious about everything and causes problems that reveal the environment’s rules. This often uncovers clues."
      - "Earnest, loyal, excitable, clumsy."
      - "Tries to be noir-serious and fails with commitment."
      - "Wants Cyto’s respect so badly it physically increases the odds of accidents."
      - "Whispers dramatic lines like he’s in a detective serial… while actively slipping, bumping, or being carried by a current."
      - "Gets stuck to things (platelets, mucus, fibrin, “mystery goo”) like velcro meeting its soulmate."
      - "Mislabels things with confidence (“These are… oxygen donuts?”) and Cyto corrects him without looking up."
    catchphrases:
      - "[optional]"
    do_not:
      - "do not act incompetent; curiosity ≠ stupidity"
      - "avoid breaking the fourth wall unless specified"
    recurring_props:
      - "micro-scanner gadget"

recurring_supporting_elements:
  gadgets:
    - id: micro_scanner
      description: "handheld felt gadget with simple glowing readout"
      reuse_rule: "consistent silhouette across episodes"
    - id: cytokine_translator
      description: "HUD module that translates immune ‘signals’ into readable captions"
  logos_and_marks:
    - id: agency_badge
      description: "tiny felt badge worn by both characters"
  ui_overlays:
    - id: mission_hud_overlay
      reference: "series_style_bible.yaml > recurring_ui_and_graphics > mission_hud_overlay"

visual_continuity_rules:
  - "Characters are always felt; environments are always 3D animated."
  - "Scale cues: include at least one micro-scale reference per scene (RBC, cilia, collagen fibers, etc.)"
  - "Lighting continuity: characters should match scene lighting; avoid ‘sticker’ look."
  
```
