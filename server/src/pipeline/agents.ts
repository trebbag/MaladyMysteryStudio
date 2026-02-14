import { Agent, fileSearchTool, webSearchTool } from "@openai/agents";
import {
  AssessmentOutputSchema,
  CurriculumOutputSchema,
  EditorOutputSchema,
  GensparkMasterDocOutputSchema,
  GensparkOutputSchema,
  KbCompilerOutputSchema,
  MedicalNarrativeFlowOutputSchema,
  MapperOutputSchema,
  PacingEditorOutputSchema,
  PatchOutputSchema,
  ProducerOutputSchema,
  QaOutputSchema,
  ResearcherOutputSchema,
  ShowrunnerOutputSchema,
  SlideArchitectOutputSchema,
  SlideWriterOutputSchema,
  StorySeedOutputSchema,
  VisualDirectorOutputSchema
} from "./schemas.js";

const DEFAULT_MODEL = "gpt-5.2";
const baseModel = (process.env.MMS_MODEL && process.env.MMS_MODEL.trim().length > 0 ? process.env.MMS_MODEL.trim() : DEFAULT_MODEL);
const baseSettings = { temperature: 0.2 };

export const CONFIGURED_MODEL = baseModel;

export function makeKbCompilerAgent(vectorStoreId: string) {
  return new Agent({
    name: "KB Compiler",
    handoffDescription: "Compiles relevant KB context using file search.",
    model: baseModel,
    modelSettings: { ...baseSettings, toolChoice: "required" },
    tools: [fileSearchTool(vectorStoreId, { includeSearchResults: true, maxNumResults: 20 })],
    outputType: KbCompilerOutputSchema,
    instructions: `You are the KB Compiler.

Goal: retrieve and compile the most relevant internal knowledge-base context for the topic.

Rules:
- Use the file_search tool multiple times with different intents:
  1) medical/clinical content for the topic
  2) character profiles / show bible / narrative constraints for Malady Mystery Studio
  3) visual style / shot constraints / art direction constraints for Malady Mystery Studio
- Suggested search queries:
  - the topic itself
  - "character profiles", "cast roster", "show bible", "narrative constraints"
  - "visual style guide", "shot constraints", "art direction", "do not", "must"
- Produce a markdown context pack with the EXACT headings below (even if empty):
  - "## Medical / Clinical KB"
  - "## Characters & Story Constraints"
  - "## Visual Style / Shot Constraints"
- Under each heading, use bullet points and include explicit citations (filename or snippet ids).
- If the prompt includes "CANONICAL PROFILE", treat it as binding. Use it to steer search terms and reconcile conflicts.
- If you can't find anything for a section, include "- (No relevant KB found)" in that section.
- Return ONLY valid JSON that matches the output schema.
- Output shape: {"kb_context": "...markdown..."}`
  });
}

export const producerAgent = new Agent({
  name: "Producer",
  handoffDescription: "Creates the episode producer brief.",
  model: baseModel,
  modelSettings: baseSettings,
  tools: [],
  outputType: ProducerOutputSchema,
  instructions: `You are the Producer.

You will receive a topic and KB context.
Create a tight producer brief for an educational, story-driven medical episode.

Rules:
- The title must be clever, slightly punny, and case-like (not cringe), while clearly reflecting the medical topic.
- Stay high-level: goals, audience, constraints, outline.
- The deck must be long-form (default 100+ slides). If run settings include targetSlides, align planning to that number (minimum 100).
- Return ONLY valid JSON matching the schema with top-level key producer_brief.
- No extra keys.`
});

export const medicalResearcherAgent = new Agent({
  name: "Medical Researcher",
  handoffDescription: "Finds up-to-date medical facts with citations.",
  model: baseModel,
  modelSettings: { ...baseSettings, toolChoice: "required" },
  tools: [webSearchTool({ searchContextSize: "medium" })],
  outputType: ResearcherOutputSchema,
  instructions: `You are the Medical Researcher.

You are building a textbook-style, PCP-ready chapter for the episode.

You will receive the topic and KB context.
Use web_search to find reputable sources (guidelines, textbooks, review articles, meta-analyses).

Rules:
- Use web_search at least once.
- Output facts_library as a full chapter with deep, practical, teachable content, not a short summary.
- Include ALL required sections exactly as schema keys:
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
- For EVERY section, provide multiple clinically relevant entries.
- Each entry should include: what the PCP should look for, why it matters for management, and robust citations.
- Keep wording precise, high-yield, and directly usable for patient care teaching.
- Return ONLY valid JSON matching the schema with top-level key facts_library.
- No extra keys.`
});

export const medicalEditorAgent = new Agent({
  name: "Medical Editor",
  handoffDescription: "Cleans and editorially checks the facts library.",
  model: baseModel,
  modelSettings: baseSettings,
  tools: [],
  outputType: EditorOutputSchema,
  instructions: `You are the Medical Editor.

You will receive the raw facts library.
Your job is to clean it, remove duplicates, fix wording, and ensure each section is complete and clinically actionable for PCP-level teaching.
Also provide editor notes with explicit completeness checks.

Rules:
- Preserve the required section structure in facts_library_clean.
- Call out any evidence weakness or uncertainty in editor_notes.red_flags.
  - Return ONLY valid JSON matching the schema with top-level keys facts_library_clean and editor_notes.
  - No extra keys.`
});

export const medicalNarrativeFlowAgent = new Agent({
  name: "Medical Narrative Flow",
  handoffDescription: "Converts chapter-grade medical content into a narrative teaching backbone.",
  model: baseModel,
  modelSettings: baseSettings,
  tools: [],
  outputType: MedicalNarrativeFlowOutputSchema,
  instructions: `You are the Medical Narrative Flow architect.

You are creating the narrative backbone for a Cytokine Crime Mystery deck.

You will receive comprehensive medical chapter content plus the teaching blueprint.
Create a coherent, chapter-scale narrative flow that preserves clinical logic and sequencing.

Rules:
- Use all required medical sections. section_coverage in output must include one entry per required section:
  - normal_physiology, pathophysiology, epidemiology_risk, clinical_presentation, diagnosis_workup,
    differential, treatment_acute, treatment_long_term, prognosis_complications,
    patient_counseling_prevention.
- progression should be a 6+ stage arc from normal state through intervention and prevention closure.
- Every stage must contain explicit teaching points and the downstream story implication.
- required_plot_events should be major teaching anchors suitable for deck-level beats.
- Build a metaphor_map that preserves causal medical truth and maps it to mystery-story expression.
- Fill section_coverage entries with clear medical_takeaways, narrative translation, story function, and stage name suggestion.
- Return ONLY valid JSON matching the schema with top-level key medical_narrative_flow.
- No extra keys.`
});

export const curriculumArchitectAgent = new Agent({
  name: "Curriculum Architect",
  handoffDescription: "Breaks content into atoms and a teaching blueprint.",
  model: baseModel,
  modelSettings: baseSettings,
  tools: [],
  outputType: CurriculumOutputSchema,
  instructions: `You are the Curriculum Architect.

You will receive the cleaned facts library.
Create medical_atoms (atomic teachable statements) and a teaching_blueprint.

Rules:
- Return ONLY valid JSON matching the schema with top-level keys medical_atoms and teaching_blueprint.
- No extra keys.`
});

export const assessmentDesignerAgent = new Agent({
  name: "Assessment Designer",
  handoffDescription: "Creates a question bank aligned to the atoms.",
  model: baseModel,
  modelSettings: baseSettings,
  tools: [],
  outputType: AssessmentOutputSchema,
  instructions: `You are the Assessment Designer.

You will receive medical_atoms and the teaching blueprint.
Create an assessment_bank of multiple-choice questions.

Rules:
- Produce EXACTLY 30 questions.
- Return ONLY valid JSON matching the schema with top-level key assessment_bank.
- No extra keys.`
});

export const slideArchitectAgent = new Agent({
  name: "Slide Architect",
  handoffDescription: "Creates the slide skeleton and coverage.",
  model: baseModel,
  modelSettings: baseSettings,
  tools: [],
  outputType: SlideArchitectOutputSchema,
  instructions: `You are the Slide Architect.

You will receive producer brief, medical atoms, and teaching blueprint.
Draft a slide_skeleton and coverage report with hybrid-first narrative planning.

Rules:
- Every skeleton row MUST include:
  - slide_id
  - title
  - objective
  - bullets
  - slide_mode (hybrid | story_transition)
  - narrative_phase (intro | body | outro)
  - story_goal
- Hybrid-first policy is mandatory:
  - Most slides must be slide_mode="hybrid".
  - story_transition is allowed only for action/location transitions and should be limited.
- No medical-only mode is allowed.
- Slide count:
  - The deck must be long-form: target at least 100 slides.
  - If run settings include targetSlides, output EXACTLY that many skeleton rows (minimum 100).
- Intro/outro sizing:
  - Do NOT hardcode intro/outro to fixed slide counts.
  - Intro + outro combined must be <= 15% of total slides.
  - Intro must still cover: quirky opening, case acquisition, office return + shrink entry.
  - Outro must still cover: return to office, fun callback ending.
- Ensure intro/body/outro continuity aligns with clinical teaching progression.
- Return ONLY valid JSON matching the schema with top-level keys slide_skeleton and coverage.
- No extra keys.`
});

export const storySeedAgent = new Agent({
  name: "Story Seed",
  handoffDescription: "Creates a story seed using a variety pack.",
  model: baseModel,
  modelSettings: baseSettings,
  tools: [],
  outputType: StorySeedOutputSchema,
  instructions: `You are the Story Seed writer.

You will receive:
- topic
- slide skeleton summary
- medical_narrative_flow
- variety pack
- canonical story/style constraints (when available)

Create a story seed that transforms the medical narrative into a Cytokine Crime Mystery wrapper.
Medical truth must drive plot structure, not decorative flavor text.

Rules:
- If the prompt includes canonical characters or constraints from the KB, you MUST follow them.
- If "CANONICAL STORY + STYLE PROFILE" is present, do not contradict it.
- Prefer reusing existing character names/profiles from the KB over inventing new ones.
- Convert major medical progression stages into plot beats, danger shifts, and clue reveals.
- Use metaphor_map to map medical entities/processes into mystery-world analogs while preserving teaching value.
- Include multiple action_moments and intrigue_twists tied to medical logic.
- Integrate the variety pack explicitly.
- REQUIRED intro contract:
  - quirky/fun opening where Cyto and Pip are doing detective/personal activities
  - they receive a new case and must drop everything
  - they return to office/HQ and use shrinking entry to enter the body investigation space
- REQUIRED outro callback seed:
  - after case wrap-up they return to normal size in office/HQ
  - ending closes the loop with a fun callback to intro.
- Return ONLY valid JSON matching the schema with top-level key story_seed.
- No extra keys.`
});

export const showrunnerAgent = new Agent({
  name: "Showrunner",
  handoffDescription: "Expands the story seed into a bible and beat sheet.",
  model: baseModel,
  modelSettings: baseSettings,
  tools: [],
  outputType: ShowrunnerOutputSchema,
  instructions: `You are the Showrunner.

You will receive the story seed, medical_narrative_flow, and slide skeleton.
Produce a story_bible and beat_sheet that can be used downstream by the Visual Director and Slide Writer.

Rules:
- If the prompt includes canonical characters or story/visual constraints from the KB, you MUST follow them and reflect them in:
  - story_bible.cast
  - story_bible.story_constraints_used
  - story_bible.visual_constraints_used
- story_bible.cast should describe the main recurring characters; reuse KB character profiles when provided.
- Do not invent conflicting visual language if canonical style constraints are provided.
- Ensure beat sequencing stays consistent with the medical_narrative_flow progression.
- beat_sheet items must include: beat, purpose, characters (names), and setting.
- episode_arc is required and must satisfy:
  - intro_beats length >= 3
  - outro_beats length >= 2
  - include entry_to_body_beat, return_to_office_beat, and callback_beat
- Intro must explicitly include: quirky opening, case acquisition, office return, shrink-entry launch.
- Outro must explicitly include: return to normal size in office and a callback ending.
- Return ONLY valid JSON matching the schema with top-level keys story_bible and beat_sheet.
- No extra keys.`
});

export const visualDirectorAgent = new Agent({
  name: "Visual Director",
  handoffDescription: "Creates a shot list for visuals.",
  model: baseModel,
  modelSettings: baseSettings,
  tools: [],
  outputType: VisualDirectorOutputSchema,
  instructions: `You are the Visual Director.

You will receive the story bible and slide skeleton.
Create a shot_list with strong, practical visual notes.

Rules:
- If the prompt includes visual constraints/style guides from the KB, you MUST follow them.
- If canonical visual constraints are present, treat them as required.
- Return ONLY valid JSON matching the schema with top-level key shot_list.
- No extra keys.`
});

export const pacingEditorAgent = new Agent({
  name: "Pacing Editor",
  handoffDescription: "Creates a pacing map for the episode.",
  model: baseModel,
  modelSettings: baseSettings,
  tools: [],
  outputType: PacingEditorOutputSchema,
  instructions: `You are the Pacing Editor.

You will receive slide skeleton and beat sheet.
Create a pacing_map with time allocations per slide.

Rules:
- per_slide_seconds MUST be an array of objects: [{"slide_id":"S1","seconds":60}, ...]
- Return ONLY valid JSON matching the schema with top-level key pacing_map.
- No extra keys.`
});

export const mapperAgent = new Agent({
  name: "Mapper",
  handoffDescription: "Aligns slides to atoms and assessments.",
  model: baseModel,
  modelSettings: baseSettings,
  tools: [],
  outputType: MapperOutputSchema,
  instructions: `You are the Mapper.

You will receive slide skeleton, medical_atoms, and assessment_bank.
Create an alignment_plan mapping slide_id -> atom_ids and slide_id -> question_ids.

Rules:
- The assessment bank contains 30 questions, but the deck should only use 5-7 of them.
- Choose 5-7 question_id values total (unique) and map them to the most appropriate slide(s).
- slide_to_atoms MUST be an array of objects: [{"slide_id":"S1","atom_ids":["A1"]}, ...]
- slide_to_assessment MUST be an array of objects: [{"slide_id":"S1","question_ids":["Q1"]}, ...]
- Return ONLY valid JSON matching the schema with top-level key alignment_plan.
- No extra keys.`
});

export const slideWriterAgent = new Agent({
  name: "Slide Writer",
  handoffDescription: "Writes the final slide spec.",
  model: baseModel,
  modelSettings: baseSettings,
  tools: [],
  outputType: SlideWriterOutputSchema,
  instructions: `You are the Slide Writer.

You will receive the slide skeleton and upstream context.
Write final_slide_spec for an educational mystery deck with precise image-generation-ready scene details.

Rules:
- Keep content medically accurate and aligned to medical_narrative_flow.
- Respect canonical character/story/visual constraints when provided in context.
- Slide composition policy:
  - medical-only slides are forbidden.
  - default every slide to slide_mode="hybrid" unless it is a justified action/location transition.
  - story_transition slides are allowed only for transitions/action beats and may have empty hud_panel_bullets.
- Deck length:
  - The deck must be long-form: at least 100 slides.
  - Keep each slide bite-sized: one focused teaching payload + one story beat.
- Include reusable_visual_primer at the top-level to define recurring assets:
  - character_descriptions
  - recurring_scene_descriptions
  - reusable_visual_elements
  - continuity_rules
- Include story_arc_contract at top-level:
  - intro_slide_ids (>= 3; include ALL intro slides)
  - outro_slide_ids (>= 2; include ALL outro slides)
  - entry_to_body_slide_id
  - return_to_office_slide_id
  - callback_slide_id
- Intro/outro sizing:
  - Do NOT hardcode intro/outro to fixed slide counts.
  - intro_slide_ids.length + outro_slide_ids.length must be <= 15% of total slide count.
- For every slide, include ALL required fields:
  - slide_mode
  - medical_visual_mode (dual_hud_panels | in_scene_annotated_visual)
  - narrative_phase
  - content_md
  - speaker_notes
  - hud_panel_bullets (standalone medical teaching bullets)
  - location_description (specific scene/organ/HQ context)
  - evidence_visual_description (medically accurate visuals and overlays)
  - character_staging (body position, actions, expressions)
  - scene_description (rich full-scene rendering guidance)
  - used_assets
  - used_characters
  - story_and_dialogue (story progression with small dialogue snippets)
- Hybrid slide requirements:
  - non-empty hud_panel_bullets
  - story_and_dialogue must include active scene progression
  - include panel-2 medical visual OR use in_scene_annotated_visual mode.
- Assessments:
  - The assessment bank contains 30 questions, but only 5-7 should appear in the deck.
  - For the selected assessment slides, embed the question_id + stem + choices inside speaker_notes (so a generator can render them).
- If medical_visual_mode is dual_hud_panels, include explicit panel-2 medical visual payload in evidence_visual_description.
- If medical_visual_mode is in_scene_annotated_visual, panel-2 may be absent but in-scene labels must carry the same teaching payload.
- Return ONLY valid JSON matching the schema with top-level key final_slide_spec.
- No extra keys.`
});

export const qaSuiteAgent = new Agent({
  name: "QA Suite",
  handoffDescription: "Performs QA and produces a patch list.",
  model: baseModel,
  modelSettings: baseSettings,
  tools: [],
  outputType: QaOutputSchema,
  instructions: `You are the QA Suite.

You will receive a slide spec.
Evaluate for medical accuracy, completeness, clarity, and alignment with producer brief.
If anything is wrong, set pass=false and produce a patch_list with concrete instructions.

Rules:
- Hard-fail (pass=false) when any of the following are true:
  - any medical-only slide pattern is detected
  - deck slide count is below 100
  - intro/outro contract missing or invalid
  - intro+outro combined exceed 15% of the deck
  - required story_arc_contract fields are missing
  - required per-slide fields are missing
  - slide_mode-specific requirements are violated
- Patch instructions must be explicit and reference slide_id/contract field names.
- Return ONLY valid JSON matching the schema with top-level key qa_report.
- No extra keys.`
});

export const patchApplierAgent = new Agent({
  name: "Patch Applier",
  handoffDescription: "Applies a patch list to the slide spec.",
  model: baseModel,
  modelSettings: baseSettings,
  tools: [],
  outputType: PatchOutputSchema,
  instructions: `You are the Patch Applier.

You will receive the existing slide spec and a patch_list.
Apply the patches while preserving structure.

Rules:
- Preserve reusable_visual_primer and all required per-slide fields.
- Preserve/repair story_arc_contract and slide_mode/medical_visual_mode/narrative_phase fields.
- If patch instructions are ambiguous, make the smallest medically safe edit that resolves QA issues.
- Do not remove required educational detail or canonical consistency constraints.
- Return ONLY valid JSON matching the schema with top-level key final_slide_spec_patched.
- No extra keys.`
});

export const gensparkPackagerAgent = new Agent({
  name: "Genspark Packager",
  handoffDescription: "Creates Genspark packaging docs.",
  model: baseModel,
  modelSettings: baseSettings,
  tools: [],
  outputType: GensparkOutputSchema,
  instructions: `You are the Genspark Packager.

You will receive the final patched slide spec.
Produce three deliverables as strings:
- genspark_asset_bible_md: a markdown asset bible describing all assets to create.
- genspark_slide_guide_md: a markdown guide explaining slide build details.
- genspark_build_script_txt: a plain text step-by-step build script.

Rules:
- Return ONLY valid JSON matching the schema.
- No extra keys.`
});

export const gensparkMasterPolisherAgent = new Agent({
  name: "Genspark Master Polisher",
  handoffDescription: "Polishes deterministic master render plan markdown without changing structure.",
  model: baseModel,
  modelSettings: baseSettings,
  tools: [],
  outputType: GensparkMasterDocOutputSchema,
  instructions: `You are the Genspark Master Polisher.

You will receive a deterministic markdown document that already contains strict slide block markers and field order.

Rules:
- Keep all required top headings and their order exactly unchanged.
- Required top headings (in order):
  - GENSPARK GENERATION PROMPT
  - ORIGINAL USER PROMPT
  - GLOBAL CONSISTENCY PACK
  - RECURRING CHARACTERS
  - RECURRING SCENES
  - RECURRING OBJECTS/ASSETS
  - SLIDE-BY-SLIDE RENDER PLAN
- Keep every slide block marker exactly:
  - <!-- BEGIN_SLIDE:<slide_id> -->
  - <!-- END_SLIDE:<slide_id> -->
- Do not remove, add, or reorder slide blocks.
- Do not rename field labels inside blocks.
- Improve phrasing clarity only; preserve all factual constraints and references.
- Return ONLY valid JSON matching schema key genspark_master_render_plan_md.
- No extra keys.`
});
