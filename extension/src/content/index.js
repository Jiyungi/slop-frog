(function initSlopFrogContent() {
  const runtime = globalThis.SlopFrogRuntime;
  const processedArticles = new WeakMap();
  const panelState = new WeakMap();
  let settings = { ...runtime.DEFAULT_EXTENSION_SETTINGS };
  let activeAdapter;
  let observer;
  let scanTimer;
  let stopped = false;

  window.addEventListener("error", suppressInvalidatedContextError, true);
  window.addEventListener("unhandledrejection", suppressInvalidatedContextError, true);
  injectStyles();
  queueMicrotask(() => {
    boot().catch(() => {
      // Chrome can invalidate old content-script contexts immediately after an
      // extension reload. The new content script will boot on page refresh.
    });
  });

  async function boot() {
    activeAdapter = getPlatformAdapter(window.location);
    if (!activeAdapter) return;
    settings = await getSettings();
    if (stopped) return;
    scanVisiblePosts();
    observer = new MutationObserver(queueScan);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", guardedEvent(queueScan), { passive: true });
    document.addEventListener("keydown", guardedEvent(closePanelsOnEscape));
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  }

  async function getSettings() {
    const response = await sendMessage({ type: "SLOP_FROG_GET_SETTINGS" });
    return response?.settings || runtime.DEFAULT_EXTENSION_SETTINGS;
  }

  function queueScan() {
    if (stopped) return;
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scanVisiblePosts, 180);
  }

  function scanVisiblePosts() {
    if (stopped || !activeAdapter) return;
    const articles = activeAdapter.findPosts(document);

    for (const article of articles) {
      if (processedArticles.has(article)) continue;
      const envelope = extractPostEnvelope(article, activeAdapter);
      processedArticles.set(article, envelope?.contentKey || "failed");
      renderPending(article);

      if (!envelope) {
        renderScored(article, makeLocalGrayResponse(article));
        continue;
      }

      sendMessage({ type: "SLOP_FROG_SCORE_POST", post: envelope })
        .then((response) => renderScored(article, response))
        .catch((error) => {
          if (isContextInvalidation(error?.message)) {
            stopContentScript();
            return;
          }
          renderScored(article, makeLocalGrayResponse(article, "extension_unavailable"));
        });
    }
  }

  function getPlatformAdapter(location) {
    const host = location.hostname.replace(/^www\./, "");
    return PLATFORM_ADAPTERS.find((adapter) =>
      adapter.hostnames.some((hostname) => host === hostname || host.endsWith(`.${hostname}`))
    );
  }

  const PLATFORM_ADAPTERS = [
    {
      platform: "x",
      hostnames: ["x.com", "twitter.com"],
      findPosts(root) {
        return Array.from(root.querySelectorAll('article[data-testid="tweet"]'));
      },
      extract: extractXPost,
      findInsertionPoint: findXActionGroup,
    },
    {
      platform: "linkedin",
      hostnames: ["linkedin.com"],
      findPosts(root) {
        return findLinkedInPosts(root);
      },
      extract: extractLinkedInPost,
      findInsertionPoint(post) {
        return (
          post.querySelector(".feed-shared-social-action-bar") ||
          post.querySelector(".social-actions") ||
          post.querySelector('[aria-label*="React"]')?.closest('[role="group"]') ||
          post.querySelector('[aria-label*="Like"]')?.closest('[role="group"]') ||
          post.querySelector(".social-details-social-counts") ||
          post
        );
      },
    },
  ];

  const LINKEDIN_TEXT_SELECTORS = [
    ".update-components-text",
    ".feed-shared-inline-show-more-text",
    ".feed-shared-text",
    ".break-words",
    ".feed-shared-update-v2__description-wrapper",
    '[data-test-id="main-feed-activity-card__commentary"]',
    '[data-test-id="feed-shared-update-v2__commentary"]',
    '[dir="ltr"]',
  ];

  function extractPostEnvelope(article, adapter) {
    const extracted = adapter.extract(article);
    const visibleText = extracted.visibleText || "";
    const normalizedText = runtime.normalizeText(visibleText);
    const textHash = runtime.stableHash(
      `${adapter.platform}:${normalizedText.toLowerCase()}:${extracted.url || ""}`
    );

    if (!extracted.id && !normalizedText && !extracted.imageUrls?.length) {
      return null;
    }

    return {
      platform: adapter.platform,
      contentKey: extracted.id
        ? `${adapter.platform}:${extracted.id}`
        : `${adapter.platform}:text:${textHash}`,
      tweetId: adapter.platform === "x" ? extracted.id : undefined,
      url: extracted.url,
      authorHandle: extracted.authorHandle,
      visibleText,
      normalizedText,
      textHash,
      imageUrls: extracted.imageUrls || [],
      extractedAt: new Date().toISOString(),
    };
  }

  function extractXPost(article) {
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

    return {
      id: tweetId,
      url: statusAnchor,
      authorHandle,
      visibleText,
      imageUrls,
    };
  }

  function extractLinkedInPost(post) {
    const url = firstHref(post, [
      'a[href*="/feed/update/"]',
      'a[href*="activity:"]',
      'a[href*="urn:li:activity"]',
    ]);
    const id =
      post.getAttribute("data-urn")?.split(":").pop() ||
      post.getAttribute("data-id")?.split(":").pop() ||
      post.getAttribute("data-activity-urn")?.split(":").pop() ||
      url?.match(/activity[:/-](\d+)/)?.[1];

    return {
      id,
      url,
      authorHandle: getTextFromSelectors(post, [
        ".update-components-actor__name",
        ".feed-shared-actor__name",
        ".update-components-actor__title",
      ]),
      visibleText: getLinkedInText(post),
      imageUrls: imageUrlsFrom(post, 'img[src]:not([src*="profile-displayphoto"])'),
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

  function findLinkedInPosts(root) {
    const direct = Array.from(
      root.querySelectorAll(
        [
          ".feed-shared-update-v2",
          ".occludable-update",
          '[data-urn*="urn:li:activity"]',
          '[data-id*="urn:li:activity"]',
          "[data-activity-urn]",
        ].join(", ")
      )
    );
    const fromText = Array.from(root.querySelectorAll(LINKEDIN_TEXT_SELECTORS.join(", ")))
      .map((node) =>
        node.closest(
          '.feed-shared-update-v2, .occludable-update, [data-urn*="urn:li:activity"], [data-id*="urn:li:activity"], [data-activity-urn], article'
        )
      )
      .filter(Boolean);

    return uniqueTopLevel([...direct, ...fromText]).filter((post) => {
      const text = getLinkedInText(post);
      return text.length > 8 || imageUrlsFrom(post).length > 0;
    });
  }

  function getLinkedInText(post) {
    const selectedText = getTextFromSelectors(post, LINKEDIN_TEXT_SELECTORS);
    if (selectedText.length > 0) return cleanLinkedInText(selectedText);
    return cleanLinkedInText(post.innerText || post.textContent || "");
  }

  function cleanLinkedInText(text) {
    return String(text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter(
        (line) =>
          !/^(Like|Comment|Repost|Send|Follow|Connect|Promoted|Suggested|Show more|See translation)$/i.test(
            line
          )
      )
      .slice(0, 10)
      .join("\n");
  }

  function getTextFromSelectors(root, selectors) {
    for (const selector of selectors) {
      const text = Array.from(root.querySelectorAll(selector))
        .map((node) => node.innerText || node.textContent || "")
        .map((textValue) => textValue.trim())
        .filter(Boolean)
        .join("\n")
        .trim();
      if (text.length > 0) return text;
    }
    return "";
  }

  function firstHref(root, selectors) {
    for (const selector of selectors) {
      const href = Array.from(root.querySelectorAll(selector))
        .map((anchor) => anchor.href)
        .find(Boolean);
      if (href) return href;
    }
    return undefined;
  }

  function imageUrlsFrom(root, selector = "img[src]") {
    return Array.from(root.querySelectorAll(selector))
      .map((image) => image.currentSrc || image.src)
      .filter(Boolean)
      .filter((src) => !src.startsWith("data:"))
      .slice(0, 8);
  }

  function uniqueTopLevel(nodes) {
    const list = Array.from(nodes);
    return list.filter(
      (node) => !list.some((other) => other !== node && other.contains(node))
    );
  }

  function renderPending(article) {
    const mount = ensureMount(article);
    mount.replaceChildren(
      createControlButton({
        kind: "evidence",
        label: "",
        title: "Scoring",
        icon: iconVerdictFlag("loading"),
        tone: "loading",
        onClick: () => {},
      })
    );
  }

  function renderScored(article, response) {
    const payload = normalizePanelPayload(response, article);
    if (!payload) return;

    payload.article = article;
    panelState.set(article, payload);
    renderSlopControls(article, payload);
  }

  function renderSlopControls(article, payload) {
    const result = payload.result;
    const mount = ensureMount(article);
    const shouldAutoFilter =
      Boolean(result.autoFiltered) && article.dataset.slopFrogRevealed !== "true";

    article.classList.toggle("slop-frog-filtered", shouldAutoFilter);
    if (!shouldAutoFilter) removeFilterCard(article);

    mount.replaceChildren(
      createControlButton({
        kind: "evidence",
        label: "",
        title: "View Slop Score evidence",
        icon: iconVerdictFlag(result.label),
        tone: result.label,
        onClick: () => togglePanel(article, "evidence"),
      }),
      createControlButton({
        kind: "feedback",
        title: "Add feedback",
        icon: iconFrogFeedback(),
        onClick: () => togglePanel(article, "feedback"),
      }),
      createControlButton({
        kind: "appeal",
        title: "Appeal label",
        icon: iconAppealScale(),
        onClick: () => togglePanel(article, "appeal"),
      })
    );

    if (shouldAutoFilter) {
      renderFilterCard(article);
    }
  }

  function handleRuntimeMessage(message) {
    if (message?.type !== "SLOP_FROG_SETTINGS_CHANGED") return;
    settings = { ...settings, ...(message.settings || {}) };
    refreshRenderedPostsForSettings();
  }

  function refreshRenderedPostsForSettings() {
    if (stopped) return;
    const articles = activeAdapter?.findPosts(document) || [];
    for (const article of articles) {
      const payload = panelState.get(article);
      if (!payload?.scoreResponse) continue;
      payload.settings = settings;
      payload.result = runtime.composeSlopScore(
        { ...payload.scoreResponse, contentKey: payload.post?.contentKey || "" },
        payload.communityAggregate,
        settings
      );
      renderSlopControls(article, payload);
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
      el("strong", {}, "Hidden"),
      el(
        "span",
        {},
        payload?.result?.slopScore === null
          ? "Red flag"
          : `Red flag · ${payload.result.slopScore}`
      ),
      button("Show", () => {
        article.dataset.slopFrogRevealed = "true";
        article.classList.remove("slop-frog-filtered");
        removeFilterCard(article);
      }),
      button("Evidence", () => {
        article.dataset.slopFrogRevealed = "true";
        article.classList.remove("slop-frog-filtered");
        removeFilterCard(article);
        togglePanel(article, "evidence");
      })
    );
  }

  function removeFilterCard(article) {
    article.querySelector(":scope > .slop-frog-filter-card")?.remove();
  }

  function ensureMount(article) {
    let mount = article.querySelector(":scope .slop-frog-controls");
    if (mount) return mount;

    const slot = document.createElement("div");
    slot.className = "slop-frog-slot";

    mount = document.createElement("div");
    mount.className = "slop-frog-controls";
    mount.setAttribute("role", "group");
    mount.setAttribute("aria-label", "Slop Frog controls");

    slot.append(mount);
    const insertionPoint = activeAdapter?.findInsertionPoint(article);
    if (insertionPoint && insertionPoint !== article) {
      insertionPoint.insertAdjacentElement("afterend", slot);
    } else {
      article.append(slot);
    }

    return mount;
  }

  function findXActionGroup(article) {
    const groups = Array.from(article.querySelectorAll('[role="group"]')).filter(
      (group) =>
        group.querySelector(
          '[data-testid="reply"], [data-testid="retweet"], [data-testid="like"]'
        )
    );
    return groups.at(-1) || null;
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

    panel.append(createPanelCloseButton(panel));
    const mount = ensureMount(article);
    mount.after(panel);
  }

  function closePanelsOnEscape(event) {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".slop-frog-panel").forEach((panel) => panel.remove());
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
      scoreRow("Detector score", formatScore(result.detectorScore)),
      scoreRow("Community", formatCommunityScore(community)),
      modalityRow("Text", modalityScores.text),
      modalityRow("Image", modalityScores.image),
      modalityRow("Audio", modalityScores.audio),
      modalityRow("Video", modalityScores.video)
    );

    if (result.label === "gray") {
      panel.append(scoreRow("Gray reason", result.reasons?.[0] || "not_enough_signal"));
    }

    panel.append(
      el("div", { className: "slop-frog-reasons" }, result.reasons?.slice(0, 2).map(formatReason).join(" · ") || ""),
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
          const response = await sendMessage({
            type: "SLOP_FROG_SUBMIT_VOTE",
            payload: {
              contentKey: payload.result.contentKey,
              platform: payload.post?.platform || activeAdapter?.platform || "x",
              vote,
              post: payload.post,
            },
          });
          if (!response?.ok) {
            panel.replaceChildren(el("strong", {}, "Could not save feedback"));
            return;
          }
          updatePanelCommunity(payload, response.communityAggregate);
          panel.replaceChildren(el("strong", {}, "Saved to community"));
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
          const response = await sendMessage({
            type: "SLOP_FROG_SUBMIT_APPEAL",
            payload: {
              contentKey: payload.result.contentKey,
              reason,
              status: "submitted",
              post: payload.post,
            },
          });
          if (!response?.ok) {
            panel.replaceChildren(el("strong", {}, "Could not send appeal"));
            return;
          }
          updatePanelCommunity(payload, response.communityAggregate);
          panel.replaceChildren(el("strong", {}, "Appeal sent"));
        })
      );
    });
    panel.append(choices);
    return panel;
  }

  function updatePanelCommunity(payload, communityAggregate) {
    if (!communityAggregate) return;
    payload.communityAggregate = communityAggregate;
    payload.result = runtime.composeSlopScore(
      { ...payload.scoreResponse, contentKey: payload.post?.contentKey || "" },
      communityAggregate,
      settings
    );
    if (payload.article) {
      renderSlopControls(payload.article, payload);
    }
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
      svg,
      points.length ? "" : el("small", {}, "No history yet")
    );
  }

  function modalityRow(label, value) {
    if (!value) return scoreRow(label, "—");
    if (value.status === "available") {
      return scoreRow(label, formatScore(value.score));
    }
    return scoreRow(label, formatReason(value.reason || value.status));
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
    control.addEventListener("click", guardedEvent((event) => {
      captureUiEvent(event);
      if (stopped) return;
      onClick();
    }));
    return control;
  }

  function createPanelCloseButton(panel) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "slop-frog-close";
    close.title = "Close";
    close.setAttribute("aria-label", "Close Slop Frog panel");
    close.textContent = "×";
    close.addEventListener("click", guardedEvent((event) => {
      captureUiEvent(event);
      if (stopped) return;
      if (panel.isConnected) panel.remove();
    }));
    return close;
  }

  function normalizePanelPayload(response, article) {
    if (response?.ok && response.result) return response;
    if (isContextInvalidation(response?.error)) {
      stopContentScript();
      return null;
    }
    return makeLocalGrayResponse(article, response?.error || "extension_unavailable");
  }

  function makeLocalGrayResponse(article, reason = "extraction_failed") {
    const platform = activeAdapter?.platform || "x";
    const contentKey = `${platform}:failed:${runtime.stableHash(article?.innerText || Date.now())}`;
    const scoreResponse = runtime.makeGrayScoreResponse(reason);
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

  function formatCommunityScore(community) {
    const communityScore = community?.weightedAiScore ?? community?.communityScore;
    if (!community || communityScore === null || communityScore === undefined) return "—";
    const voteCount = Number(community.voteCount || 0);
    const voteLabel = voteCount === 1 ? "vote" : "votes";
    return `${formatScore(communityScore)} (${voteCount} ${voteLabel})`;
  }

  function formatReason(value) {
    return String(value || "")
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function button(label, onClick) {
    const element = el("button", {}, label);
    element.type = "button";
    element.addEventListener("click", guardedEvent((event) => {
      captureUiEvent(event);
      if (stopped) return;
      onClick();
    }));
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

  function iconVerdictFlag(label) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("slop-frog-flag-mark", `is-${label}`);
    svg.append(
      svgEl("path", {
        d: "M6 20V4.8c0-.8.6-1.4 1.4-1.4h9.7c.7 0 1.1.8.7 1.4l-1.7 2.7 1.7 2.7c.4.6 0 1.4-.7 1.4H7.8V20H6Z",
        fill: "currentColor",
      }),
      svgEl("path", {
        d: "M8 5.4h7.6l-1.2 2.1 1.2 2.1H8V5.4Z",
        fill: "color-mix(in oklch, white 28%, currentColor)",
      })
    );
    return svg;
  }

  function iconFrog() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("slop-frog-mark");
    svg.append(
      svgEl("path", {
        d: "M6.5 9.5C7.2 6.8 9.1 5.4 12 5.4s4.8 1.4 5.5 4.1c1.6.6 2.7 2 2.7 3.8 0 3.3-3.3 5.5-8.2 5.5s-8.2-2.2-8.2-5.5c0-1.8 1.1-3.2 2.7-3.8Z",
        fill: "currentColor",
      }),
      svgEl("circle", { cx: 8.6, cy: 8.4, r: 2.4, fill: "currentColor" }),
      svgEl("circle", { cx: 15.4, cy: 8.4, r: 2.4, fill: "currentColor" }),
      svgEl("circle", { cx: 8.8, cy: 8.5, r: 0.8, fill: "Canvas" }),
      svgEl("circle", { cx: 15.2, cy: 8.5, r: 0.8, fill: "Canvas" }),
      svgEl("path", {
        d: "M9.2 14.4c1.7 1 3.9 1 5.6 0",
        fill: "none",
        stroke: "Canvas",
        "stroke-width": "1.2",
        "stroke-linecap": "round",
      })
    );
    return svg;
  }

  function iconFeedback() {
    return iconSvg("M4 5h16v10H8l-4 4V5Zm5 5 2 2 4-5");
  }

  function iconFrogFeedback() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("slop-frog-feedback-mark");
    svg.append(
      svgEl("path", {
        d: "M4 6.8c0-1 .8-1.8 1.8-1.8h12.4c1 0 1.8.8 1.8 1.8v7.8c0 1-.8 1.8-1.8 1.8H10l-4.2 3.1c-.6.4-1.4 0-1.4-.7v-2.9A1.8 1.8 0 0 1 4 14.6V6.8Z",
        fill: "currentColor",
      }),
      svgEl("circle", { cx: 9.3, cy: 10.2, r: 2.1, fill: "color-mix(in oklch, white 22%, currentColor)" }),
      svgEl("circle", { cx: 14.7, cy: 10.2, r: 2.1, fill: "color-mix(in oklch, white 22%, currentColor)" }),
      svgEl("circle", { cx: 9.4, cy: 10.2, r: 0.65, fill: "Canvas" }),
      svgEl("circle", { cx: 14.6, cy: 10.2, r: 0.65, fill: "Canvas" }),
      svgEl("path", {
        d: "M9.8 13.1c1.4.8 3 .8 4.4 0",
        fill: "none",
        stroke: "Canvas",
        "stroke-width": "1.2",
        "stroke-linecap": "round",
      })
    );
    return svg;
  }

  function iconAppeal() {
    return iconSvg("M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Zm0 5v5m0 3h.01");
  }

  function iconAppealScale() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("slop-frog-appeal-mark");
    svg.append(
      svgEl("path", {
        d: "M12 4v15M7 19h10M5 8h14M12 8 8 14H4l4-6m8 0 4 6h-4l-4-6",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.8",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
      svgEl("circle", { cx: 12, cy: 8, r: 2, fill: "currentColor" })
    );
    return svg;
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
      try {
        if (!chrome?.runtime?.id) {
          resolve({ ok: false, error: "extension_context_invalidated" });
          return;
        }

        chrome.runtime.sendMessage(message, (response) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            resolve({
              ok: false,
              error: lastError.message || "extension_context_invalidated",
            });
            return;
          }

          resolve(response || { ok: false });
        });
      } catch (error) {
        resolve({
          ok: false,
          error: error?.message || "extension_context_invalidated",
        });
      }
    });
  }

  function isContextInvalidation(message) {
    return /extension context invalidated|context invalidated/i.test(String(message || ""));
  }

  function guardedEvent(handler) {
    return function slopFrogGuardedEvent(event) {
      if (stopped) return;
      try {
        handler(event);
      } catch (error) {
        if (isContextInvalidation(error?.message)) {
          quietStopContentScript();
          return;
        }
        throw error;
      }
    };
  }

  function captureUiEvent(event) {
    try {
      event?.preventDefault?.();
      event?.stopPropagation?.();
    } catch (error) {
      if (isContextInvalidation(error?.message)) {
        quietStopContentScript();
        return;
      }
      throw error;
    }
  }

  function suppressInvalidatedContextError(event) {
    const message =
      event?.reason?.message ||
      event?.error?.message ||
      event?.message ||
      String(event?.reason || "");

    if (!isContextInvalidation(message)) return;
    try {
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
    } catch {
      // If Chrome invalidated the isolated world, even touching the event can fail.
    }
    quietStopContentScript();
  }

  function stopContentScript() {
    stopped = true;
    window.clearTimeout(scanTimer);
    observer?.disconnect();
    chrome.runtime.onMessage.removeListener?.(handleRuntimeMessage);
  }

  function quietStopContentScript() {
    try {
      stopContentScript();
    } catch {
      stopped = true;
    }
  }

  function injectStyles() {
    if (document.querySelector("#slop-frog-style")) return;
    const style = document.createElement("style");
    style.id = "slop-frog-style";
    style.textContent = `
      .slop-frog-controls {
        --sf-font: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        --sf-display: "Arial Rounded MT Bold", "Trebuchet MS", Inter, system-ui, sans-serif;
        --sf-moss: oklch(14% 0.026 154);
        --sf-moss-2: oklch(22% 0.045 154);
        --sf-line: oklch(44% 0.085 154);
        --sf-text: oklch(96% 0.016 154);
        --sf-muted: oklch(78% 0.052 154);
        --sf-green: oklch(79% 0.19 149);
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        flex: 0 0 auto;
        align-self: center;
        gap: 6px;
        width: fit-content;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        box-shadow: none;
        color: var(--sf-green);
        font-family: var(--sf-font);
        position: relative;
        z-index: 4;
      }

      .slop-frog-slot {
        display: block;
        width: 100% !important;
        min-width: 0;
        max-width: 100%;
        flex: 0 0 100%;
        align-self: stretch !important;
        margin: 6px 0 0 0 !important;
        padding: 0 !important;
        text-align: left;
        pointer-events: none;
        clear: both;
      }

      .slop-frog-slot .slop-frog-controls,
      .slop-frog-slot .slop-frog-panel {
        pointer-events: auto;
      }

      .slop-frog-button,
      .slop-frog-panel button,
      .slop-frog-filter-card button {
        appearance: none;
        border: 1px solid color-mix(in oklch, currentColor 34%, transparent);
        background:
          linear-gradient(180deg, color-mix(in oklch, var(--sf-moss-2) 92%, transparent), color-mix(in oklch, var(--sf-moss) 96%, transparent));
        color: var(--sf-green);
        border-radius: 12px;
        cursor: pointer;
        font: 700 11px/1 var(--sf-font);
        letter-spacing: -0.01em;
        box-shadow:
          0 7px 16px color-mix(in oklch, black 28%, transparent),
          inset 0 1px 0 color-mix(in oklch, white 12%, transparent);
        transition: background-color 130ms ease-out, border-color 130ms ease-out, color 130ms ease-out, transform 130ms ease-out;
      }

      .slop-frog-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        width: 31px;
        min-width: 31px;
        height: 29px;
        min-height: 29px;
        padding: 0;
      }

      .slop-frog-button svg {
        width: 17px;
        height: 17px;
      }

      .slop-frog-button.is-feedback,
      .slop-frog-button.is-appeal {
        width: 31px;
        min-width: 31px;
        height: 29px;
        min-height: 29px;
        justify-content: center;
        padding: 0;
        background:
          linear-gradient(180deg, oklch(21% 0.04 154), oklch(14.5% 0.026 154));
      }

      .slop-frog-button.is-feedback,
      .slop-frog-button.is-appeal {
        color: oklch(96% 0.012 154);
      }

      .slop-frog-button.is-evidence {
        color: oklch(72% 0.018 255);
      }

      .slop-frog-button:hover,
      .slop-frog-panel button:hover,
      .slop-frog-filter-card button:hover {
        background:
          linear-gradient(180deg, color-mix(in oklch, currentColor 20%, oklch(21% 0.04 154)), color-mix(in oklch, currentColor 12%, oklch(14.5% 0.026 154)));
        border-color: color-mix(in oklch, currentColor 52%, transparent);
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
        color: oklch(68% 0.22 31);
        background: color-mix(in oklch, oklch(73% 0.19 31) 16%, transparent);
      }

      .slop-frog-button.is-yellow {
        color: oklch(83% 0.18 83);
        background: color-mix(in oklch, oklch(82% 0.16 82) 16%, transparent);
      }

      .slop-frog-button.is-green {
        color: oklch(75% 0.2 150);
        background: color-mix(in oklch, oklch(75% 0.18 150) 17%, transparent);
      }

      .slop-frog-button.is-gray {
        color: oklch(72% 0.018 255);
        background: color-mix(in oklch, oklch(72% 0.018 255) 13%, transparent);
      }

      .slop-frog-button.is-loading {
        color: oklch(80% 0.19 150);
        background: color-mix(in oklch, oklch(80% 0.19 150) 14%, transparent);
      }

      .slop-frog-button.is-loading .slop-frog-mark {
        animation: slop-frog-pulse 900ms ease-in-out infinite;
      }

      .slop-frog-button.is-loading .slop-frog-flag-mark {
        animation: slop-frog-pulse 900ms ease-in-out infinite;
      }

      .slop-frog-panel {
        --sf-font: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        position: relative;
        display: grid;
        gap: 8px;
        max-width: min(388px, calc(100% - 24px));
        margin: 8px auto 10px 0;
        padding: 12px;
        border: 1px solid oklch(39% 0.07 154);
        border-radius: 16px;
        background:
          radial-gradient(circle at 95% 0%, color-mix(in oklch, oklch(78% 0.18 149) 14%, transparent), transparent 32%),
          linear-gradient(180deg, oklch(19% 0.035 154), oklch(13.5% 0.026 154));
        color: oklch(95% 0.018 154);
        box-shadow:
          0 18px 40px color-mix(in oklch, black 38%, transparent),
          inset 0 1px 0 color-mix(in oklch, white 10%, transparent);
        font: 12px/1.35 var(--sf-font);
        z-index: 3;
      }

      .slop-frog-panel p {
        margin: 0;
        color: oklch(78% 0.055 154);
      }

      .slop-frog-row {
        display: grid;
        grid-template-columns: minmax(110px, 1fr) minmax(92px, auto);
        align-items: center;
        justify-content: space-between;
        gap: 14px;
      }

      .slop-frog-panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding-right: 22px;
      }

      .slop-frog-panel-head strong {
        color: oklch(98% 0.012 154);
        font-size: 13px;
        letter-spacing: -0.01em;
      }

      .slop-frog-row span {
        color: oklch(78% 0.05 154);
      }

      .slop-frog-row strong {
        color: oklch(96% 0.014 154);
        font-weight: 720;
        max-width: 170px;
        overflow: hidden;
        text-align: right;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .slop-frog-reasons {
        color: oklch(80% 0.055 154);
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
        color: oklch(79% 0.052 154);
      }

      .slop-frog-chart {
        width: 100%;
        height: 40px;
        border: 1px solid color-mix(in oklch, oklch(79% 0.16 149) 55%, transparent);
        border-radius: 12px;
        background: oklch(11% 0.022 154);
        box-shadow: inset 0 1px 8px color-mix(in oklch, black 22%, transparent);
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
        padding: 7px 10px;
        color: oklch(90% 0.08 151);
        background: linear-gradient(180deg, oklch(29% 0.08 151), oklch(22% 0.065 151));
        border-color: oklch(46% 0.11 151);
        box-shadow:
          0 6px 16px color-mix(in oklch, black 22%, transparent),
          inset 0 1px 0 color-mix(in oklch, white 10%, transparent);
      }

      .slop-frog-close {
        position: absolute;
        top: 8px;
        right: 8px;
        display: grid;
        width: 22px;
        min-width: 22px;
        height: 22px;
        min-height: 22px;
        place-items: center;
        padding: 0 !important;
        border-radius: 999px !important;
        color: oklch(87% 0.055 154) !important;
        background: color-mix(in oklch, white 7%, transparent) !important;
        border-color: color-mix(in oklch, white 14%, transparent) !important;
        box-shadow: none !important;
        font-size: 16px !important;
        line-height: 1 !important;
      }

      .slop-frog-close:hover {
        color: oklch(98% 0.012 154) !important;
        background: color-mix(in oklch, white 13%, transparent) !important;
      }

      .slop-frog-filtered > *:not(.slop-frog-filter-card) {
        display: none !important;
      }

      .slop-frog-filtered {
        display: block !important;
        box-sizing: border-box !important;
        width: 100% !important;
        max-width: 100% !important;
        height: auto !important;
        min-height: 0 !important;
        padding: 10px 12px !important;
      }

      .slop-frog-filter-card {
        --sf-font: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        box-sizing: border-box;
        grid-column: 1 / -1 !important;
        flex: 1 1 100%;
        width: 100%;
        max-width: 100%;
        min-width: 0;
        min-height: 48px;
        height: auto;
        margin: 0 !important;
        padding: 11px 12px;
        border: 1px solid color-mix(in oklch, oklch(68% 0.22 31) 48%, transparent);
        border-radius: 17px;
        color: oklch(96% 0.015 154);
        background:
          radial-gradient(circle at 100% 0%, color-mix(in oklch, oklch(70% 0.22 31) 15%, transparent), transparent 34%),
          linear-gradient(180deg, oklch(18% 0.034 154), oklch(12% 0.024 154));
        box-shadow:
          0 16px 34px color-mix(in oklch, black 28%, transparent),
          inset 0 1px 0 color-mix(in oklch, white 10%, transparent);
        font: 12px/1.25 var(--sf-font);
        overflow: hidden;
      }

      .slop-frog-filter-card strong {
        color: oklch(98% 0.012 154);
        font-weight: 760;
        letter-spacing: -0.01em;
      }

      .slop-frog-filter-card span {
        color: oklch(79% 0.055 154);
        margin-right: auto;
        white-space: nowrap;
      }

      .slop-frog-filter-card button {
        flex: 0 0 auto;
      }

      @media (prefers-reduced-motion: no-preference) {
        .slop-frog-panel {
          animation: slop-frog-panel-in 140ms ease-out;
        }
        @keyframes slop-frog-panel-in {
          from { opacity: 0; transform: translateY(-3px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes slop-frog-pulse {
          0%, 100% { transform: scale(1); opacity: 0.82; }
          50% { transform: scale(1.12); opacity: 1; }
        }
      }

      @media (prefers-color-scheme: dark) {
        .slop-frog-button,
        .slop-frog-panel button,
        .slop-frog-filter-card button {
          color: oklch(76% 0.17 150);
          background: color-mix(in oklch, currentColor 12%, transparent);
        }

        .slop-frog-panel {
          border-color: oklch(34% 0.025 155);
        }
      }
    `;
    document.documentElement.append(style);
  }
})();
