import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import {
  ChapterOutlineCategory,
  ChapterOutlineTopicArea,
  generateStoryBeat,
  getChapterOutline,
  getRun,
  getStoryBeats,
  rerunFrom,
  RunStatus,
  StoryBeatsResponse,
  updateStoryBeats
} from "../api";

type WorkshopRow = {
  id: string;
  categoryTitle: string;
  title: string;
  outlineMarkdown: string;
  isIntroOutro: boolean;
};

function rowStatus(args: { beatMd: string; saveBusy: boolean; generateBusy: boolean }): "idle" | "saving" | "generating" | "ready" {
  if (args.generateBusy) return "generating";
  if (args.saveBusy) return "saving";
  if (args.beatMd.trim().length > 0) return "ready";
  return "idle";
}

function topicAreaMarkdown(topicArea: ChapterOutlineTopicArea): string {
  const lines: string[] = [`## ${topicArea.id} ${topicArea.title}`];
  for (const subtopic of topicArea.subtopics) {
    lines.push(`- **${subtopic.id} ${subtopic.title}**`);
    if (subtopic.content_md && subtopic.content_md.trim().length > 0) {
      lines.push(`  - ${subtopic.content_md}`);
    }
  }
  return lines.join("\n");
}

function mapRows(categories: ChapterOutlineCategory[]): WorkshopRow[] {
  const rows: WorkshopRow[] = [
    {
      id: "INTRO",
      categoryTitle: "Intro",
      title: "Intro Beat",
      outlineMarkdown: "",
      isIntroOutro: true
    }
  ];

  const sorted = categories.slice().sort((a, b) => a.order - b.order);
  for (const category of sorted) {
    for (const topicArea of category.topic_areas) {
      rows.push({
        id: topicArea.id,
        categoryTitle: category.title,
        title: `${topicArea.id} ${topicArea.title}`,
        outlineMarkdown: topicAreaMarkdown(topicArea),
        isIntroOutro: false
      });
    }
  }

  rows.push({
    id: "OUTRO",
    categoryTitle: "Outro",
    title: "Outro Beat",
    outlineMarkdown: "",
    isIntroOutro: true
  });

  return rows;
}

function beatForRow(storyBeats: StoryBeatsResponse | null, rowId: string): string {
  if (!storyBeats) return "";
  if (rowId === "INTRO") return storyBeats.intro.beat_md;
  if (rowId === "OUTRO") return storyBeats.outro.beat_md;
  return storyBeats.topic_area_beats[rowId]?.beat_md ?? "";
}

function noteForRow(storyBeats: StoryBeatsResponse | null, rowId: string): string {
  if (!storyBeats) return "";
  if (rowId === "INTRO") return storyBeats.intro.user_notes;
  if (rowId === "OUTRO") return storyBeats.outro.user_notes;
  return storyBeats.topic_area_beats[rowId]?.user_notes ?? "";
}

export default function WorkshopPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const safeRunId = runId ?? "";

  const [run, setRun] = useState<RunStatus | null>(null);
  const [rows, setRows] = useState<WorkshopRow[]>([]);
  const [storyBeats, setStoryBeats] = useState<StoryBeatsResponse | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [generateBusyByRow, setGenerateBusyByRow] = useState<Record<string, boolean>>({});
  const [saveBusyByRow, setSaveBusyByRow] = useState<Record<string, boolean>>({});
  const [fullBuildBusy, setFullBuildBusy] = useState(false);
  const [fullBuildErr, setFullBuildErr] = useState<string | null>(null);

  async function loadWorkshop() {
    if (!safeRunId) return;
    setBusy(true);
    setErr(null);
    try {
      const [runData, outline, beats] = await Promise.all([
        getRun(safeRunId),
        getChapterOutline(safeRunId),
        getStoryBeats(safeRunId)
      ]);
      setRun(runData);
      const nextRows = mapRows(outline.chapter_outline.categories);
      setRows(nextRows);
      setStoryBeats(beats);
      const nextDraft: Record<string, string> = {};
      for (const row of nextRows) {
        nextDraft[row.id] = noteForRow(beats, row.id);
      }
      setNotesDraft(nextDraft);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadWorkshop();
  }, [safeRunId]);

  async function onSaveNotes(row: WorkshopRow) {
    if (!safeRunId) return;
    const notes = notesDraft[row.id] ?? "";
    setSaveBusyByRow((prev) => ({ ...prev, [row.id]: true }));
    setErr(null);
    try {
      const next = await updateStoryBeats(safeRunId, {
        topicAreaId: row.id,
        categoryTitle: row.categoryTitle,
        userNotes: notes
      });
      setStoryBeats(next);
      setNotesDraft((prev) => ({ ...prev, [row.id]: noteForRow(next, row.id) }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaveBusyByRow((prev) => ({ ...prev, [row.id]: false }));
    }
  }

  async function onGenerateBeat(row: WorkshopRow) {
    if (!safeRunId) return;
    const notes = notesDraft[row.id] ?? "";
    setGenerateBusyByRow((prev) => ({ ...prev, [row.id]: true }));
    setErr(null);
    try {
      const generated = await generateStoryBeat(safeRunId, {
        topicAreaId: row.id,
        categoryTitle: row.categoryTitle,
        userNotes: notes
      });
      setStoryBeats(generated.story_beats);
      setNotesDraft((prev) => ({ ...prev, [row.id]: noteForRow(generated.story_beats, row.id) }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerateBusyByRow((prev) => ({ ...prev, [row.id]: false }));
    }
  }

  async function onContinueToFullBuild() {
    if (!safeRunId) return;
    setFullBuildErr(null);
    setFullBuildBusy(true);
    try {
      const next = await rerunFrom(safeRunId, "D");
      navigate(`/runs/${next.runId}`);
    } catch (e) {
      setFullBuildErr(e instanceof Error ? e.message : String(e));
    } finally {
      setFullBuildBusy(false);
    }
  }

  const readiness = useMemo(() => {
    if (!storyBeats) {
      return { intro: false, outro: false, topicAreasTotal: 0, topicAreasReady: 0, canContinue: false };
    }
    const topicAreaRows = rows.filter((row) => !row.isIntroOutro);
    const topicAreasReady = topicAreaRows.filter((row) => beatForRow(storyBeats, row.id).trim().length > 0).length;
    const intro = storyBeats.intro.beat_md.trim().length > 0;
    const outro = storyBeats.outro.beat_md.trim().length > 0;
    const canContinue = intro && outro && topicAreasReady === topicAreaRows.length && topicAreaRows.length > 0;
    return {
      intro,
      outro,
      topicAreasTotal: topicAreaRows.length,
      topicAreasReady,
      canContinue
    };
  }, [rows, storyBeats]);

  const progressPercent = useMemo(() => {
    const total = readiness.topicAreasTotal + 2;
    if (total <= 0) return 0;
    const readyCount = readiness.topicAreasReady + (readiness.intro ? 1 : 0) + (readiness.outro ? 1 : 0);
    return Math.round((readyCount / total) * 100);
  }, [readiness]);

  const rowCategoryIndex = useMemo(() => {
    const index = new Map<string, string[]>();
    for (const row of rows) {
      const key = row.categoryTitle;
      const values = index.get(key) ?? [];
      values.push(row.id);
      index.set(key, values);
    }
    return [...index.entries()];
  }, [rows]);

  return (
    <div className="panel workshopCard workshopCardFigma">
      <div className="panelHeader">
        <div>
          <h2 className="sectionTitle sectionTitleGradient">Beat workshop</h2>
          <p className="subtle mono">{safeRunId || "-"}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link className="buttonLink" to={`/runs/${safeRunId}`}>
            Back to run
          </Link>
          <Link className="badge" to={`/runs/${safeRunId}/artifacts`}>
            Artifact vault
          </Link>
          <button onClick={() => void loadWorkshop()} disabled={busy}>
            {busy ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="panelBody">
        {err && <span className="badge badgeErr">{err}</span>}
        {!err && busy && <div className="subtle">Loading workshop data…</div>}
        {!err && !busy && run && run.settings?.workflow !== "v2_micro_detectives" && (
          <span className="badge badgeWarn">Workshop is intended for v2 runs.</span>
        )}

        <div className="readinessBar">
          <div className="readinessBarHeader">
            <div className="metaKey">Build readiness</div>
            <div className="mono">{progressPercent}%</div>
          </div>
          <div className="readinessTrack">
            <div className="readinessFill" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="statusChipRow">
            <span className={`statusChip ${readiness.topicAreasReady === readiness.topicAreasTotal && readiness.topicAreasTotal > 0 ? "statusChipActive" : ""}`}>
              <span>topic beats</span>
              <span className="statusChipCount mono">
                {readiness.topicAreasReady}/{readiness.topicAreasTotal}
              </span>
            </span>
            <span className={`statusChip ${readiness.intro ? "statusChipActive" : ""}`}>
              <span>intro</span>
              <span className="statusChipCount mono">{readiness.intro ? "ready" : "pending"}</span>
            </span>
            <span className={`statusChip ${readiness.outro ? "statusChipActive" : ""}`}>
              <span>outro</span>
              <span className="statusChipCount mono">{readiness.outro ? "ready" : "pending"}</span>
            </span>
          </div>
        </div>

        <div className="workshopStatusGrid">
          <div className="workshopStatusItem">
            <div className="metaKey">topic areas</div>
            <div className="mono">{readiness.topicAreasTotal}</div>
          </div>
          <div className="workshopStatusItem">
            <div className="metaKey">beats ready</div>
            <div className="mono">{readiness.topicAreasReady}</div>
          </div>
          <div className="workshopStatusItem">
            <div className="metaKey">intro</div>
            <div className="mono">{readiness.intro ? "ready" : "missing"}</div>
          </div>
          <div className="workshopStatusItem">
            <div className="metaKey">outro</div>
            <div className="mono">{readiness.outro ? "ready" : "missing"}</div>
          </div>
        </div>

        {rowCategoryIndex.length > 0 && (
          <div className="workshopJumpStrip">
            {rowCategoryIndex.map(([category, ids]) => (
              <a key={category} className="badge badgeLinkCta" href={`#workshop-row-${ids[0]}`}>
                {category}
                <span className="statusChipCount mono">{ids.length}</span>
              </a>
            ))}
          </div>
        )}

        {!busy && !err && rows.length === 0 && <div className="subtle">No `chapter_outline.json` found yet for this run.</div>}

        {rows.length > 0 && (
          <div className="workshopGrid">
            <div className="workshopGridHeader">Outline (locked)</div>
            <div className="workshopGridHeader">Your Notes</div>
            <div className="workshopGridHeader">Generated Beat</div>

            {rows.map((row) => {
              const beatMd = beatForRow(storyBeats, row.id);
              const generateBusy = Boolean(generateBusyByRow[row.id]);
              const saveBusy = Boolean(saveBusyByRow[row.id]);
              const state = rowStatus({ beatMd, saveBusy, generateBusy });
              return (
                <Fragment key={row.id}>
                  <div className="workshopCell workshopOutlineCell" id={`workshop-row-${row.id}`}>
                    <div className="workshopCellTitle">
                      <span className="badge">{row.categoryTitle}</span>
                      <strong>{row.title}</strong>
                    </div>
                    {row.isIntroOutro ? (
                      <p className="subtle">Intro/Outro does not use an outline panel. Use notes + generate to draft this beat.</p>
                    ) : (
                      <ReactMarkdown>{row.outlineMarkdown}</ReactMarkdown>
                    )}
                  </div>

                  <div className="workshopCell workshopNotesCell">
                    <label className="metaKey" htmlFor={`notes-${row.id}`}>
                      Notes
                    </label>
                    <textarea
                      id={`notes-${row.id}`}
                      value={notesDraft[row.id] ?? ""}
                      onChange={(e) => {
                        const value = e.currentTarget.value;
                        setNotesDraft((prev) => ({ ...prev, [row.id]: value }));
                      }}
                      rows={8}
                      placeholder="Add your direction for this beat..."
                    />
                    <div className="row" style={{ gap: 8 }}>
                      <button onClick={() => void onSaveNotes(row)} disabled={saveBusy || generateBusy}>
                        {saveBusy ? "Saving..." : "Save Notes"}
                      </button>
                      <button onClick={() => void onGenerateBeat(row)} disabled={generateBusy}>
                        {generateBusy ? "Generating..." : "Generate Beat"}
                      </button>
                    </div>
                  </div>

                  <div className="workshopCell workshopBeatCell">
                    <div className={`badge workshopBeatState workshopBeatState-${state}`}>
                      {state === "generating" ? "Generating..." : state === "saving" ? "Saving..." : state === "ready" ? "Generated" : "Ready"}
                    </div>
                    {beatMd.trim().length === 0 ? (
                      <p className="subtle">No beat generated yet.</p>
                    ) : (
                      <ReactMarkdown>{beatMd}</ReactMarkdown>
                    )}
                  </div>
                </Fragment>
              );
            })}
          </div>
        )}

        <div className="row" style={{ marginTop: 14, gap: 10 }}>
          <button className="primaryButton" disabled={!readiness.canContinue || fullBuildBusy} onClick={() => void onContinueToFullBuild()}>
            {fullBuildBusy ? "Starting child run..." : "Continue to Full Build (rerun from D)"}
          </button>
          {!readiness.canContinue && <span className="subtle">Requires intro/outro beats and one beat per topic area.</span>}
        </div>
        {fullBuildErr && (
          <div style={{ marginTop: 8 }}>
            <span className="badge badgeErr">{fullBuildErr}</span>
          </div>
        )}

        {rows.length > 0 && (
          <div className="workshopFooterHint subtle">
            Tip: Generate beats for each topic area in order to preserve continuity across the episode arc.
          </div>
        )}
      </div>
    </div>
  );
}
