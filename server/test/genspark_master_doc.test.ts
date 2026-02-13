import { describe, expect, it } from "vitest";
import { buildGensparkMasterDoc, validateGensparkMasterDoc } from "../src/pipeline/genspark_master_doc.js";

function samplePatchedSpec() {
  return {
    title: "Final Spec",
    reusable_visual_primer: {
      character_descriptions: ["Dr. Ada Vega"],
      recurring_scene_descriptions: ["Immune district HQ"],
      reusable_visual_elements: ["Evidence board"],
      continuity_rules: ["Keep visual continuity"]
    },
    story_arc_contract: {
      intro_slide_ids: ["S1", "S2", "S3"],
      outro_slide_ids: ["S4", "S5"],
      entry_to_body_slide_id: "S3",
      return_to_office_slide_id: "S4",
      callback_slide_id: "S5"
    },
    slides: [
      {
        slide_id: "S1",
        title: "Slide 1",
        slide_mode: "hybrid" as const,
        medical_visual_mode: "dual_hud_panels" as const,
        narrative_phase: "intro" as const,
        content_md: "content",
        speaker_notes: "notes",
        hud_panel_bullets: ["bullet"],
        location_description: "HQ",
        evidence_visual_description: "evidence panel",
        character_staging: "staging",
        scene_description: "scene",
        used_assets: ["Evidence board"],
        used_characters: ["Dr. Ada Vega"],
        story_and_dialogue: 'Dialogue: "Ada: clue."'
      },
      {
        slide_id: "S2",
        title: "Slide 2",
        slide_mode: "story_transition" as const,
        medical_visual_mode: "in_scene_annotated_visual" as const,
        narrative_phase: "intro" as const,
        content_md: "content",
        speaker_notes: "notes",
        hud_panel_bullets: [],
        location_description: "Transition corridor",
        evidence_visual_description: "in-scene labels",
        character_staging: "staging",
        scene_description: "scene",
        used_assets: ["Evidence board"],
        used_characters: ["Dr. Ada Vega"],
        story_and_dialogue: "Transition beat"
      },
      {
        slide_id: "S3",
        title: "Slide 3",
        slide_mode: "hybrid" as const,
        medical_visual_mode: "dual_hud_panels" as const,
        narrative_phase: "intro" as const,
        content_md: "content",
        speaker_notes: "notes",
        hud_panel_bullets: ["bullet"],
        location_description: "Body entry",
        evidence_visual_description: "visual",
        character_staging: "staging",
        scene_description: "scene",
        used_assets: ["Evidence board"],
        used_characters: ["Dr. Ada Vega"],
        story_and_dialogue: "Story beat"
      },
      {
        slide_id: "S4",
        title: "Slide 4",
        slide_mode: "hybrid" as const,
        medical_visual_mode: "dual_hud_panels" as const,
        narrative_phase: "outro" as const,
        content_md: "content",
        speaker_notes: "notes",
        hud_panel_bullets: ["bullet"],
        location_description: "Office",
        evidence_visual_description: "visual",
        character_staging: "staging",
        scene_description: "scene",
        used_assets: ["Evidence board"],
        used_characters: ["Dr. Ada Vega"],
        story_and_dialogue: "Story beat"
      },
      {
        slide_id: "S5",
        title: "Slide 5",
        slide_mode: "hybrid" as const,
        medical_visual_mode: "dual_hud_panels" as const,
        narrative_phase: "outro" as const,
        content_md: "content",
        speaker_notes: "notes",
        hud_panel_bullets: ["bullet"],
        location_description: "Office",
        evidence_visual_description: "visual",
        character_staging: "staging",
        scene_description: "scene",
        used_assets: ["Evidence board"],
        used_characters: ["Dr. Ada Vega"],
        story_and_dialogue: "Story beat"
      }
    ],
    sources: ["https://example.com"]
  };
}

describe("pipeline/genspark_master_doc", () => {
  it("builds deterministic master doc with required sections and valid blocks", () => {
    const finalPatched = samplePatchedSpec();
    const doc = buildGensparkMasterDoc({
      topic: "Topic",
      finalPatched,
      reusableVisualPrimer: finalPatched.reusable_visual_primer,
      storyBible: {
        premise: "p",
        rules: ["r"],
        recurring_motifs: ["m"],
        cast: [{ name: "Dr. Ada Vega", role: "lead", bio: "bio", traits: ["calm"], constraints: ["kind"] }],
        story_constraints_used: ["constraint"],
        visual_constraints_used: ["constraint"]
      },
      beatSheet: [{ beat: "b", purpose: "p", characters: ["Dr. Ada Vega"], setting: "HQ" }],
      shotList: [{ shot_id: "SH1", moment: "m", framing: "f", visual_notes: "v" }],
      gensparkAssetBibleMd: "# Assets\n- A",
      gensparkSlideGuideMd: "# Guide\n- G",
      gensparkBuildScriptTxt: "BUILD"
    });

    expect(doc).toContain("## GLOBAL CONSISTENCY PACK");
    expect(doc).toContain("## SLIDE-BY-SLIDE RENDER PLAN");
    expect(doc).toContain("<!-- BEGIN_SLIDE:S1 -->");
    expect(doc).toContain("<!-- END_SLIDE:S5 -->");

    const validation = validateGensparkMasterDoc(doc, finalPatched.slides);
    expect(validation.ok).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it("fails validation when slide blocks are out of order", () => {
    const finalPatched = samplePatchedSpec();
    const validDoc = buildGensparkMasterDoc({
      topic: "Topic",
      finalPatched,
      reusableVisualPrimer: finalPatched.reusable_visual_primer,
      storyBible: {
        premise: "p",
        rules: ["r"],
        recurring_motifs: ["m"],
        cast: [{ name: "Dr. Ada Vega", role: "lead", bio: "bio", traits: ["calm"], constraints: ["kind"] }],
        story_constraints_used: ["constraint"],
        visual_constraints_used: ["constraint"]
      },
      beatSheet: [{ beat: "b", purpose: "p", characters: ["Dr. Ada Vega"], setting: "HQ" }],
      shotList: [{ shot_id: "SH1", moment: "m", framing: "f", visual_notes: "v" }],
      gensparkAssetBibleMd: "# Assets\n- A",
      gensparkSlideGuideMd: "# Guide\n- G",
      gensparkBuildScriptTxt: "BUILD"
    });

    const broken = validDoc.replace("<!-- BEGIN_SLIDE:S1 -->", "<!-- BEGIN_SLIDE:S2 -->");
    const validation = validateGensparkMasterDoc(broken, finalPatched.slides);
    expect(validation.ok).toBe(false);
    expect(validation.errors.join(" ")).toContain("Slide block order mismatch");
  });

  it("fails validation when panel 2 is None for dual_hud_panels mode", () => {
    const finalPatched = samplePatchedSpec();
    const doc = buildGensparkMasterDoc({
      topic: "Topic",
      finalPatched,
      reusableVisualPrimer: finalPatched.reusable_visual_primer,
      storyBible: {
        premise: "p",
        rules: ["r"],
        recurring_motifs: ["m"],
        cast: [{ name: "Dr. Ada Vega", role: "lead", bio: "bio", traits: ["calm"], constraints: ["kind"] }],
        story_constraints_used: ["constraint"],
        visual_constraints_used: ["constraint"]
      },
      beatSheet: [{ beat: "b", purpose: "p", characters: ["Dr. Ada Vega"], setting: "HQ" }],
      shotList: [{ shot_id: "SH1", moment: "m", framing: "f", visual_notes: "v" }],
      gensparkAssetBibleMd: "# Assets\n- A",
      gensparkSlideGuideMd: "# Guide\n- G",
      gensparkBuildScriptTxt: "BUILD"
    });

    const broken = doc.replace("Panel 2 Medical Visual Content:\nevidence panel", "Panel 2 Medical Visual Content:\nNone");
    const validation = validateGensparkMasterDoc(broken, finalPatched.slides);
    expect(validation.ok).toBe(false);
    expect(validation.errors.join(" ")).toContain("Panel 2 cannot be None");
  });

  it("renders '- None' placeholders when recurring lists are empty", () => {
    const finalPatched = samplePatchedSpec();
    finalPatched.reusable_visual_primer.character_descriptions = [];
    finalPatched.reusable_visual_primer.recurring_scene_descriptions = [];
    finalPatched.reusable_visual_primer.reusable_visual_elements = [];
    finalPatched.reusable_visual_primer.continuity_rules = [];
    finalPatched.slides[0] = {
      ...finalPatched.slides[0],
      used_assets: [],
      used_characters: []
    };

    const doc = buildGensparkMasterDoc({
      topic: "Topic",
      finalPatched,
      reusableVisualPrimer: finalPatched.reusable_visual_primer,
      storyBible: {
        premise: "p",
        rules: ["r"],
        recurring_motifs: ["m"],
        cast: [],
        story_constraints_used: ["constraint"],
        visual_constraints_used: ["constraint"]
      },
      beatSheet: [],
      shotList: [],
      gensparkAssetBibleMd: "",
      gensparkSlideGuideMd: "",
      gensparkBuildScriptTxt: ""
    });

    expect(doc).toContain("### Canonical continuity rules\n- None");
    expect(doc).toContain("Used Assets:\n- None");
    expect(doc).toContain("Used Characters:\n- None");
  });

  it("flags section order, missing fields, and mode mismatches in malformed docs", () => {
    const finalPatched = samplePatchedSpec();
    const validDoc = buildGensparkMasterDoc({
      topic: "Topic",
      finalPatched,
      reusableVisualPrimer: finalPatched.reusable_visual_primer,
      storyBible: {
        premise: "p",
        rules: ["r"],
        recurring_motifs: ["m"],
        cast: [{ name: "Dr. Ada Vega", role: "lead", bio: "bio", traits: ["calm"], constraints: ["kind"] }],
        story_constraints_used: ["constraint"],
        visual_constraints_used: ["constraint"]
      },
      beatSheet: [{ beat: "b", purpose: "p", characters: ["Dr. Ada Vega"], setting: "HQ" }],
      shotList: [{ shot_id: "SH1", moment: "m", framing: "f", visual_notes: "v" }],
      gensparkAssetBibleMd: "# Assets\n- A",
      gensparkSlideGuideMd: "# Guide\n- G",
      gensparkBuildScriptTxt: "BUILD"
    });

    const swappedHeadings = validDoc
      .replace("## RECURRING CHARACTERS", "## TEMP_HEADING")
      .replace("## RECURRING SCENES", "## RECURRING CHARACTERS")
      .replace("## TEMP_HEADING", "## RECURRING SCENES");

    const broken = `${swappedHeadings
      .replace("Medical Visual Mode:", "Medical Visual Mode BROKEN")
      .replace("Render Instructions:", "Render Instructions BROKEN")}
<!-- BEGIN_SLIDE:S999 -->
Slide ID: S999
<!-- END_SLIDE:S999 -->`;

    const validation = validateGensparkMasterDoc(broken, finalPatched.slides);
    expect(validation.ok).toBe(false);
    expect(validation.errors.join(" ")).toContain("Section heading out of order");
    expect(validation.errors.join(" ")).toContain("Slide block count mismatch");
    expect(validation.errors.join(" ")).toContain('missing field "Medical Visual Mode"');
    expect(validation.errors.join(" ")).toContain("Medical Visual Mode mismatch");
  });
});
