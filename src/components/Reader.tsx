import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bookmark,
  ChevronLeft,
  Copy,
  Feather,
  Layers2,
  RotateCcw,
  Share2,
  Sparkles,
} from "lucide-react";
import {
  bodyText,
  dateLabel,
  stageInfo,
  stages,
  type Article,
  type ReadingState,
  type Stage,
} from "../data/model";
import { requestSummary } from "../data/store";
import { useLibrary } from "../data/library-context";
import { debianNotice } from "../../shared/reviewed-article";
import { ArticleBody, Discussion, PublisherLink } from "./ArticleBody";
import { ManualCopy } from "./Dialogs";

interface Props {
  a: Article;
  state: ReadingState;
  stage?: Stage;
  onStage: (s: Stage) => void;
  onBack: () => void;
  notify: (message: string) => void;
}
type Result = { paragraphs: string[] } | { error: string };
export function DepthMark({ n }: { n: number }) {
  return n === 3 ? (
    <BookOpen aria-hidden="true" />
  ) : (
    <span className="depth-mark" aria-hidden="true">
      {Array.from({ length: n + 1 }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}
export function Reader({
  a: current,
  state,
  stage,
  onStage,
  onBack,
  notify,
}: Props) {
  const db = useLibrary();
  const [edition, setEdition] = useState(current);
  const hold =
    !!current.library &&
    !!stage &&
    current.id === edition.id &&
    current.bodyHash !== edition.bodyHash &&
    current.coverage === edition.coverage &&
    current.license === edition.license &&
    current.permissions.display &&
    edition.permissions.display &&
    current.permissions.copy === edition.permissions.copy;
  if (!hold && edition.bodyHash !== current.bodyHash) setEdition(current);
  const a = hold ? edition : current,
    live = !!a.library;
  const [result, setResult] = useState<Result>();
  const [attempt, retry] = useState(0);
  const [manual, setManual] = useState<{ value: string; revision?: string }>();
  if (
    manual?.revision &&
    (manual.revision !== current.bodyHash || !current.permissions.copy)
  )
    setManual(undefined);
  const pane = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const restored = useRef(false);
  const original = stage === "original";
  const allowed = a.permissions.display && a.coverage !== "missing";
  const ready = live || original || !allowed || !!result;
  const coverageLabel = !allowed
    ? "Publisher only"
    : a.coverage === "complete"
      ? "Verified complete original"
      : a.coverage === "excerpt"
        ? "Publisher excerpt"
        : "Completeness unverified";
  const index = stage ? stages.indexOf(stage) : -1;
  const paragraphs =
    result && "paragraphs" in result ? result.paragraphs : undefined;
  useEffect(() => {
    if (!stage) return;
    let active = true;
    void db.states.update(a.id, { opened: true });
    if (live || original || !allowed) {
      void db.viewed(
        a.id,
        stage,
        original && allowed && a.coverage === "complete",
      );
    } else {
      void requestSummary(a, stage)
        .then((paragraphs) => {
          if (active) {
            setResult({ paragraphs });
            void db.viewed(a.id, stage, true);
          }
        })
        .catch((e: unknown) => {
          if (active)
            setResult({
              error:
                e instanceof Error
                  ? e.message
                  : "The local summary could not be loaded.",
            });
        });
    }
    return () => {
      active = false;
    };
  }, [a, stage, original, allowed, attempt, live, db]);
  useLayoutEffect(() => {
    if (stage) heading.current?.focus({ preventScroll: true });
  }, [stage]);
  useEffect(() => {
    if (!stage || !ready) return;
    let active = true;
    Promise.all([
      db.positions.get(a.id + "/" + stage),
      document.fonts.ready,
    ]).then(([position]) => {
      if (active && pane.current) {
        pane.current.scrollTop = position?.top ?? 0;
        restored.current = true;
      }
    });
    return () => {
      active = false;
      restored.current = false;
    };
  }, [a.id, stage, ready, db]);
  async function copy(text: string, label: string, revision?: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify(label + " copied");
    } catch {
      setManual({ value: text, revision });
    }
  }
  async function share() {
    if (!a.publisher) return;
    const url = new URL(a.publisher, location.href).href;
    if (navigator.share) {
      try {
        await navigator.share({ title: a.title, url });
        return;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
      }
    }
    await copy(url, "Publisher link");
  }
  async function copyBody() {
    const latest = live ? await db.articles.get(a.id) : a;
    if (
      !latest?.permissions.copy ||
      !latest.permissions.display ||
      latest.bodyHash !== a.bodyHash
    ) {
      notify("The article changed. Check the current edition before copying.");
      return;
    }
    const text = bodyText(a.blocks);
    const attribution = a.reviewedDebian
      ? debianNotice + "\n" + a.publisher + "\n\n"
      : live && a.license
        ? [a.author, a.publication, a.publisher, a.license]
            .filter(Boolean)
            .join(" · ") + "\n\n"
        : "";
    await copy(
      attribution + text,
      a.coverage === "complete"
        ? "Article"
        : a.coverage === "excerpt"
          ? "Excerpt"
          : "Text",
      a.bodyHash,
    );
  }
  async function toggle(flag: "saved" | "archived") {
    try {
      await db.changeFlag(a.id, flag);
      notify(
        flag === "saved"
          ? state.saved
            ? "Removed from Saved"
            : "Added to Saved"
          : state.archived
            ? "Restored to Inbox"
            : "Moved to Archive",
      );
    } catch {
      notify("This change could not be saved on this device.");
    }
  }
  const fullCopy =
    a.coverage === "complete"
      ? "Copy full article text"
      : a.coverage === "unverified"
        ? "Copy available text"
        : "Copy excerpt";
  return (
    <section
      className={"desk" + (stage ? " is-open" : " is-preview")}
      aria-label="Reading desk"
    >
      <header className="desk-bar">
        {stage ? (
          <button className="plain back" onClick={onBack}>
            <ArrowLeft /> Back to list
          </button>
        ) : (
          <span className="desk-name">
            <BookOpen /> Reading desk
          </span>
        )}
        <div className="desk-actions">
          <button
            className={"plain" + (state.saved ? " flagged" : "")}
            onClick={() => void toggle("saved")}
            aria-pressed={state.saved}
          >
            <Bookmark fill={state.saved ? "currentColor" : "none"} />
            {state.saved ? "Saved" : "Save"}
          </button>
          <button className="plain" onClick={() => void toggle("archived")}>
            {state.archived ? <ArchiveRestore /> : <Archive />}
            {state.archived ? "Restore" : "Archive"}
          </button>
        </div>
      </header>
      <div
        className="paper-scroll"
        ref={pane}
        onScroll={(e) => {
          if (stage && restored.current)
            void db.positions.put({
              id: a.id + "/" + stage,
              top: e.currentTarget.scrollTop,
            });
        }}
      >
        <article className="paper">
          <header className="article-heading">
            <div className="publication">
              <span className="pub-rule" />
              {a.publication}
            </div>
            <h1
              ref={heading}
              tabIndex={-1}
              aria-describedby={stage ? "stage-name stage-source" : undefined}
            >
              {a.title}
            </h1>
            <div className="byline">
              {a.author && (
                <>
                  <span>
                    By <strong>{a.author}</strong>
                  </span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span>{dateLabel(a, true)}</span>
            </div>
          </header>
          {hold && (
            <p role="status" className="notice">
              An updated edition is available.{" "}
              <button
                className="text-action"
                onClick={() => setEdition(current)}
              >
                Read updated edition
              </button>
            </p>
          )}
          {!stage ? (
            live ? (
              <div className="depth-intro">
                <div className="section-label">Publisher edition</div>
                <h2>{coverageLabel}</h2>
                <p>{a.reason}</p>
                <button
                  className="secondary"
                  onClick={() => onStage("original")}
                >
                  <BookOpen /> Read original
                </button>
              </div>
            ) : (
              <>
                <div className="depth-intro">
                  <div className="section-label">
                    <Layers2 /> Reading depth
                  </div>
                  <h2>Where would you like to start?</h2>
                </div>
                <div className="depth-options">
                  {stages.map((s, i) => (
                    <button
                      key={s}
                      className="depth-option"
                      onClick={() => onStage(s)}
                    >
                      <span className="depth-tile">
                        <DepthMark n={i} />
                      </span>
                      <span>
                        <strong>{stageInfo[s][0]}</strong>
                        <small>{stageInfo[s][1]}</small>
                      </span>
                      <ArrowRight />
                    </button>
                  ))}
                </div>
              </>
            )
          ) : (
            <>
              {!live && (
                <nav className="depth-nav" aria-label="Reading depth">
                  {stages.map((s, i) => (
                    <button
                      key={s}
                      aria-current={s === stage ? "step" : undefined}
                      onClick={() => {
                        if (s !== stage) onStage(s);
                      }}
                    >
                      <span className="step-dot">{i + 1}</span>
                      {stageInfo[s][0]}
                    </button>
                  ))}
                </nav>
              )}
              <section
                className={
                  "stage-content" + (original ? " source-content" : "")
                }
                aria-label={stageInfo[stage][0]}
              >
                <div className="stage-heading">
                  <h2 id="stage-name">
                    {original && live
                      ? coverageLabel
                      : original
                        ? a.coverage === "excerpt"
                          ? "Original excerpt"
                          : "Original"
                        : stageInfo[stage][0]}
                  </h2>
                  <span
                    id="stage-source"
                    className={
                      "source-label" + (original ? " author-label" : "")
                    }
                  >
                    {original ? <Feather /> : <Sparkles />}
                    {live
                      ? original
                        ? "Publisher edition"
                        : "Live subscription"
                      : original
                        ? "Publisher text"
                        : "AI summary · Demo"}
                  </span>
                </div>
                {a.coverage === "excerpt" && (
                  <p className="notice">
                    <strong>Excerpt only.</strong> {a.reason}
                  </p>
                )}
                {live && !original ? (
                  <div className="notice">
                    <strong>AI summaries are off</strong>
                    <p>
                      {coverageLabel}. {a.reason}
                    </p>
                  </div>
                ) : !allowed ? (
                  <>
                    <div className="notice">
                      <strong>Article text unavailable</strong>
                      {live && a.coverage === "unverified" && (
                        <p>Completeness unverified.</p>
                      )}
                      <p>{a.reason}</p>
                    </div>
                    <PublisherLink a={a} />
                  </>
                ) : original ? (
                  <>
                    {live && a.coverage === "unverified" && (
                      <p className="notice">{a.reason}</p>
                    )}
                    <ArticleBody a={a} />
                    {live && a.license && (
                      <details className="discussion">
                        <summary>Source and licence</summary>
                        <div>
                          {a.reviewedDebian && <p>{debianNotice}</p>}
                          <a href={a.license} target="_blank" rel="noreferrer">
                            Publisher licence
                          </a>
                        </div>
                      </details>
                    )}
                    <Discussion a={a} />
                  </>
                ) : paragraphs ? (
                  <div className="summary-text" aria-live="polite">
                    {paragraphs.map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                  </div>
                ) : result && "error" in result ? (
                  <div className="notice" role="status">
                    <strong>Summary unavailable</strong>
                    <p>{result.error}</p>
                    {a.coverage === "complete" && (
                      <button
                        className="text-action"
                        onClick={() => {
                          setResult(undefined);
                          retry((n) => n + 1);
                        }}
                      >
                        Try again <RotateCcw />
                      </button>
                    )}
                    {a.coverage === "excerpt" && <PublisherLink a={a} />}
                  </div>
                ) : (
                  <p role="status" className="loading">
                    Preparing the local summary…
                  </p>
                )}
              </section>
              <div className="reading-actions">
                {!original && !live && (
                  <button
                    className="primary"
                    onClick={() => onStage(stages[index + 1])}
                  >
                    More detail <ArrowRight />
                  </button>
                )}
                {!original && (
                  <button
                    className="secondary"
                    onClick={() => onStage("original")}
                  >
                    <BookOpen /> Read original
                  </button>
                )}
                {index > 0 && !live && (
                  <button
                    className="plain"
                    onClick={() => onStage(stages[index - 1])}
                  >
                    <ChevronLeft /> Less detail
                  </button>
                )}
                {index > 0 && !live && (
                  <button className="plain" onClick={() => onStage("essence")}>
                    <RotateCcw /> Start again
                  </button>
                )}
              </div>
              <div className="utility-actions">
                {paragraphs && (
                  <button
                    className="plain"
                    onClick={() =>
                      void copy(paragraphs.join("\n\n"), "Summary")
                    }
                  >
                    <Copy /> Copy summary
                  </button>
                )}
                {allowed && a.permissions.copy && (
                  <button className="plain" onClick={() => void copyBody()}>
                    <Copy /> {fullCopy}
                  </button>
                )}
                {a.publisher && (
                  <button className="plain" onClick={() => void share()}>
                    <Share2 /> Share link
                  </button>
                )}
                {(allowed || (live && !original)) && <PublisherLink a={a} />}
              </div>
            </>
          )}
        </article>
        <div className="paper-end" aria-hidden="true">
          <span /> <Feather /> <span />
        </div>
      </div>
      {manual !== undefined && (
        <ManualCopy value={manual.value} onClose={() => setManual(undefined)} />
      )}
    </section>
  );
}
