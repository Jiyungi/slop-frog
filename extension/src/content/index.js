(function initSlopFrogContent() {
  const runtime = globalThis.SlopFrogRuntime;
  const processedArticles = new WeakMap();
  const panelState = new WeakMap();
  let settings = { ...runtime.DEFAULT_EXTENSION_SETTINGS };
  let observer;
  let scanTimer;

  injectStyles();
  boot();

  async function boot() {
    settings = await getSettings();
    scanVisiblePosts();
    observer = new MutationObserver(queueScan);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", queueScan, { passive: true });
  }

  async function getSettings() {
    const response = await sendMessage({ type: "SLOP_FROG_GET_SETTINGS" });
    return response?.settings || runtime.DEFAULT_EXTENSION_SETTINGS;
  }

  function queueScan() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scanVisiblePosts, 180);
  }

  function scanVisiblePosts() {
    const articles = Array.from(
      document.querySelectorAll('article[data-testid="tweet"]')
    );

    for (const article of articles) {
      if (processedArticles.has(article)) continue;
      const envelope = extractPostEnvelope(article);
      processedArticles.set(article, envelope?.contentKey || "failed");
      renderPending(article);

      if (!envelope) {
        renderScored(article, makeLocalGrayResponse(article));
        continue;
      }

      sendMessage({ type: "SLOP_FROG_SCORE_POST", post: envelope }).then(
        (response) => renderScored(article, response)
      );
    }
  }

  function extractPostEnvelope(article) {
    const statusAnchor = Array.from(article.querySelectorAll('a[href*="/status/"]'))
      .map((anchor) => anchor.href)
      .find(Boolean);
    const tweetId = statusAnchor?.match(/\/status\/(\d+)/)?.[1];
    const visibleText = getTweetText(article);
    const normalizedText = runtime.normalizeText(visibleText);
    const textHash = runtime.stableHash(normalizedText.toLowerCase());
    const authorHandle = getAuthorHandle(article, statusAnchor);
    const imageUrls = Array.from(article.querySelectorAll('img[src*="twimg.com/media"]'))
      .map((image) => image.src)
      .filter(Boolean);

    if (!tweetId && !normalizedText && imageUrls.length === 0) {
      return null;
    }

    return {
      platform: "x",
      contentKey: tweetId ? `x:${tweetId}` : `x:text:${textHash}`,
      tweetId,
      url: statusAnchor,
      authorHandle,
      visibleText,
      normalizedText,
      textHash,
      imageUrls,
      extractedAt: new Date().toISOString(),
    };
  }

  function getTweetText(article) {
    const tweetTextNodes = Array.from(
      article.querySelectorAll('[data-testid="tweetText"]')
    );
    if (tweetTextNodes.length) {
      return tweetTextNodes.map((node) => node.innerText || "").join("\n");
    }

    return Array.from(article.querySelectorAll('[lang], div[dir="auto"]'))
      .map((node) => node.innerText || "")
      .filter((text) => text.trim().length > 2)
      .slice(0, 4)
      .join("\n");
  }

  function getAuthorHandle(article, statusAnchor) {
    const handleFromStatus = statusAnchor?.match(/x\.com\/([^/]+)\/status\//)?.[1];
    if (handleFromStatus && handleFromStatus !== "i") return `@${handleFromStatus}`;

    const relativeHandle = statusAnchor
      ? new URL(statusAnchor, window.location.origin).pathname.match(
          /^\/([^/]+)\/status\//
        )?.[1]
      : "";
    if (relativeHandle && relativeHandle !== "i") return `@${relativeHandle}`;

    const handleText = Array.from(article.querySelectorAll("span"))
      .map((node) => node.textContent || "")
      .find((text) => /^@\w+/.test(text.trim()));
    return handleText?.trim();
  }

  function renderPending(article) {
    const mount = ensureMount(article);
    mount.replaceChildren(
      createControlButton({
        kind: "evidence",
        label: "Gray",
        title: "Scoring",
        icon: iconFlag(),
        onClick: () => {},
      })
    );
  }

  function renderScored(article, response) {
    const payload = normalizePanelPayload(response);
    const result = payload.result;
    const mount = ensureMount(article);

    panelState.set(article, payload);
    article.classList.toggle(
      "slop-frog-filtered",
      Boolean(result.autoFiltered) && article.dataset.slopFrogRevealed !== "true"
    );

    mount.replaceChildren(
      createControlButton({
        kind: "evidence",
        label: formatFlagLabel(result),
        title: "View Slop Score evidence",
        icon: iconFlag(),
        tone: result.label,
        onClick: () => togglePanel(article, "evidence"),
      }),
      createControlButton({
        kind: "feedback",
        title: "Add feedback",
        icon: iconFeedback(),
        onClick: () => togglePanel(article, "feedback"),
      }),
      createControlButton({
        kind: "appeal",
        title: "Appeal label",
        icon: iconAppeal(),
        onClick: () => togglePanel(article, "appeal"),
      })
    );

    if (result.autoFiltered) {
      renderFilterCard(article);
    }
  }

  function renderFilterCard(article) {
    let card = article.querySelector(":scope > .slop-frog-filter-card");
    if (!card) {
      card = document.createElement("div");
      card.className = "slop-frog-filter-card";
      article.prepend(card);
    }

    const payload = panelState.get(article);
    card.replaceChildren(
      el("strong", {}, "Slop Frog hid this post"),
      el(
        "span",
        {},
        payload?.result?.slopScore === null
          ? "Red flag"
          : `Red flag · ${payload.result.slopScore}`
      ),
      button("Show post", () => {
        article.dataset.slopFrogRevealed = "true";
        article.classList.remove("slop-frog-filtered");
      }),
      button("Evidence", () => {
        article.dataset.slopFrogRevealed = "true";
        article.classList.remove("slop-frog-filtered");
        togglePanel(article, "evidence");
      })
    );
  }

  function ensureMount(article) {
    let mount = article.querySelector(":scope .slop-frog-controls");
    if (mount) return mount;

    mount = document.createElement("div");
    mount.className = "slop-frog-controls";
    mount.setAttribute("role", "group");
    mount.setAttribute("aria-label", "Slop Frog controls");

    const actionGroup =
      article.querySelector('[data-testid="reply"]')?.closest('[role="group"]') ||
      article.querySelector('[data-testid="like"]')?.closest('[role="group"]') ||
      article.querySelector('[role="group"]');

    if (actionGroup?.parentElement) {
      actionGroup.parentElement.append(mount);
    } else {
      article.append(mount);
    }

    return mount;
  }

  function togglePanel(article, kind) {
    const payload = panelState.get(article);
    if (!payload) return;

    const existing = article.querySelector(":scope .slop-frog-panel");
    if (existing?.dataset.kind === kind) {
      existing.remove();
      return;
    }
    existing?.remove();

    const panel =
      kind === "evidence"
        ? createEvidencePanel(payload)
        : kind === "feedback"
          ? createFeedbackPanel(payload)
          : createAppealPanel(payload);

    const mount = ensureMount(article);
    mount.after(panel);
  }

  function createEvidencePanel(payload) {
    const result = payload.result;
    const scoreResponse = payload.scoreResponse || {};
    const community = payload.communityAggregate;
    const modalityScores = scoreResponse.modalityScores || {};
    const panel = el(
      "section",
      { className: "slop-frog-panel", "data-kind": "evidence" },
      el("div", { className: "slop-frog-panel-head" },
        el("strong", {}, "Evidence"),
        el("span", { className: `slop-frog-dot is-${result.label}` }, "")
      ),
      scoreRow("Slop Score", formatScore(result.slopScore)),
      scoreRow("Local detector", formatScore(result.detectorScore)),
      scoreRow(
        "Community",
        community?.weightedAiScore === null || !community
          ? "—"
          : `${formatScore(community.weightedAiScore)} · ${community.voteCount}`
      ),
      modalityRow("Text", modalityScores.text),
      modalityRow("Image", modalityScores.image),
      modalityRow("Audio", modalityScores.audio),
      modalityRow("Video", modalityScores.video)
    );

    if (result.label === "gray") {
      panel.append(scoreRow("Gray reason", result.reasons?.[0] || "not_enough_signal"));
    }

    panel.append(
      el("div", { className: "slop-frog-reasons" }, result.reasons?.slice(0, 2).join(" · ") || ""),
      el("div", { className: "slop-frog-chart-grid" },
        chartBlock("Score over time", payload.scoreHistory || [], "time"),
        chartBlock("Volume vs score", payload.volumeHistory || [], "volume")
      )
    );

    return panel;
  }

  function createFeedbackPanel(payload) {
    const panel = el(
      "section",
      { className: "slop-frog-panel", "data-kind": "feedback" },
      el("strong", {}, "Community feedback"),
      el("p", {}, "What do you think?")
    );
    const choices = el("div", { className: "slop-frog-choice-row" });
    [
      ["looks_ai", "Looks AI"],
      ["looks_human", "Looks human"],
      ["unsure", "Unsure"],
    ].forEach(([vote, label]) => {
      choices.append(
        button(label, async () => {
          await sendMessage({
            type: "SLOP_FROG_SUBMIT_VOTE",
            payload: {
              contentKey: payload.result.contentKey,
              platform: "x",
              vote,
            },
          });
          panel.replaceChildren(el("strong", {}, "Saved"));
        })
      );
    });
    panel.append(choices);
    return panel;
  }

  function createAppealPanel(payload) {
    const panel = el(
      "section",
      { className: "slop-frog-panel", "data-kind": "appeal" },
      el("strong", {}, "Appeal label"),
      el("p", {}, "Why is this wrong?")
    );
    const choices = el("div", { className: "slop-frog-choice-grid" });
    [
      ["human_written", "Human-written"],
      ["ai_assisted_not_fully_ai", "AI-assisted"],
      ["missing_context", "Missing context"],
      ["other", "Other"],
    ].forEach(([reason, label]) => {
      choices.append(
        button(label, async () => {
          await sendMessage({
            type: "SLOP_FROG_SUBMIT_APPEAL",
            payload: {
              contentKey: payload.result.contentKey,
              reason,
              status: "submitted",
            },
          });
          panel.replaceChildren(el("strong", {}, "Appeal sent"));
        })
      );
    });
    panel.append(choices);
    return panel;
  }

  function chartBlock(title, points, mode) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 120 48");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", title);
    svg.classList.add("slop-frog-chart");

    if (!points.length) {
      const line = svgEl("line", { x1: 12, y1: 34, x2: 108, y2: 34 });
      svg.append(line);
    } else {
      const coords = points.map((point, index) => {
        const x =
          mode === "volume"
            ? 12 + Math.min(96, Number(point.volume || 0) * 5.5)
            : 12 + index * (96 / Math.max(1, points.length - 1));
        const y = 40 - (Number(point.slopScore || 0) / 100) * 32;
        return [x, y];
      });
      const path = svgEl("path", {
        d: coords.map(([x, y], index) => `${index ? "L" : "M"}${x},${y}`).join(" "),
      });
      svg.append(path);
      coords.forEach(([cx, cy]) => svg.append(svgEl("circle", { cx, cy, r: 2 })));
    }

    return el("div", { className: "slop-frog-chart-block" },
      el("span", {}, title),
      svg
    );
  }

  function modalityRow(label, value) {
    if (!value) return scoreRow(label, "—");
    if (value.status === "available") {
      return scoreRow(label, formatScore(value.score));
    }
    return scoreRow(label, value.reason || value.status.replaceAll("_", " "));
  }

  function scoreRow(label, value) {
    return el("div", { className: "slop-frog-row" },
      el("span", {}, label),
      el("strong", {}, value)
    );
  }

  function createControlButton({ kind, label, title, icon, tone, onClick }) {
    const control = document.createElement("button");
    control.type = "button";
    control.className = `slop-frog-button is-${kind}${tone ? ` is-${tone}` : ""}`;
    control.title = title;
    control.setAttribute("aria-label", title);
    control.append(icon);
    if (label) control.append(el("span", {}, label));
    control.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return control;
  }

  function normalizePanelPayload(response) {
    if (response?.ok && response.result) return response;
    return makeLocalGrayResponse(null);
  }

  function makeLocalGrayResponse(article) {
    const contentKey = `x:failed:${runtime.stableHash(article?.innerText || Date.now())}`;
    const scoreResponse = runtime.makeGrayScoreResponse("extraction_failed");
    const result = runtime.composeSlopScore(
      { ...scoreResponse, contentKey },
      null,
      settings
    );
    return {
      ok: true,
      result,
      scoreResponse,
      communityAggregate: null,
      scoreHistory: [],
      volumeHistory: [],
      settings,
    };
  }

  function formatFlagLabel(result) {
    const label = runtime.LABEL_META[result.label]?.label || "Gray";
    if (!settings.showNumericScore || result.slopScore === null) return label;
    return `${label} ${result.slopScore}`;
  }

  function formatScore(value) {
    return value === null || value === undefined ? "—" : String(Math.round(value));
  }

  function button(label, onClick) {
    const element = el("button", {}, label);
    element.type = "button";
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return element;
  }

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (key === "className") node.className = value;
      else if (key.startsWith("data-")) node.setAttribute(key, value);
      else node[key] = value;
    });
    const list = children.flat();
    list.filter((child) => child !== null && child !== undefined).forEach((child) => {
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  function svgEl(tag, attrs) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  function iconFlag() {
    return iconSvg("M5 4v17M6 5h11l-2 4 2 4H6");
  }

  function iconFeedback() {
    return iconSvg("M4 5h16v10H8l-4 4V5Zm5 5 2 2 4-5");
  }

  function iconAppeal() {
    return iconSvg("M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Zm0 5v5m0 3h.01");
  }

  function iconSvg(pathData) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.append(
      svgEl("path", {
        d: pathData,
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.8",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      })
    );
    return svg;
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => resolve(response || { ok: false }));
    });
  }

  function injectStyles() {
    if (document.querySelector("#slop-frog-style")) return;
    const style = document.createElement("style");
    style.id = "slop-frog-style";
    style.textContent = `
      .slop-frog-controls {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-left: auto;
        padding-top: 2px;
        color: oklch(34% 0.024 155);
      }

      .slop-frog-button,
      .slop-frog-panel button,
      .slop-frog-filter-card button {
        appearance: none;
        border: 1px solid color-mix(in oklch, currentColor 22%, transparent);
        background: color-mix(in oklch, currentColor 4%, transparent);
        color: oklch(28% 0.026 155);
        border-radius: 999px;
        cursor: pointer;
        font: 600 11px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        transition: background-color 130ms ease-out, border-color 130ms ease-out, transform 130ms ease-out;
      }

      .slop-frog-button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-height: 22px;
        padding: 3px 7px;
      }

      .slop-frog-button svg {
        width: 13px;
        height: 13px;
      }

      .slop-frog-button.is-feedback,
      .slop-frog-button.is-appeal {
        width: 23px;
        min-height: 23px;
        justify-content: center;
        padding: 3px;
      }

      .slop-frog-button:hover,
      .slop-frog-panel button:hover,
      .slop-frog-filter-card button:hover {
        background: color-mix(in oklch, currentColor 8%, white);
        border-color: color-mix(in oklch, currentColor 34%, transparent);
      }

      .slop-frog-button:active {
        transform: translateY(1px);
      }

      .slop-frog-button:focus-visible,
      .slop-frog-panel button:focus-visible,
      .slop-frog-filter-card button:focus-visible {
        outline: 2px solid oklch(62% 0.14 154);
        outline-offset: 2px;
      }

      .slop-frog-button.is-red {
        color: oklch(39% 0.14 30);
        background: oklch(96% 0.028 30);
      }

      .slop-frog-button.is-yellow {
        color: oklch(38% 0.105 72);
        background: oklch(97% 0.032 78);
      }

      .slop-frog-button.is-green {
        color: oklch(34% 0.095 150);
        background: oklch(97% 0.025 150);
      }

      .slop-frog-button.is-gray {
        color: oklch(38% 0.012 255);
        background: oklch(97% 0.004 255);
      }

      .slop-frog-panel {
        display: grid;
        gap: 6px;
        max-width: min(392px, calc(100% - 24px));
        margin: 6px 0 8px auto;
        padding: 9px;
        border: 1px solid oklch(86% 0.012 155);
        border-radius: 12px;
        background: oklch(99% 0.004 155);
        color: oklch(23% 0.035 155);
        box-shadow: 0 8px 22px color-mix(in oklch, black 8%, transparent);
        font: 12px/1.3 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .slop-frog-panel p {
        margin: 0;
        color: oklch(42% 0.03 155);
      }

      .slop-frog-panel-head,
      .slop-frog-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
      }

      .slop-frog-panel-head strong {
        font-size: 12px;
        letter-spacing: -0.01em;
      }

      .slop-frog-row span {
        color: oklch(43% 0.03 155);
      }

      .slop-frog-row strong {
        max-width: 58%;
        overflow: hidden;
        text-align: right;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .slop-frog-reasons {
        color: oklch(38% 0.035 155);
      }

      .slop-frog-dot {
        width: 9px;
        height: 9px;
        border-radius: 999px;
        background: oklch(62% 0.01 255);
      }

      .slop-frog-dot.is-red { background: oklch(58% 0.22 32); }
      .slop-frog-dot.is-yellow { background: oklch(73% 0.18 78); }
      .slop-frog-dot.is-green { background: oklch(61% 0.17 150); }

      .slop-frog-chart-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }

      .slop-frog-chart-block {
        display: grid;
        gap: 4px;
        color: oklch(42% 0.03 155);
      }

      .slop-frog-chart {
        width: 100%;
        height: 40px;
        border: 1px solid oklch(89% 0.01 155);
        border-radius: 9px;
        background: oklch(100% 0 0);
      }

      .slop-frog-chart path,
      .slop-frog-chart line {
        stroke: oklch(54% 0.16 154);
        stroke-width: 2;
        fill: none;
      }

      .slop-frog-chart circle {
        fill: oklch(45% 0.16 154);
      }

      .slop-frog-choice-row,
      .slop-frog-choice-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }

      .slop-frog-choice-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
      }

      .slop-frog-panel button,
      .slop-frog-filter-card button {
        padding: 6px 9px;
      }

      article.slop-frog-filtered > *:not(.slop-frog-filter-card) {
        display: none !important;
      }

      .slop-frog-filter-card {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 12px;
        color: oklch(25% 0.04 155);
        background: oklch(98% 0.015 155);
      }

      .slop-frog-filter-card span {
        color: oklch(42% 0.04 155);
      }

      @media (prefers-reduced-motion: no-preference) {
        .slop-frog-panel {
          animation: slop-frog-panel-in 140ms ease-out;
        }
        @keyframes slop-frog-panel-in {
          from { opacity: 0; transform: translateY(-3px); }
          to { opacity: 1; transform: translateY(0); }
        }
      }
    `;
    document.documentElement.append(style);
  }
})();
